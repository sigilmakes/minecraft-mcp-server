/**
 * Perception system — three channels, three cross-channel signals.
 *
 * Channels:
 *   Soma      — body state (health, food, oxygen → thriving/declining/dying)
 *   Field     — attention map (entities, resources, threats → filtered by soma)
 *   Narrative — context (where, when, what I'm doing → continuity across ticks)
 *
 * Cross-channel signals (opponent processing):
 *   Urgency   = Soma × Field     (how much does the world demand action?)
 *   Relevance = Field × Narrative (does what's nearby matter for my goal?)
 *   Momentum  = Narrative × Soma  (should I keep going or change course?)
 *
 * Three channels that talk to each other beats twelve that don't.
 */

export { PerceptionEngine } from './tick.js';
export type { TickConfig } from './tick.js';

export { extractVitalSigns, extractFieldInput, extractContext } from './extract.js';

export { processSoma, SomaHistory } from './soma.js';
export type { VitalSigns, SomaState, SomaLevel, SomaBottleneck, SomaTrend, ActiveEffect } from './soma.js';

export { classifyEntity, classifyResource, processField, describeTerrain } from './field.js';
export type { RawEntity, RawBlockScan, RawResource, FieldInput, FieldState, FieldItem, ThreatLevel } from './field.js';

export { NarrativeTracker, describeTime } from './narrative.js';
export type { RawContext, Goal, NarrativeState, Momentum } from './narrative.js';

export {
  computeUrgency,
  computeRelevance,
  computeMomentum,
  shouldCallBrain,
  formatBrainPrompt,
  integrate,
} from './integration.js';
export type {
  UrgencySignal,
  RelevanceSignal,
  MomentumSignal,
  IntegratedPerception,
} from './integration.js';
