/**
 * Narrative — the context channel.
 *
 * Where am I in time, space, and intention? What was I doing?
 * What changed? This turns isolated ticks into continuity.
 *
 * Without narrative, each tick is a fresh correction on the
 * Millennium Bridge — independent, accumulating into wobble.
 * With narrative, tick 47 knows what tick 46 was doing and why.
 *
 * Pure functions. No mineflayer dependency. Testable standalone.
 */

// --- Types ---

/** Raw position and environment data from the bot */
export interface RawContext {
  position: { x: number; y: number; z: number };
  biome: string;
  timeOfDay: number;    // 0-24000 (0=sunrise, 6000=noon, 12000=sunset, 18000=midnight)
  isRaining: boolean;
  dimension: string;    // 'overworld', 'the_nether', 'the_end'
}

/** A goal the body is pursuing */
export interface Goal {
  description: string;
  startedAtTick: number;
}

/** The integrated narrative state */
export interface NarrativeState {
  where: string;
  when: string;
  doing: string;
  momentum: Momentum;
  sinceBrainCall: number;
  changed: string[];
  detail: string;
}

export type Momentum =
  | 'focused'      // working on a goal, making progress
  | 'exploring'    // moving, no fixed goal
  | 'idle'         // stationary, no goal
  | 'interrupted'  // was doing something, got knocked off
  | 'recovering';  // coming back from death/crisis

// --- Narrative State Machine ---

export class NarrativeTracker {
  private lastContext: RawContext | null = null;
  private currentGoal: Goal | null = null;
  private tickCount: number = 0;
  private lastBrainCallTick: number = 0;
  private recentPositions: Array<{ x: number; y: number; z: number }> = [];
  private maxPositionHistory: number = 10;
  private homePosition: { x: number; y: number; z: number } | null = null;
  private lastMomentum: Momentum = 'idle';
  private wasInCrisis: boolean = false;

  constructor() {}

  /** Set the home/base position for distance reference */
  setHome(pos: { x: number; y: number; z: number }): void {
    this.homePosition = pos;
  }

  /** Set the current goal */
  setGoal(description: string): void {
    this.currentGoal = {
      description,
      startedAtTick: this.tickCount,
    };
    this.lastMomentum = 'focused';
  }

  /** Clear the current goal */
  clearGoal(): void {
    this.currentGoal = null;
  }

  /** Notify that the brain was just called */
  notifyBrainCall(): void {
    this.lastBrainCallTick = this.tickCount;
  }

  /** Signal that a crisis just happened (death, near-death, etc.) */
  notifyCrisis(): void {
    this.wasInCrisis = true;
    this.currentGoal = null;  // crisis clears the goal
  }

  /**
   * Process one tick and produce the narrative state.
   */
  process(context: RawContext, somaLevel: string): NarrativeState {
    this.tickCount++;

    const changes = this.detectChanges(context);
    const momentum = this.computeMomentum(context, somaLevel, changes);
    const where = this.describeWhere(context);
    const when = describeTime(context.timeOfDay, context.isRaining);
    const doing = this.describeDoing(momentum);
    const sinceBrainCall = this.tickCount - this.lastBrainCallTick;

    // Update state for next tick
    this.recordPosition(context.position);
    this.lastContext = context;
    this.lastMomentum = momentum;
    if (this.wasInCrisis && somaLevel !== 'dying' && somaLevel !== 'critical') {
      this.wasInCrisis = false;
    }

    const detail = formatNarrativeDetail(where, when, doing, momentum, changes, sinceBrainCall);

    return { where, when, doing, momentum, sinceBrainCall, changed: changes, detail };
  }

  // --- Internal ---

  private detectChanges(current: RawContext): string[] {
    const changes: string[] = [];
    if (!this.lastContext) {
      changes.push('just spawned');
      return changes;
    }

    const prev = this.lastContext;

    // Biome change
    if (current.biome !== prev.biome) {
      changes.push(`entered ${current.biome.replace(/_/g, ' ')}`);
    }

    // Dimension change
    if (current.dimension !== prev.dimension) {
      changes.push(`entered ${current.dimension.replace(/_/g, ' ')}`);
    }

    // Significant altitude change (cave entry/exit)
    if (Math.abs(current.position.y - prev.position.y) > 10) {
      if (current.position.y < prev.position.y) {
        changes.push('descended sharply');
      } else {
        changes.push('ascended sharply');
      }
    }

    // Time phase transitions
    const prevPhase = getTimePhase(prev.timeOfDay);
    const currPhase = getTimePhase(current.timeOfDay);
    if (prevPhase !== currPhase) {
      changes.push(`${currPhase}`);
    }

    // Weather change
    if (current.isRaining !== prev.isRaining) {
      changes.push(current.isRaining ? 'rain started' : 'rain stopped');
    }

    // Large distance moved (teleport/respawn)
    const dist = distance3d(current.position, prev.position);
    if (dist > 50) {
      changes.push('large displacement (teleport/respawn?)');
    }

    return changes;
  }

  private computeMomentum(
    context: RawContext,
    somaLevel: string,
    changes: string[]
  ): Momentum {
    // Recovering from crisis takes priority
    if (this.wasInCrisis) return 'recovering';

    // Interrupted: was focused but something big changed
    if (this.lastMomentum === 'focused' && (
      changes.includes('large displacement (teleport/respawn?)') ||
      somaLevel === 'dying' || somaLevel === 'critical'
    )) {
      return 'interrupted';
    }

    // Focused: has a goal and is making progress
    if (this.currentGoal) return 'focused';

    // Exploring: moving but no goal
    if (this.isMoving()) return 'exploring';

    // Idle: stationary, no goal
    return 'idle';
  }

  private isMoving(): boolean {
    if (this.recentPositions.length < 3) return false;
    const recent = this.recentPositions.slice(-3);
    const totalDist = distance3d(recent[0]!, recent[recent.length - 1]!);
    return totalDist > 3;  // moved more than 3 blocks in last 3 ticks
  }

  private recordPosition(pos: { x: number; y: number; z: number }): void {
    this.recentPositions.push({ ...pos });
    if (this.recentPositions.length > this.maxPositionHistory) {
      this.recentPositions.shift();
    }
  }

  private describeWhere(context: RawContext): string {
    const { x, y, z } = context.position;
    const biome = context.biome.replace(/_/g, ' ');
    const parts: string[] = [biome];

    // Depth hints
    if (y < 0) parts.push('deep underground');
    else if (y < 50) parts.push('underground');
    else if (y > 100) parts.push('high up');

    // Distance from home
    if (this.homePosition) {
      const dist = distance2d(context.position, this.homePosition);
      if (dist < 10) parts.push('at base');
      else if (dist < 50) parts.push(`near base (${Math.floor(dist)} blocks)`);
      else parts.push(`far from base (${Math.floor(dist)} blocks)`);
    }

    // Coordinates (compact)
    parts.push(`[${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}]`);

    return parts.join(', ');
  }

  private describeDoing(momentum: Momentum): string {
    switch (momentum) {
      case 'focused':
        return this.currentGoal?.description ?? 'working on something';
      case 'exploring':
        return 'exploring';
      case 'idle':
        return 'standing still';
      case 'interrupted':
        return 'interrupted — was ' + (this.currentGoal?.description ?? 'doing something');
      case 'recovering':
        return 'recovering from crisis';
    }
  }
}

// --- Time Description ---

type TimePhase = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night' | 'midnight';

function getTimePhase(time: number): TimePhase {
  // Minecraft time: 0=sunrise(6am), 6000=noon, 12000=sunset, 18000=midnight
  if (time < 1000) return 'dawn';
  if (time < 5000) return 'morning';
  if (time < 7000) return 'noon';
  if (time < 11000) return 'afternoon';
  if (time < 13000) return 'dusk';
  if (time < 17000) return 'night';
  if (time < 19000) return 'midnight';
  return 'night';  // 19000-24000 → late night / approaching dawn
}

export function describeTime(timeOfDay: number, isRaining: boolean): string {
  const phase = getTimePhase(timeOfDay);
  const weather = isRaining ? ', rain' : '';
  return `${phase}${weather}`;
}

// --- Formatting ---

function formatNarrativeDetail(
  where: string,
  when: string,
  doing: string,
  momentum: Momentum,
  changes: string[],
  sinceBrainCall: number,
): string {
  const parts: string[] = [`${where}. ${when}.`];

  if (doing !== 'standing still') {
    parts.push(`${doing}.`);
  }

  if (changes.length > 0) {
    parts.push(`changed: ${changes.join(', ')}.`);
  }

  if (sinceBrainCall > 10) {
    parts.push(`${sinceBrainCall} ticks since last brain call.`);
  }

  return parts.join(' ');
}

// --- Helpers ---

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function distance2d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}
