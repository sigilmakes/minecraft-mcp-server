import { z } from "zod";
import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';

/**
 * Foods sorted by saturation restoration (best first).
 * Used to auto-select the best food in inventory.
 */
const FOOD_PRIORITY: string[] = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_rabbit', 'cooked_cod',
  'baked_potato', 'bread', 'pumpkin_pie', 'mushroom_stew',
  'rabbit_stew', 'beetroot_soup', 'suspicious_stew',
  'golden_apple', 'enchanted_golden_apple',
  'apple', 'melon_slice', 'sweet_berries', 'glow_berries',
  'carrot', 'beetroot', 'dried_kelp', 'cookie',
  'potato', 'raw_beef', 'raw_porkchop', 'raw_mutton',
  'raw_chicken', 'raw_rabbit', 'raw_cod', 'raw_salmon',
  'rotten_flesh', 'spider_eye',  // last resort
];

export function registerSurvivalTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {

  factory.registerTool(
    "eat",
    "Eat food from inventory. Auto-selects the best food available, or specify an item. Requires food > 0 hunger points missing.",
    {
      item: z.string().optional().describe("Specific food item to eat (e.g. 'cooked_beef'). If omitted, eats the best food available."),
    },
    async ({ item }: { item?: string }) => {
      const bot = getBot();

      // Check if we can eat (food must be below 20)
      if (bot.food >= 20) {
        return factory.createResponse("Not hungry — food bar is full (20/20).");
      }

      let foodItem;

      if (item) {
        // Specific item requested
        foodItem = bot.inventory.items().find(i => i.name === item);
        if (!foodItem) {
          return factory.createResponse(`No ${item} in inventory.`);
        }
      } else {
        // Auto-select best food
        const inventory = bot.inventory.items();
        for (const foodName of FOOD_PRIORITY) {
          foodItem = inventory.find(i => i.name === foodName);
          if (foodItem) break;
        }
        if (!foodItem) {
          // Try anything that might be food (items not in our list)
          foodItem = inventory.find(i =>
            i.name.includes('cooked') || i.name.includes('food') ||
            i.name.includes('stew') || i.name.includes('soup')
          );
        }
        if (!foodItem) {
          const available = inventory.map(i => i.name).join(', ');
          return factory.createResponse(`No food in inventory. Items: ${available || 'empty'}`);
        }
      }

      try {
        // Equip the food to hand
        await bot.equip(foodItem, 'hand');

        // Consume it
        await bot.consume();

        return factory.createResponse(
          `Ate ${foodItem.name}. Health: ${Math.round(bot.health)}/20, Food: ${bot.food}/20`
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Common case: item isn't actually food
        if (msg.includes('consume') || msg.includes('food')) {
          return factory.createResponse(`Couldn't eat ${foodItem.name} — it may not be food. Error: ${msg}`);
        }
        return factory.createErrorResponse(error as Error);
      }
    }
  );

  factory.registerTool(
    "attack",
    "Attack the nearest entity of a given type, or a specific entity. Strikes once.",
    {
      type: z.string().optional().describe("Entity type to attack (e.g. 'zombie', 'cow'). If omitted, attacks nearest hostile mob."),
      maxDistance: z.number().optional().describe("Maximum distance to target (default: 5)"),
    },
    async ({ type, maxDistance = 5 }: { type?: string; maxDistance?: number }) => {
      const bot = getBot();
      const pos = bot.entity.position;

      const HOSTILE = new Set([
        'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
        'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
        'enderman', 'blaze', 'ghast', 'magma_cube', 'wither_skeleton',
        'pillager', 'vindicator', 'evoker', 'ravager', 'vex',
        'piglin_brute', 'warden', 'guardian', 'elder_guardian',
        'hoglin', 'silverfish', 'zombified_piglin',
      ]);

      // Find target
      const target = bot.nearestEntity((entity) => {
        if (!entity.position) return false;
        if (pos.distanceTo(entity.position) > maxDistance) return false;

        if (type) {
          // Match specific type
          return entity.name === type || (entity.name?.includes(type) ?? false);
        } else {
          // Default: nearest hostile
          return HOSTILE.has(entity.name ?? '');
        }
      });

      if (!target) {
        return factory.createResponse(
          `No ${type || 'hostile mob'} found within ${maxDistance} blocks.`
        );
      }

      const targetName = target.name || target.type || 'unknown';
      const dist = pos.distanceTo(target.position);

      try {
        // Look at the target first
        await bot.lookAt(target.position.offset(0, target.height * 0.5, 0));

        // Need to be close enough to hit (3 blocks in vanilla)
        if (dist > 3.5) {
          // Move closer
          const { goals } = await import('mineflayer-pathfinder');
          bot.pathfinder.setGoal(new goals.GoalNear(
            target.position.x, target.position.y, target.position.z, 2
          ));

          // Wait briefly for approach
          await new Promise(resolve => setTimeout(resolve, 2000));
          bot.pathfinder.stop();

          const newDist = pos.distanceTo(target.position);
          if (newDist > 4) {
            return factory.createResponse(
              `Couldn't get close enough to ${targetName} (${Math.floor(newDist)} blocks away). Try moving closer first.`
            );
          }
        }

        // Attack!
        bot.attack(target);

        return factory.createResponse(
          `Attacked ${targetName} at ${Math.floor(dist)} blocks. Health: ${Math.round(bot.health)}/20`
        );
      } catch (error) {
        return factory.createErrorResponse(error as Error);
      }
    }
  );
}
