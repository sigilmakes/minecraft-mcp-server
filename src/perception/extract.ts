/**
 * Extract — bridge between mineflayer's bot and the perception system.
 *
 * Reads mineflayer's Bot object and produces the typed inputs
 * that soma, field, and narrative expect. This is the only module
 * in perception/ that imports mineflayer types.
 *
 * Kept thin on purpose: all intelligence lives in the channel
 * modules. This just reads sensors.
 */

import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Vec3 } from 'vec3';
import type { VitalSigns, ActiveEffect } from './soma.js';
import type { FieldInput, RawEntity, RawBlockScan, RawResource } from './field.js';
import type { RawContext } from './narrative.js';

// --- Effect name lookup ---
// Mineflayer gives effect IDs, not names. This maps the common ones.
const EFFECT_NAMES: Record<number, string> = {
  1: 'speed',
  2: 'slowness',
  3: 'haste',
  4: 'mining_fatigue',
  5: 'strength',
  6: 'instant_health',
  7: 'instant_damage',
  8: 'jump_boost',
  9: 'nausea',
  10: 'regeneration',
  11: 'resistance',
  12: 'fire_resistance',
  13: 'water_breathing',
  14: 'invisibility',
  15: 'blindness',
  16: 'night_vision',
  17: 'hunger',
  18: 'weakness',
  19: 'poison',
  20: 'wither',
  21: 'health_boost',
  22: 'absorption',
  23: 'saturation',
  24: 'glowing',
  25: 'levitation',
  26: 'luck',
  27: 'unluck',
};

// --- Ore / valuable block detection ---
const ORE_BLOCKS = new Set([
  'coal_ore', 'deepslate_coal_ore',
  'iron_ore', 'deepslate_iron_ore',
  'copper_ore', 'deepslate_copper_ore',
  'gold_ore', 'deepslate_gold_ore',
  'redstone_ore', 'deepslate_redstone_ore',
  'lapis_ore', 'deepslate_lapis_ore',
  'diamond_ore', 'deepslate_diamond_ore',
  'emerald_ore', 'deepslate_emerald_ore',
  'ancient_debris',
]);

// --- Direction helpers ---

function cardinalDirection(from: Vec3, to: Vec3): string {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  // Minecraft: -z = north, +z = south, +x = east, -x = west
  const angle = Math.atan2(dx, -dz) * (180 / Math.PI);
  const normalized = ((angle % 360) + 360) % 360;

  if (normalized < 22.5 || normalized >= 337.5) return 'north';
  if (normalized < 67.5) return 'northeast';
  if (normalized < 112.5) return 'east';
  if (normalized < 157.5) return 'southeast';
  if (normalized < 202.5) return 'south';
  if (normalized < 247.5) return 'southwest';
  if (normalized < 292.5) return 'west';
  return 'northwest';
}

// --- Vital Signs Extraction ---

/**
 * Extract vital signs from mineflayer bot.
 *
 * @param bot - mineflayer Bot instance
 * @param previousHealth - health value from last tick (to compute damageTaken)
 */
export function extractVitalSigns(bot: Bot, previousHealth: number | null): VitalSigns {
  const health = bot.health ?? 20;
  const food = bot.food ?? 20;
  const saturation = bot.foodSaturation ?? 5;
  const oxygen = bot.oxygenLevel ?? 300;

  // Damage taken = health drop since last tick (if positive)
  const damageTaken = previousHealth !== null
    ? Math.max(0, previousHealth - health)
    : 0;

  // Fire detection via metadata (metadata index 0, bit 0x01)
  // mineflayer doesn't expose isOnFire directly, check entity metadata
  const isOnFire = checkOnFire(bot);

  // Effects
  const effects: ActiveEffect[] = [];
  if (bot.entity?.effects) {
    for (const effect of bot.entity.effects) {
      const name = EFFECT_NAMES[effect.id] ?? `unknown_${effect.id}`;
      effects.push({
        name,
        amplifier: effect.amplifier,
        remainingTicks: effect.duration,
      });
    }
  }

  return { health, food, saturation, oxygen, damageTaken, isOnFire, effects };
}

function checkOnFire(bot: Bot): boolean {
  // Entity metadata index 0 is a bitfield. Bit 0x01 = on fire.
  const metadata = bot.entity?.metadata;
  if (metadata && Array.isArray(metadata) && typeof metadata[0] === 'number') {
    return (metadata[0] & 0x01) !== 0;
  }
  return false;
}

// --- Field Input Extraction ---

/**
 * Extract field (nearby world) data from mineflayer bot.
 *
 * @param bot - mineflayer Bot instance
 * @param entityRadius - max distance for entity scan (default 16)
 * @param resourceRadius - max distance for block scan (default 8)
 */
export function extractFieldInput(
  bot: Bot,
  entityRadius: number = 16,
  resourceRadius: number = 8,
): FieldInput {
  const entities = extractNearbyEntities(bot, entityRadius);
  const blocks = extractBlockScan(bot, resourceRadius);
  const lightLevel = extractLightLevel(bot);

  return { entities, blocks, lightLevel };
}

function extractNearbyEntities(bot: Bot, maxDistance: number): RawEntity[] {
  const result: RawEntity[] = [];
  const pos = bot.entity.position;

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;  // skip self
    if (!entity.position) continue;

    const dist = pos.distanceTo(entity.position);
    if (dist > maxDistance) continue;

    const type = entity.name ?? entity.type ?? 'unknown';
    const direction = cardinalDirection(pos, entity.position);

    result.push({
      type,
      name: entity.username ?? undefined,
      distance: dist,
      direction,
      health: entity.health ?? undefined,
    });
  }

  // Sort by distance (closest first) for consistency
  result.sort((a, b) => a.distance - b.distance);

  return result;
}

function extractBlockScan(bot: Bot, resourceRadius: number): RawBlockScan {
  const pos = bot.entity.position;

  // Block below feet
  const belowPos = pos.offset(0, -1, 0);
  const below = bot.blockAt(belowPos);
  const belowName = below?.name ?? 'unknown';

  // Block ahead (in look direction at eye level)
  const yaw = bot.entity.yaw;
  const lookX = -Math.sin(yaw);
  const lookZ = -Math.cos(yaw);
  const aheadPos = pos.offset(lookX * 2, 0, lookZ * 2);
  const ahead = bot.blockAt(aheadPos);
  const aheadName = ahead?.name ?? 'air';

  // Block above head
  const above = bot.blockAt(pos.offset(0, 2, 0));
  const aboveName = above?.name ?? 'air';

  // Scan for resources (ores) in radius
  const nearbyResources: RawResource[] = [];
  for (let dx = -resourceRadius; dx <= resourceRadius; dx++) {
    for (let dy = -resourceRadius; dy <= resourceRadius; dy++) {
      for (let dz = -resourceRadius; dz <= resourceRadius; dz++) {
        const checkPos = pos.offset(dx, dy, dz);
        const block = bot.blockAt(checkPos);
        if (block && ORE_BLOCKS.has(block.name)) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= resourceRadius) {
            nearbyResources.push({
              type: block.name,
              distance: dist,
              direction: cardinalDirection(pos, checkPos),
            });
          }
        }
      }
    }
  }

  // Deduplicate resources: keep only the closest of each type
  const closestByType = new Map<string, RawResource>();
  for (const res of nearbyResources) {
    const existing = closestByType.get(res.type);
    if (!existing || res.distance < existing.distance) {
      closestByType.set(res.type, res);
    }
  }

  // Check for shelter (enclosed space within 16 blocks)
  // Simple heuristic: is there a solid block above within 4 blocks?
  let shelterNearby = false;
  for (let dy = 1; dy <= 4; dy++) {
    const blockAbove = bot.blockAt(pos.offset(0, dy, 0));
    if (blockAbove && blockAbove.name !== 'air' && blockAbove.name !== 'cave_air') {
      shelterNearby = true;
      break;
    }
  }

  // Check for water nearby (within 8 blocks, same Y)
  let waterNearby = false;
  outer:
  for (let dx = -8; dx <= 8; dx += 2) {
    for (let dz = -8; dz <= 8; dz += 2) {
      const block = bot.blockAt(pos.offset(dx, 0, dz));
      if (block && block.name === 'water') {
        waterNearby = true;
        break outer;
      }
    }
  }

  return {
    below: belowName,
    ahead: aheadName,
    above: aboveName,
    nearbyResources: Array.from(closestByType.values()),
    shelterNearby,
    waterNearby,
  };
}

function extractLightLevel(bot: Bot): number {
  const pos = bot.entity.position;
  const block = bot.blockAt(pos);
  if (block && typeof block.light === 'number') {
    return block.light;
  }
  return 15;  // assume full light if can't read
}

// --- Context Extraction ---

/**
 * Extract narrative context from mineflayer bot.
 */
export function extractContext(bot: Bot): RawContext {
  const pos = bot.entity.position;

  // Biome from block at feet
  const block = bot.blockAt(pos.offset(0, -1, 0));
  const biome = block?.biome?.name ?? 'unknown';

  // Time of day
  const timeOfDay = bot.time?.timeOfDay ?? 6000;

  // Rain
  const isRaining = bot.isRaining ?? false;

  // Dimension
  const dimension = (bot as { game?: { dimension?: string } }).game?.dimension ?? 'overworld';

  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    biome,
    timeOfDay,
    isRaining,
    dimension,
  };
}
