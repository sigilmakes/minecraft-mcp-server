/**
 * Perception tools — expose the body's senses as MCP tools.
 *
 * These are the eyes. Call get_perception to see the world
 * through three channels + three cross-signals. Call get_reflexes
 * to see what the autonomic system has been doing.
 *
 * The perception engine runs on-demand (when you call the tool)
 * rather than in a background loop. The reflex engine integrates
 * with it when the game loop runs.
 */

import { z } from 'zod';
import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';
import { PerceptionEngine } from '../perception/tick.js';
import { ReflexEngine } from '../perception/reflex.js';

// Singleton instances — shared across tools and game loop
let perceptionEngine: PerceptionEngine | null = null;
let reflexEngine: ReflexEngine | null = null;

export function getPerceptionEngine(): PerceptionEngine {
  if (!perceptionEngine) {
    perceptionEngine = new PerceptionEngine();
  }
  return perceptionEngine;
}

export function getReflexEngine(): ReflexEngine {
  if (!reflexEngine) {
    reflexEngine = new ReflexEngine();
  }
  return reflexEngine;
}

export function registerPerceptionTools(
  factory: ToolFactory,
  getBot: () => mineflayer.Bot,
): void {

  factory.registerTool(
    'get_perception',
    'See the world through the body\'s three perception channels (soma/field/narrative) plus three cross-channel signals (urgency/relevance/momentum). Returns an integrated view of what\'s happening right now.',
    {
      setHome: z.boolean().optional().describe('If true, set current position as home base for narrative tracking'),
      setGoal: z.string().optional().describe('Set a goal the body is pursuing (e.g. "mine iron", "find food")'),
      clearGoal: z.boolean().optional().describe('Clear the current goal'),
    },
    async ({ setHome, setGoal, clearGoal }: {
      setHome?: boolean;
      setGoal?: string;
      clearGoal?: boolean;
    }) => {
      const bot = getBot();
      const engine = getPerceptionEngine();

      // Handle goal management
      if (setHome) {
        const pos = bot.entity.position;
        engine.setHome({ x: pos.x, y: pos.y, z: pos.z });
      }
      if (setGoal) {
        engine.setGoal(setGoal);
      }
      if (clearGoal) {
        engine.clearGoal();
      }

      // Run one tick
      const perception = engine.tick(bot);

      // Format output
      const lines: string[] = [];

      lines.push('=== PERCEPTION ===');
      lines.push('');

      // Three channels
      lines.push(`SOMA: ${perception.soma.level} — ${perception.soma.detail}`);
      lines.push(`FIELD: ${perception.field.detail}`);
      lines.push(`NARRATIVE: ${perception.narrative.detail}`);
      lines.push('');

      // Cross-channel signals
      lines.push(`URGENCY: [${perception.urgency.level}] ${perception.urgency.summary}`);
      lines.push(`RELEVANCE: [${perception.relevance.level}] ${perception.relevance.summary}`);
      lines.push(`MOMENTUM: [${perception.momentum.level}] ${perception.momentum.summary}`);
      lines.push('');

      // Attention items
      if (perception.field.attention.length > 0) {
        lines.push('ATTENTION:');
        for (const item of perception.field.attention) {
          lines.push(`  ${item.what} — ${item.where} [${item.category}, urgency ${item.urgency.toFixed(2)}]`);
        }
        lines.push('');
      }

      // Brain call decision
      if (perception.shouldCallBrain) {
        lines.push(`→ BRAIN CALL: ${perception.callReason}`);
      } else {
        lines.push(`→ No brain call needed (tick ${engine.getTickCount()})`);
      }

      // Reflexes status
      const reflex = getReflexEngine();
      const recent = reflex.getRecentLogs(3);
      if (recent.length > 0) {
        lines.push('');
        lines.push('RECENT REFLEXES:');
        for (const log of recent) {
          lines.push(`  [tick ${log.tick}] ${log.reflex}: ${log.result.detail}`);
        }
      }

      return factory.createResponse(lines.join('\n'));
    },
  );

  factory.registerTool(
    'get_reflexes',
    'View the autonomic reflex system — recent activity, what\'s enabled, cooldown status.',
    {
      count: z.number().optional().describe('Number of recent reflex logs to show (default: 10)'),
      toggle: z.boolean().optional().describe('Enable (true) or disable (false) the reflex system'),
    },
    async ({ count = 10, toggle }: { count?: number; toggle?: boolean }) => {
      const reflex = getReflexEngine();

      if (toggle !== undefined) {
        reflex.setEnabled(toggle);
      }

      const lines: string[] = [];
      lines.push(`=== REFLEXES ${reflex.isEnabled() ? '(ENABLED)' : '(DISABLED)'} ===`);
      lines.push('');
      lines.push('Available reflexes (priority order):');
      lines.push('  100: flee-explosive — sprint away from creepers');
      lines.push('   90: surface — swim up when drowning');
      lines.push('   70: shield — block ranged attacks');
      lines.push('   50: eat — eat when food < 14');
      lines.push('');

      const logs = reflex.getRecentLogs(count);
      if (logs.length > 0) {
        lines.push(`Recent activity (last ${logs.length}):`)
        for (const log of logs) {
          const status = log.result.success ? '✓' : '✗';
          lines.push(`  ${status} [tick ${log.tick}] ${log.reflex}: ${log.result.detail}`);
        }
      } else {
        lines.push('No recent reflex activity.');
      }

      return factory.createResponse(lines.join('\n'));
    },
  );
}
