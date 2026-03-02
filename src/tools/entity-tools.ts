import { z } from "zod";
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;
import { ToolFactory } from '../tool-factory.js';

type Entity = ReturnType<Bot['nearestEntity']>;

export function registerEntityTools(factory: ToolFactory, getBot: () => Bot): void {
  factory.registerTool(
    "find-entity",
    "Find the nearest entity of a specific type",
    {
      type: z.string().optional().describe("Type of entity to find (empty for any entity)"),
      maxDistance: z.coerce.number().finite().optional().describe("Maximum search distance (default: 16)")
    },
    async ({ type = '', maxDistance = 16 }) => {
      const bot = getBot();
      const entityFilter = (entity: NonNullable<Entity>) => {
        if (!type) return true;
        if (type === 'player') return entity.type === 'player';
        if (type === 'mob') return entity.type === 'mob';
        return Boolean(entity.name && entity.name.includes(type.toLowerCase()));
      };

      const entity = bot.nearestEntity(entityFilter);

      if (!entity || bot.entity.position.distanceTo(entity.position) > maxDistance) {
        return factory.createResponse(`No ${type || 'entity'} found within ${maxDistance} blocks`);
      }

      const entityName = entity.name || (entity as { username?: string }).username || entity.type;
      return factory.createResponse(`Found ${entityName} at position (${Math.floor(entity.position.x)}, ${Math.floor(entity.position.y)}, ${Math.floor(entity.position.z)})`);
    }
  );

  factory.registerTool(
    "follow-player",
    "Follow a player, staying within a certain distance. Follows for up to 60 seconds or until stopped.",
    {
      username: z.string().describe("Username of the player to follow"),
      distance: z.number().optional().describe("How close to stay to the player (default: 3)"),
      durationMs: z.number().optional().describe("How long to follow in milliseconds (default: 30000, max: 60000)")
    },
    async ({ username, distance = 3, durationMs = 30000 }: { username: string; distance?: number; durationMs?: number }) => {
      const bot = getBot();
      const maxDuration = Math.min(durationMs, 60000);

      // Find the player entity
      const player = bot.players[username];
      if (!player || !player.entity) {
        return factory.createResponse(`Player "${username}" not found or not in range. They may be too far away.`);
      }

      const goal = new goals.GoalFollow(player.entity, distance);
      bot.pathfinder.setGoal(goal, true); // dynamic: true — keeps updating

      // Follow for the duration, then stop
      await new Promise(resolve => setTimeout(resolve, maxDuration));
      bot.pathfinder.stop();

      const pos = bot.entity.position;
      return factory.createResponse(
        `Stopped following ${username} after ${(maxDuration / 1000).toFixed(0)}s. Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`
      );
    }
  );

  factory.registerTool(
    "stop-following",
    "Stop following a player or moving to a goal. Clears all pathfinder goals.",
    {},
    async () => {
      const bot = getBot();
      bot.pathfinder.stop();
      const pos = bot.entity.position;
      return factory.createResponse(
        `Stopped all movement. Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`
      );
    }
  );
}
