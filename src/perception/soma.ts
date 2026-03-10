/**
 * Soma — the body state channel.
 *
 * Integrates health, food, saturation, oxygen, and damage into a single
 * gradient with trend detection. The brain doesn't need to know
 * "health=14, food=8, saturation=2.5." It needs to know:
 * "I'm declining — food is the bottleneck."
 *
 * Inspired by opponent processing in color vision: three cone types
 * produce richer perception than twelve independent detectors because
 * the meaning is in the ratios, not the raw values.
 *
 * Pure functions. No mineflayer dependency. Testable standalone.
 */

// --- Types ---

/** Raw vital signs from the bot, collected each tick */
export interface VitalSigns {
  health: number;       // 0-20
  food: number;         // 0-20
  saturation: number;   // 0-20 (hidden in vanilla, exposed by mineflayer)
  oxygen: number;       // 0-300 ticks (300 = full, depletes underwater)
  damageTaken: number;  // damage received since last tick
  isOnFire: boolean;
  effects: ActiveEffect[];
}

export interface ActiveEffect {
  name: string;          // 'poison', 'regeneration', 'hunger', etc.
  amplifier: number;     // 0 = level I, 1 = level II, etc.
  remainingTicks: number;
}

/** The integrated soma state — what the brain sees */
export interface SomaState {
  level: SomaLevel;
  bottleneck: SomaBottleneck;
  trend: SomaTrend;
  detail: string;
  raw: VitalSigns;
}

export type SomaLevel = 'thriving' | 'stable' | 'declining' | 'critical' | 'dying';
export type SomaBottleneck = 'none' | 'food' | 'health' | 'oxygen' | 'damage' | 'fire' | 'poison';
export type SomaTrend = 'improving' | 'stable' | 'worsening';

// --- Ring Buffer for Trend Detection ---

export class SomaHistory {
  private history: VitalSigns[] = [];
  private maxLength: number;

  constructor(maxLength: number = 10) {
    this.maxLength = maxLength;
  }

  push(vitals: VitalSigns): void {
    this.history.push(vitals);
    if (this.history.length > this.maxLength) {
      this.history.shift();
    }
  }

  /** Get vitals from N ticks ago (0 = current, 1 = last tick, etc.) */
  ago(n: number): VitalSigns | null {
    const idx = this.history.length - 1 - n;
    return idx >= 0 ? this.history[idx]! : null;
  }

  get length(): number {
    return this.history.length;
  }

  clear(): void {
    this.history = [];
  }
}

// --- Core Logic ---

/**
 * Compute soma level from current vital signs.
 *
 * The level is a single gradient that integrates all vitals.
 * Minecraft's mechanics already couple these (food drives regen,
 * oxygen drives drowning damage), so we follow that coupling.
 */
export function computeLevel(v: VitalSigns): SomaLevel {
  // Dying: immediate death risk
  if (v.health <= 0) return 'dying';
  if (v.health <= 2) return 'dying';      // one hit from death
  if (v.oxygen <= 0) return 'dying';       // actively drowning

  // Critical: serious danger, reflexes should fire
  if (v.health <= 6) return 'critical';    // 3 hearts or less
  if (v.food <= 0) return 'critical';      // starving (taking damage)
  if (v.oxygen <= 60) return 'critical';   // ~3 seconds of air left
  if (v.isOnFire && v.health <= 10) return 'critical';
  if (hasEffect(v, 'poison') && v.health <= 8) return 'critical';

  // Declining: needs attention soon
  if (v.health <= 10 && v.food <= 6) return 'declining';  // low health AND low food
  if (v.food <= 6) return 'declining';     // food dropping, regen will stop soon
  if (v.health <= 10) return 'declining';  // took damage, not regenerating fast
  if (v.oxygen <= 150) return 'declining'; // half air
  if (v.isOnFire) return 'declining';
  if (hasEffect(v, 'poison')) return 'declining';
  if (hasEffect(v, 'hunger')) return 'declining';

  // Stable: fine but not full
  if (v.health < 20 || v.food < 18) return 'stable';

  // Thriving: everything full, regenerating, safe
  return 'thriving';
}

/**
 * Identify the primary bottleneck — what's limiting the body most.
 */
export function computeBottleneck(v: VitalSigns): SomaBottleneck {
  // Active damage sources take priority
  if (v.damageTaken > 0) return 'damage';
  if (v.isOnFire) return 'fire';
  if (v.oxygen <= 150) return 'oxygen';
  if (hasEffect(v, 'poison')) return 'poison';

  // Food drives health regen — if food is low, that's the root cause
  // of health not recovering
  if (v.food <= 6) return 'food';
  if (v.health <= 10 && v.food <= 14) return 'food';  // food not high enough to regen
  if (v.health <= 10) return 'health';  // health low but food is okay — took damage

  return 'none';
}

/**
 * Detect trend by comparing current vitals to N ticks ago.
 *
 * Uses a composite "wellness score" rather than comparing individual
 * fields — this is the integration. A body where health dropped but
 * food rose might be stable overall (just ate, healing from damage).
 */
export function computeTrend(current: VitalSigns, history: SomaHistory): SomaTrend {
  // Need at least 3 ticks of history for meaningful trend
  if (history.length < 3) return 'stable';

  const past = history.ago(Math.min(4, history.length - 1));
  if (!past) return 'stable';

  const currentScore = wellnessScore(current);
  const pastScore = wellnessScore(past);
  const delta = currentScore - pastScore;

  // Threshold: small changes are noise, not trend
  if (delta > 3) return 'improving';
  if (delta < -3) return 'worsening';
  return 'stable';
}

/**
 * Composite wellness score. Weights reflect Minecraft's coupling:
 * food matters most (it drives everything else), health second,
 * oxygen only when relevant.
 */
function wellnessScore(v: VitalSigns): number {
  let score = 0;

  // Food (0-20) weighted heavily — it's the engine
  score += v.food * 3;  // 0-60

  // Health (0-20) — the actual HP
  score += v.health * 2;  // 0-40

  // Saturation bonus — hidden but affects regen speed
  score += v.saturation * 0.5;  // 0-10

  // Oxygen only counts when depleted
  if (v.oxygen < 300) {
    score -= (300 - v.oxygen) * 0.1;  // penalty up to -30
  }

  // Active damage is a strong negative signal
  score -= v.damageTaken * 5;

  // Fire and poison
  if (v.isOnFire) score -= 15;
  if (hasEffect(v, 'poison')) score -= 10;
  if (hasEffect(v, 'hunger')) score -= 5;

  // Regen is a positive signal
  if (hasEffect(v, 'regeneration')) score += 10;

  return score;
}

/**
 * Format soma state as a human-readable detail string.
 * This is what appears in the brain prompt.
 */
function formatDetail(v: VitalSigns, level: SomaLevel, bottleneck: SomaBottleneck, trend: SomaTrend): string {
  const parts: string[] = [];

  // Only mention things that deviate from "everything's fine"
  if (level === 'thriving') {
    return 'full health, well fed, no threats to body.';
  }

  // Health
  if (v.health < 20) {
    parts.push(`health ${v.health}/20`);
  }

  // Food
  if (v.food < 20) {
    parts.push(`food ${v.food}/20`);
    if (v.saturation > 0 && v.food < 14) {
      parts.push(`saturation ${v.saturation.toFixed(1)}`);
    }
  }

  // Oxygen
  if (v.oxygen < 300) {
    const seconds = Math.floor(v.oxygen / 20);
    parts.push(`${seconds}s of air`);
  }

  // Status effects
  if (v.isOnFire) parts.push('on fire');
  for (const e of v.effects) {
    if (['poison', 'hunger', 'wither', 'weakness'].includes(e.name)) {
      const secs = Math.floor(e.remainingTicks / 20);
      parts.push(`${e.name} (${secs}s)`);
    }
    if (e.name === 'regeneration') {
      parts.push('regenerating');
    }
  }

  // Damage
  if (v.damageTaken > 0) {
    parts.push(`took ${v.damageTaken} damage`);
  }

  // Trend
  const trendStr = trend === 'improving' ? '↑' : trend === 'worsening' ? '↓' : '→';

  return `${parts.join(', ')}. ${trendStr} ${bottleneck !== 'none' ? `bottleneck: ${bottleneck}` : ''}`.trim();
}

// --- Public API ---

/**
 * Process one tick of vital signs into an integrated soma state.
 *
 * Call this every tick. Pass the same SomaHistory instance each time
 * for trend detection.
 */
export function processSoma(vitals: VitalSigns, history: SomaHistory): SomaState {
  const level = computeLevel(vitals);
  const bottleneck = computeBottleneck(vitals);
  const trend = computeTrend(vitals, history);
  const detail = formatDetail(vitals, level, bottleneck, trend);

  // Record in history AFTER computing trend (so we compare against past, not self)
  history.push(vitals);

  return { level, bottleneck, trend, detail, raw: vitals };
}

// --- Helpers ---

function hasEffect(v: VitalSigns, name: string): boolean {
  return v.effects.some(e => e.name === name);
}
