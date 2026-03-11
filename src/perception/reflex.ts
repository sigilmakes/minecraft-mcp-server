/**
 * Reflex — autonomic responses that don't need the brain.
 *
 * The spinal cord. Stimulus → response. No deliberation.
 * Each reflex has a condition (read perception) and an action
 * (write to bot), plus a cooldown to prevent spam.
 *
 * Reflexes fire in priority order. Higher priority reflexes
 * suppress lower ones (you don't eat while fleeing a creeper).
 *
 * This is the thing that would have saved me from starving
 * to death on day 21.
 */

import type { Bot } from 'mineflayer';
import type { IntegratedPerception } from './integration.js';
import { log } from '../logger.js';

// mineflayer's Bot type doesn't expose sprint() in all versions
// but it exists at runtime. Cast through any where needed.
type AnyBot = Bot & { sprint?: (state: boolean) => void };

// --- Types ---

export interface Reflex {
  name: string;
  priority: number;         // higher = fires first, suppresses lower
  cooldownTicks: number;    // minimum ticks between firings
  condition: (perception: IntegratedPerception, bot: Bot) => boolean;
  action: (bot: Bot) => Promise<ReflexResult>;
}

export interface ReflexResult {
  success: boolean;
  detail: string;
  /** If true, suppress all lower-priority reflexes this tick */
  exclusive: boolean;
}

export interface ReflexLog {
  tick: number;
  reflex: string;
  result: ReflexResult;
}

// --- Food lookup (same priority as survival-tools) ---

const FOOD_PRIORITY: string[] = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_rabbit', 'cooked_cod',
  'baked_potato', 'bread', 'pumpkin_pie', 'mushroom_stew',
  'rabbit_stew', 'beetroot_soup', 'suspicious_stew',
  'apple', 'melon_slice', 'sweet_berries', 'glow_berries',
  'carrot', 'beetroot', 'dried_kelp', 'cookie',
  'potato', 'raw_beef', 'raw_porkchop', 'raw_mutton',
  'raw_chicken', 'raw_rabbit', 'raw_cod', 'raw_salmon',
  'rotten_flesh', 'spider_eye',
];

function findBestFood(bot: Bot): ReturnType<Bot['inventory']['items']>[number] | null {
  const inventory = bot.inventory.items();
  for (const foodName of FOOD_PRIORITY) {
    const item = inventory.find(i => i.name === foodName);
    if (item) return item;
  }
  return null;
}

// --- Hostile mob sets ---

const EXPLOSIVE = new Set(['creeper']);
const HOSTILE = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
  'enderman', 'blaze', 'ghast', 'magma_cube', 'wither_skeleton',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex',
  'piglin_brute', 'warden',
]);

// --- The Reflexes ---

/**
 * FLEE EXPLOSIVE — creeper within 8 blocks → sprint away.
 * Priority 100. Exclusive. Everything else waits.
 */
const fleeExplosive: Reflex = {
  name: 'flee-explosive',
  priority: 100,
  cooldownTicks: 5,
  condition: (perception, bot) => {
    // Check field attention for nearby creepers
    return perception.field.attention.some(item =>
      item.what.toLowerCase().includes('creeper') &&
      item.urgency > 0.3
    );
  },
  action: async (bot) => {
    const pos = bot.entity.position;

    // Find the creeper
    const creeper = bot.nearestEntity((e: any) =>
      EXPLOSIVE.has(e.name ?? '') &&
      e.position !== undefined &&
      pos.distanceTo(e.position) < 12
    );

    if (!creeper || !creeper.position) {
      return { success: false, detail: 'creeper gone', exclusive: false };
    }

    const dist = pos.distanceTo(creeper.position);

    // Sprint directly away from the creeper
    const dx = pos.x - creeper.position.x;
    const dz = pos.z - creeper.position.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;

    // Simple flee: sprint + forward controls in the away direction
    (bot as any).sprint(true);

    // Calculate yaw to look away from creeper
    const fleeYaw = Math.atan2(-(dx / len), -(dz / len));
    try {
      const fleeTarget = pos.offset((dx / len) * 15, 0, (dz / len) * 15);
      await bot.lookAt(fleeTarget);
    } catch {
      // lookAt might fail in tests — ok, keep going
    }

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);

    // Try pathfinder if available, otherwise just sprint forward
    try {
      const { goals } = await import('mineflayer-pathfinder');
      const fleeX = pos.x + (dx / len) * 15;
      const fleeZ = pos.z + (dz / len) * 15;
      bot.pathfinder.setGoal(new goals.GoalXZ(fleeX, fleeZ));
    } catch {
      // No pathfinder — sprinting forward is enough
    }

    // Run for 3 seconds then stop
    await new Promise(resolve => setTimeout(resolve, 3000));

    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    (bot as any).sprint(false);
    try { bot.pathfinder.stop(); } catch { /* noop */ }

    return {
      success: true,
      detail: `fled creeper (was ${Math.floor(dist)} blocks away)`,
      exclusive: true,
    };
  },
};

/**
 * SURFACE — oxygen ≤ 100 → swim up.
 * Priority 90. Exclusive.
 */
const surface: Reflex = {
  name: 'surface',
  priority: 90,
  cooldownTicks: 10,
  condition: (perception) => {
    return perception.soma.raw.oxygen <= 100;
  },
  action: async (bot) => {
    // Look straight up and jump repeatedly
    try {
      const pos = bot.entity.position;
      await bot.lookAt(pos.offset(0, 10, 0));
    } catch {
      // lookAt might fail — still try to surface
    }

    bot.setControlState('jump', true);
    bot.setControlState('forward', true);

    await new Promise(resolve => setTimeout(resolve, 3000));

    bot.setControlState('jump', false);
    bot.setControlState('forward', false);

    const oxygen = bot.oxygenLevel ?? 0;
    return {
      success: oxygen > 100,
      detail: `surfacing — oxygen now ${oxygen}`,
      exclusive: true,
    };
  },
};

/**
 * EAT — food ≤ 14 and has food → eat.
 * Priority 50. Not exclusive (can still look around while eating).
 *
 * Threshold of 14: natural health regen requires food > 17 (1.14+)
 * but we eat at 14 to maintain saturation buffer.
 * At food ≤ 6 this becomes urgent (declining soma).
 */
const eat: Reflex = {
  name: 'eat',
  priority: 50,
  cooldownTicks: 40,  // ~20 seconds at 2-tick interval. Don't spam.
  condition: (perception, bot) => {
    if (perception.soma.raw.food >= 14) return false;
    return findBestFood(bot) !== null;
  },
  action: async (bot) => {
    const food = findBestFood(bot);
    if (!food) {
      return { success: false, detail: 'no food found', exclusive: false };
    }

    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      return {
        success: true,
        detail: `ate ${food.name}. food: ${bot.food}/20`,
        exclusive: false,
      };
    } catch (err) {
      return {
        success: false,
        detail: `eat failed: ${err}`,
        exclusive: false,
      };
    }
  },
};

/**
 * SHIELD — taking damage from ranged attack → shield up.
 * Priority 70. Exclusive briefly.
 */
const shield: Reflex = {
  name: 'shield',
  priority: 70,
  cooldownTicks: 10,
  condition: (perception, bot) => {
    // Only if we have a shield and are taking damage
    if (perception.soma.raw.damageTaken <= 0) return false;

    const hasShield = bot.inventory.items().some(i => i.name === 'shield');
    if (!hasShield) return false;

    // Check for ranged threats (skeleton, etc.)
    return perception.field.attention.some(item =>
      (item.what.includes('skeleton') || item.what.includes('stray') ||
       item.what.includes('pillager') || item.what.includes('blaze')) &&
      item.urgency > 0.2
    );
  },
  action: async (bot) => {
    const shieldItem = bot.inventory.items().find(i => i.name === 'shield');
    if (!shieldItem) {
      return { success: false, detail: 'no shield', exclusive: false };
    }

    try {
      await bot.equip(shieldItem, 'off-hand');
      // Activate shield (right-click / use)
      bot.activateItem(true); // offhand

      // Hold for 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      bot.deactivateItem();

      return {
        success: true,
        detail: 'shield raised for 2s',
        exclusive: true,
      };
    } catch (err) {
      return {
        success: false,
        detail: `shield failed: ${err}`,
        exclusive: false,
      };
    }
  },
};

// --- Reflex Engine ---

/** All registered reflexes, sorted by priority (highest first) */
const ALL_REFLEXES: Reflex[] = [
  fleeExplosive,
  surface,
  shield,
  eat,
].sort((a, b) => b.priority - a.priority);

/**
 * ReflexEngine — runs reflexes each tick against the current perception.
 *
 * Maintains cooldown timers. Respects priority ordering.
 * Returns a log of what fired.
 */
export class ReflexEngine {
  private cooldowns: Map<string, number> = new Map();
  private recentLogs: ReflexLog[] = [];
  private maxLogs: number = 50;
  private enabled: boolean = true;

  /** Run all eligible reflexes for this tick. */
  async run(
    perception: IntegratedPerception,
    bot: Bot,
    tickCount: number,
  ): Promise<ReflexLog[]> {
    if (!this.enabled) return [];

    const fired: ReflexLog[] = [];

    for (const reflex of ALL_REFLEXES) {
      // Check cooldown
      const lastFired = this.cooldowns.get(reflex.name) ?? -Infinity;
      if (tickCount - lastFired < reflex.cooldownTicks) continue;

      // Check condition
      try {
        if (!reflex.condition(perception, bot)) continue;
      } catch (err) {
        log('warn', `reflex ${reflex.name} condition error: ${err}`);
        continue;
      }

      // Fire!
      log('info', `reflex firing: ${reflex.name}`);

      try {
        const result = await reflex.action(bot);
        this.cooldowns.set(reflex.name, tickCount);

        const entry: ReflexLog = { tick: tickCount, reflex: reflex.name, result };
        fired.push(entry);
        this.recentLogs.push(entry);

        if (this.recentLogs.length > this.maxLogs) {
          this.recentLogs.shift();
        }

        log('info', `reflex ${reflex.name}: ${result.detail}`);

        // If exclusive, stop processing lower-priority reflexes
        if (result.exclusive) break;
      } catch (err) {
        log('error', `reflex ${reflex.name} action error: ${err}`);
      }
    }

    return fired;
  }

  /** Get recent reflex log entries. */
  getRecentLogs(count: number = 10): ReflexLog[] {
    return this.recentLogs.slice(-count);
  }

  /** Enable/disable the reflex system. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    log('info', `reflexes ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** Is the reflex system enabled? */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Reset all cooldowns. */
  resetCooldowns(): void {
    this.cooldowns.clear();
  }
}
