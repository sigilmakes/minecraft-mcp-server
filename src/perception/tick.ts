/**
 * Tick — one cycle of the perception loop.
 *
 * Each tick:
 *   1. Extract raw data from mineflayer bot
 *   2. Process through three channels (soma, field, narrative)
 *   3. Integrate cross-channel signals
 *   4. Decide whether to call the brain
 *
 * This module owns the stateful objects (SomaHistory, NarrativeTracker)
 * and exposes a simple `tick(bot)` function.
 */

import type { Bot } from 'mineflayer';
import { extractVitalSigns, extractFieldInput, extractContext } from './extract.js';
import { processSoma, SomaHistory } from './soma.js';
import { processField } from './field.js';
import { NarrativeTracker } from './narrative.js';
import { integrate, type IntegratedPerception } from './integration.js';

export interface TickConfig {
  /** Ticks between heartbeat brain calls (default: 30) */
  heartbeatInterval: number;
  /** Max distance for entity detection (default: 16) */
  entityRadius: number;
  /** Max distance for resource/ore detection (default: 8) */
  resourceRadius: number;
}

const DEFAULT_CONFIG: TickConfig = {
  heartbeatInterval: 30,
  entityRadius: 16,
  resourceRadius: 8,
};

/**
 * PerceptionEngine — maintains state across ticks and
 * produces integrated perception each cycle.
 */
export class PerceptionEngine {
  private somaHistory: SomaHistory;
  private narrativeTracker: NarrativeTracker;
  private config: TickConfig;
  private tickCount: number = 0;
  private previousHealth: number | null = null;

  constructor(config: Partial<TickConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.somaHistory = new SomaHistory(10);
    this.narrativeTracker = new NarrativeTracker();
  }

  /**
   * Set the home/base position for narrative distance tracking.
   */
  setHome(pos: { x: number; y: number; z: number }): void {
    this.narrativeTracker.setHome(pos);
  }

  /**
   * Set a goal the body is pursuing.
   */
  setGoal(description: string): void {
    this.narrativeTracker.setGoal(description);
  }

  /**
   * Clear the current goal.
   */
  clearGoal(): void {
    this.narrativeTracker.clearGoal();
  }

  /**
   * Notify that a crisis happened (death, near-death).
   */
  notifyCrisis(): void {
    this.narrativeTracker.notifyCrisis();
  }

  /**
   * Notify that the brain was just called (resets heartbeat timer).
   */
  notifyBrainCall(): void {
    this.narrativeTracker.notifyBrainCall();
  }

  /**
   * Process one tick. Returns the full integrated perception.
   *
   * Call this every tick interval (e.g. every 1-2 seconds).
   */
  tick(bot: Bot): IntegratedPerception {
    this.tickCount++;

    // 1. Extract raw data from mineflayer
    const vitals = extractVitalSigns(bot, this.previousHealth);
    const fieldInput = extractFieldInput(bot, this.config.entityRadius, this.config.resourceRadius);
    const context = extractContext(bot);

    // 2. Process through three channels
    const soma = processSoma(vitals, this.somaHistory);
    const field = processField(fieldInput, { level: soma.level, bottleneck: soma.bottleneck });
    const narrative = this.narrativeTracker.process(context, soma.level);

    // 3. Integrate
    const perception = integrate(
      soma, field, narrative,
      this.tickCount,
      this.config.heartbeatInterval,
    );

    // 4. Track health for next tick's damage detection
    this.previousHealth = vitals.health;

    // 5. If brain was called, mark it
    if (perception.shouldCallBrain) {
      this.notifyBrainCall();
    }

    return perception;
  }

  /** Current tick count */
  getTickCount(): number {
    return this.tickCount;
  }

  /** Reset all state (e.g. on reconnect) */
  reset(): void {
    this.tickCount = 0;
    this.previousHealth = null;
    this.somaHistory = new SomaHistory(10);
    this.narrativeTracker = new NarrativeTracker();
  }
}
