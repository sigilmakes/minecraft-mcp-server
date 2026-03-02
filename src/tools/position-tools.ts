import { z } from "zod";
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;
import { Vec3 } from 'vec3';
import { ToolFactory } from '../tool-factory.js';
import { coerceCoordinates } from './coordinate-utils.js';

type Direction = 'forward' | 'back' | 'left' | 'right';

export function registerPositionTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  factory.registerTool(
    "get-position",
    "Get the current position of the bot",
    {},
    async () => {
      const bot = getBot();
      const position = bot.entity.position;
      const pos = {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z)
      };
      return factory.createResponse(`Current position: (${pos.x}, ${pos.y}, ${pos.z})`);
    }
  );

  factory.registerTool(
    "move-to-position",
    "Move the bot to a specific position",
    {
      x: z.coerce.number().describe("X coordinate"),
      y: z.coerce.number().describe("Y coordinate"),
      z: z.coerce.number().describe("Z coordinate"),
      range: z.coerce.number().finite().optional().describe("How close to get to the target (default: 1)"),
      timeoutMs: z.number().int().min(50).optional().describe("Timeout in milliseconds before cancelling (min: 50, default: no timeout)")
    },
    async ({ x, y, z, range = 1, timeoutMs }: { x: number; y: number; z: number; range?: number; timeoutMs?: number }) => {
      ({ x, y, z } = coerceCoordinates(x, y, z));

      const bot = getBot();
      const goal = new goals.GoalNear(x, y, z, range);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timeoutPromise: Promise<never> | null = null;
      let timedOut = false;

      if (timeoutMs !== undefined) {
        timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Move timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });
      }

      const gotoPromise = bot.pathfinder.goto(goal);

      try {
        if (timeoutPromise) {
          await Promise.race([gotoPromise, timeoutPromise]);
        } else {
          await gotoPromise;
        }
        return factory.createResponse(`Successfully moved to position near (${x}, ${y}, ${z})`);
      } catch (error) {
        if (timedOut) {
          throw new Error(`Move timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (timedOut) {
          bot.pathfinder.stop();
          gotoPromise.catch(() => {});
        }
      }
    }
  );

  factory.registerTool(
    "look-at",
    "Make the bot look at a specific position",
    {
      x: z.coerce.number().describe("X coordinate"),
      y: z.coerce.number().describe("Y coordinate"),
      z: z.coerce.number().describe("Z coordinate"),
    },
    async ({ x, y, z }) => {
      ({ x, y, z } = coerceCoordinates(x, y, z));

      const bot = getBot();
      await bot.lookAt(new Vec3(x, y, z), true);
      return factory.createResponse(`Looking at position (${x}, ${y}, ${z})`);
    }
  );

  factory.registerTool(
    "jump",
    "Make the bot jump",
    {},
    async () => {
      const bot = getBot();
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 250);
      return factory.createResponse("Successfully jumped");
    }
  );

  factory.registerTool(
    "move-in-direction",
    "Move the bot in a specific direction for a duration. Automatically sprint-jumps to clear 1-block obstacles. Reports if the bot got stuck.",
    {
      direction: z.enum(['forward', 'back', 'left', 'right']).describe("Direction to move"),
      duration: z.number().optional().describe("Duration in milliseconds (default: 1000)")
    },
    async ({ direction, duration = 1000 }: { direction: Direction, duration?: number }) => {
      const bot = getBot();
      const startPos = bot.entity.position.clone();

      return new Promise((resolve) => {
        bot.setControlState(direction, true);
        bot.setControlState('sprint', true);

        // Check for stuck every 500ms and try jumping to clear obstacles
        let stuckChecks = 0;
        let lastCheckPos = startPos.clone();
        const stuckInterval = setInterval(() => {
          const currentPos = bot.entity.position;
          const movedSinceCheck = currentPos.distanceTo(lastCheckPos);
          if (movedSinceCheck < 0.1) {
            // Not moving — try jumping to clear a 1-block step
            stuckChecks++;
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 250);
          } else {
            stuckChecks = 0;
          }
          lastCheckPos = currentPos.clone();
        }, 500);

        setTimeout(() => {
          clearInterval(stuckInterval);
          bot.setControlState(direction, false);
          bot.setControlState('sprint', false);
          bot.setControlState('jump', false);

          const endPos = bot.entity.position;
          const totalDist = startPos.distanceTo(endPos);
          const pos = `(${Math.floor(endPos.x)}, ${Math.floor(endPos.y)}, ${Math.floor(endPos.z)})`;

          if (totalDist < 0.5) {
            resolve(factory.createResponse(
              `Stuck! Moved ${direction} for ${duration}ms but didn't go anywhere. Position: ${pos}. Try pathfinding to a different location or use unstuck.`
            ));
          } else {
            resolve(factory.createResponse(
              `Moved ${direction} for ${duration}ms (${totalDist.toFixed(1)} blocks). Position: ${pos}`
            ));
          }
        }, duration);
      });
    }
  );

  factory.registerTool(
    "unstuck",
    "Emergency recovery when the bot is stuck. Stops all movement, clears pathfinder, and attempts to free the bot by jumping and moving randomly.",
    {},
    async () => {
      const bot = getBot();

      // Stop everything
      const controls: Direction[] = ['forward', 'back', 'left', 'right'];
      for (const ctrl of controls) {
        bot.setControlState(ctrl, false);
      }
      bot.setControlState('sprint', false);
      bot.setControlState('jump', false);
      bot.setControlState('sneak', false);
      bot.pathfinder.stop();

      const startPos = bot.entity.position.clone();

      // Try jumping
      bot.setControlState('jump', true);
      await new Promise(r => setTimeout(r, 300));
      bot.setControlState('jump', false);
      await new Promise(r => setTimeout(r, 200));

      // Try moving in a random direction while jumping
      const dirs: Direction[] = ['forward', 'back', 'left', 'right'];
      for (const dir of dirs) {
        bot.setControlState(dir, true);
        bot.setControlState('jump', true);
        await new Promise(r => setTimeout(r, 400));
        bot.setControlState(dir, false);
        bot.setControlState('jump', false);
        await new Promise(r => setTimeout(r, 100));

        const moved = bot.entity.position.distanceTo(startPos);
        if (moved > 1.0) {
          const pos = bot.entity.position;
          return factory.createResponse(
            `Unstuck! Moved ${moved.toFixed(1)} blocks by jumping ${dir}. Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`
          );
        }
      }

      // Still stuck — report
      const pos = bot.entity.position;
      const moved = pos.distanceTo(startPos);
      return factory.createResponse(
        `Recovery attempted but bot may still be stuck (moved ${moved.toFixed(1)} blocks). Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}). May need to teleport or dig out.`
      );
    }
  );
}
