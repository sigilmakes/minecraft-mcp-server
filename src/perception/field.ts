/**
 * Field — the attention channel.
 *
 * What's around me, filtered through soma. Not a flat list of entities
 * and blocks — a prioritized attention map where urgency depends on
 * body state.
 *
 * A creeper 5 blocks away when health=4 is everything.
 * A creeper 5 blocks away when health=20 is manageable.
 * Diamond ore while fleeing is invisible.
 *
 * This is opponent processing: Field × Soma = urgency.
 *
 * Pure functions. No mineflayer dependency. Testable standalone.
 */

import type { SomaLevel, SomaBottleneck } from './soma.js';

// --- Types ---

/** Raw entity data from the bot */
export interface RawEntity {
  type: string;         // 'zombie', 'cow', 'player', 'creeper', etc.
  name?: string;        // player name, if applicable
  distance: number;     // blocks from player
  direction: string;    // 'north', 'northeast', etc.
  health?: number;
}

/** Raw block scan around the player */
export interface RawBlockScan {
  below: string;           // block under feet
  ahead: string;           // block in look direction at eye level
  above: string;           // block above head
  nearbyResources: RawResource[];
  shelterNearby: boolean;  // enclosed space within 16 blocks
  waterNearby: boolean;    // water within 8 blocks
}

export interface RawResource {
  type: string;         // 'iron_ore', 'coal_ore', 'diamond_ore', etc.
  distance: number;
  direction: string;
}

/** Field input: everything collected from the world this tick */
export interface FieldInput {
  entities: RawEntity[];
  blocks: RawBlockScan;
  lightLevel: number;        // 0-15
}

/** Soma context needed for urgency calculation */
export interface SomaContext {
  level: SomaLevel;
  bottleneck: SomaBottleneck;
}

/** A single item in the attention map */
export interface FieldItem {
  what: string;
  where: string;
  urgency: number;      // 0-1
  actionHint: string;   // 'flee', 'hunt', 'mine', 'approach', 'ignore'
  category: 'threat' | 'food' | 'resource' | 'shelter' | 'player' | 'neutral';
}

/** The integrated field state */
export interface FieldState {
  attention: FieldItem[];    // sorted by urgency, max 5
  threatLevel: ThreatLevel;
  opportunity: string | null;
  terrain: string;
  detail: string;
}

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'extreme';

// --- Entity Classification ---

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray', 'blaze',
  'ghast', 'magma_cube', 'piglin_brute', 'warden', 'ravager', 'vex',
  'vindicator', 'evoker', 'pillager', 'guardian', 'elder_guardian',
  'zombified_piglin', 'hoglin', 'wither_skeleton', 'silverfish',
]);

const FOOD_ANIMALS = new Set([
  'cow', 'pig', 'chicken', 'sheep', 'rabbit', 'mooshroom',
  'salmon', 'cod', 'tropical_fish',
]);

const TAMEABLE = new Set(['wolf', 'cat', 'horse', 'donkey', 'llama', 'parrot']);

const VALUABLE_RESOURCES = new Set([
  'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
  'ancient_debris', 'gold_ore', 'deepslate_gold_ore',
]);

const USEFUL_RESOURCES = new Set([
  'iron_ore', 'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore',
  'copper_ore', 'deepslate_copper_ore', 'lapis_ore', 'deepslate_lapis_ore',
  'redstone_ore', 'deepslate_redstone_ore',
]);

// --- Core Logic ---

/**
 * Classify an entity into a field item with urgency score.
 */
export function classifyEntity(
  entity: RawEntity,
  soma: SomaContext
): FieldItem {
  const isHostile = HOSTILE_MOBS.has(entity.type);
  const isFood = FOOD_ANIMALS.has(entity.type);
  const isPlayer = entity.type === 'player';

  if (isHostile) {
    return {
      what: entity.type,
      where: `${Math.floor(entity.distance)} blocks ${entity.direction}`,
      urgency: computeThreatUrgency(entity, soma),
      actionHint: computeThreatAction(entity, soma),
      category: 'threat',
    };
  }

  if (isFood) {
    return {
      what: entity.type,
      where: `${Math.floor(entity.distance)} blocks ${entity.direction}`,
      urgency: computeFoodUrgency(entity, soma),
      actionHint: soma.bottleneck === 'food' ? 'hunt' : 'ignore',
      category: 'food',
    };
  }

  if (isPlayer) {
    return {
      what: entity.name || 'player',
      where: `${Math.floor(entity.distance)} blocks ${entity.direction}`,
      urgency: 0.4,  // players are always somewhat relevant
      actionHint: 'approach',
      category: 'player',
    };
  }

  // Neutral entity (item frames, armor stands, passive mobs, etc.)
  return {
    what: entity.type,
    where: `${Math.floor(entity.distance)} blocks ${entity.direction}`,
    urgency: 0.05,
    actionHint: 'ignore',
    category: 'neutral',
  };
}

/**
 * Classify a resource block into a field item.
 */
export function classifyResource(
  resource: RawResource,
  soma: SomaContext
): FieldItem {
  const isValuable = VALUABLE_RESOURCES.has(resource.type);
  const isUseful = USEFUL_RESOURCES.has(resource.type);

  // Resources become invisible during crisis
  const crisisMultiplier =
    soma.level === 'dying' ? 0 :
    soma.level === 'critical' ? 0.1 :
    soma.level === 'declining' ? 0.5 : 1;

  const baseUrgency = isValuable ? 0.7 : isUseful ? 0.4 : 0.15;
  const distanceFactor = Math.max(0, 1 - resource.distance / 16);

  return {
    what: resource.type.replace(/_/g, ' '),
    where: `${Math.floor(resource.distance)} blocks ${resource.direction}`,
    urgency: baseUrgency * distanceFactor * crisisMultiplier,
    actionHint: crisisMultiplier > 0.3 ? 'mine' : 'ignore',
    category: 'resource',
  };
}

/**
 * Threat urgency: how much should I worry about this hostile entity?
 *
 * Opponent processing: threat × body state = urgency.
 * Same creeper, different body, different urgency.
 */
function computeThreatUrgency(entity: RawEntity, soma: SomaContext): number {
  // Base threat from entity type
  const baseThreat = getBaseThreat(entity.type);

  // Proximity multiplier (inverse square-ish, capped)
  const proximity = Math.min(1, 4 / Math.max(entity.distance, 0.5));

  // Body state amplifier — threats matter MORE when you're weak
  const bodyMultiplier =
    soma.level === 'dying' ? 2.0 :
    soma.level === 'critical' ? 1.5 :
    soma.level === 'declining' ? 1.2 :
    soma.level === 'stable' ? 1.0 :
    0.7;  // thriving — threats are manageable

  return Math.min(1, baseThreat * proximity * bodyMultiplier);
}

function getBaseThreat(type: string): number {
  // Creepers are the scariest because they explode with no warning
  if (type === 'creeper') return 0.9;
  if (type === 'warden') return 1.0;
  if (type === 'wither_skeleton') return 0.7;
  if (type === 'skeleton') return 0.6;  // ranged is dangerous
  if (type === 'zombie') return 0.4;
  if (type === 'spider') return 0.4;
  if (type === 'enderman') return 0.3;  // neutral unless provoked
  if (type === 'slime') return 0.2;
  return 0.5;  // default for unknown hostiles
}

/**
 * What to do about a threat, given body state.
 */
function computeThreatAction(entity: RawEntity, soma: SomaContext): string {
  const urgency = computeThreatUrgency(entity, soma);

  // Always flee from creepers at close range
  if (entity.type === 'creeper' && entity.distance < 5) return 'flee';

  // Flee when body is weak
  if (soma.level === 'dying' || soma.level === 'critical') return 'flee';

  // Fight or avoid based on urgency
  if (urgency > 0.7) return 'flee';
  if (urgency > 0.4 && entity.distance < 8) return 'fight';
  if (entity.distance > 12) return 'ignore';
  return 'avoid';
}

/**
 * Food urgency: how much does this food source matter?
 *
 * Opponent processing: food × body state = urgency.
 * A cow when you're starving is a lifeline. A cow when you're full is scenery.
 */
function computeFoodUrgency(entity: RawEntity, soma: SomaContext): number {
  const proximity = Math.min(1, 8 / Math.max(entity.distance, 0.5));

  // Food urgency scales dramatically with hunger
  const hungerMultiplier =
    soma.bottleneck === 'food' && soma.level === 'critical' ? 1.0 :
    soma.bottleneck === 'food' && soma.level === 'declining' ? 0.8 :
    soma.bottleneck === 'food' ? 0.5 :
    soma.level === 'stable' ? 0.15 :
    0.05;  // thriving — food is irrelevant

  return Math.min(1, proximity * hungerMultiplier);
}

// --- Terrain Description ---

export function describeTerrain(blocks: RawBlockScan, lightLevel: number): string {
  const parts: string[] = [];

  // Ground type
  const ground = blocks.below;
  if (ground.includes('grass') || ground.includes('dirt')) parts.push('grassland');
  else if (ground.includes('stone') || ground.includes('deepslate')) parts.push('underground');
  else if (ground.includes('sand')) parts.push('desert/beach');
  else if (ground.includes('water')) parts.push('water');
  else if (ground.includes('wood') || ground.includes('plank')) parts.push('structure');
  else parts.push(ground.replace(/_/g, ' '));

  // Light
  if (lightLevel <= 7) parts.push('dark');
  else if (lightLevel <= 11) parts.push('dim');

  // Features
  if (blocks.shelterNearby) parts.push('shelter nearby');
  if (blocks.waterNearby) parts.push('water nearby');

  return parts.join(', ');
}

// --- Main Processing ---

/**
 * Process one tick of field data into an integrated field state.
 *
 * Attention is limited to 5 items. The mantis shrimp has 12 detectors
 * and can't tell blue from grey. We have 5 and know what matters.
 */
export function processField(
  input: FieldInput,
  soma: SomaContext
): FieldState {
  // Classify all entities and resources
  const items: FieldItem[] = [];

  for (const entity of input.entities) {
    items.push(classifyEntity(entity, soma));
  }

  for (const resource of input.blocks.nearbyResources) {
    items.push(classifyResource(resource, soma));
  }

  // Shelter becomes an item when body is declining+
  if (input.blocks.shelterNearby && (
    soma.level === 'declining' || soma.level === 'critical' || soma.level === 'dying'
  )) {
    items.push({
      what: 'shelter',
      where: 'nearby',
      urgency: soma.level === 'critical' ? 0.9 : 0.5,
      actionHint: 'approach',
      category: 'shelter',
    });
  }

  // Sort by urgency, take top 5
  items.sort((a, b) => b.urgency - a.urgency);
  const attention = items.slice(0, 5);

  // Compute threat level from threats in attention
  const threats = attention.filter(i => i.category === 'threat');
  const maxThreatUrgency = threats.length > 0
    ? Math.max(...threats.map(t => t.urgency))
    : 0;

  const threatLevel: ThreatLevel =
    maxThreatUrgency > 0.8 ? 'extreme' :
    maxThreatUrgency > 0.6 ? 'high' :
    maxThreatUrgency > 0.3 ? 'medium' :
    maxThreatUrgency > 0.1 ? 'low' :
    'none';

  // Find best opportunity (highest urgency non-threat)
  const opportunities = attention.filter(i =>
    i.category !== 'threat' && i.category !== 'neutral' && i.urgency > 0.2
  );
  const opportunity = opportunities.length > 0
    ? `${opportunities[0]!.actionHint} ${opportunities[0]!.what} (${opportunities[0]!.where})`
    : null;

  // Terrain description
  const terrain = describeTerrain(input.blocks, input.lightLevel);

  // Detail string
  const detail = formatFieldDetail(attention, threatLevel, opportunity, terrain);

  return { attention, threatLevel, opportunity, terrain, detail };
}

function formatFieldDetail(
  attention: FieldItem[],
  threatLevel: ThreatLevel,
  opportunity: string | null,
  terrain: string
): string {
  if (attention.length === 0 || attention.every(i => i.urgency < 0.1)) {
    return `${terrain}. quiet — nothing demands attention.`;
  }

  const parts: string[] = [`${terrain}.`];

  if (threatLevel !== 'none') {
    const threats = attention.filter(i => i.category === 'threat');
    parts.push(`threat: ${threats.map(t => `${t.what} ${t.where}`).join(', ')}.`);
  }

  if (opportunity) {
    parts.push(`opportunity: ${opportunity}.`);
  }

  // Mention any other notable items
  const other = attention.filter(i =>
    i.category !== 'threat' && i.urgency > 0.2 &&
    !(i.category === 'food' && opportunity?.includes(i.what)) &&
    !(i.category === 'resource' && opportunity?.includes(i.what))
  );
  for (const item of other) {
    parts.push(`${item.what} ${item.where}.`);
  }

  return parts.join(' ');
}
