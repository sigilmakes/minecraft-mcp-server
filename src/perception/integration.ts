/**
 * Integration — where the three channels talk to each other.
 *
 * Three cross-channel signals, borrowed from opponent processing
 * in color vision:
 *
 *   Soma × Field   → Urgency    (how much does the world demand action?)
 *   Field × Narrative → Relevance  (does what's around me matter for what I'm doing?)
 *   Narrative × Soma  → Momentum   (should I keep going or change course?)
 *
 * Each pair creates meaning that neither channel has alone.
 * The brain gets 6 signals, not 15 raw values.
 *
 * Pure functions. Testable standalone.
 */

import type { SomaState, SomaLevel } from './soma.js';
import type { FieldState, ThreatLevel } from './field.js';
import type { NarrativeState, Momentum } from './narrative.js';

// --- Types ---

/** Cross-channel: Soma × Field */
export interface UrgencySignal {
  level: 'calm' | 'alert' | 'pressing' | 'crisis';
  summary: string;
}

/** Cross-channel: Field × Narrative */
export interface RelevanceSignal {
  level: 'irrelevant' | 'notable' | 'relevant' | 'critical';
  summary: string;
}

/** Cross-channel: Narrative × Soma */
export interface MomentumSignal {
  level: 'full-steam' | 'steady' | 'flagging' | 'halt';
  summary: string;
}

/** The full integrated perception — what the brain actually receives */
export interface IntegratedPerception {
  // The three channels
  soma: SomaState;
  field: FieldState;
  narrative: NarrativeState;

  // The three cross-channel signals
  urgency: UrgencySignal;
  relevance: RelevanceSignal;
  momentum: MomentumSignal;

  // Should the brain be called this tick?
  shouldCallBrain: boolean;
  callReason: string | null;

  // The formatted prompt for the brain
  prompt: string;
}

// --- Urgency: Soma × Field ---

/**
 * How much does the world demand action right now?
 *
 * A body that's thriving in an empty field = calm.
 * A body that's dying next to a creeper = crisis.
 */
export function computeUrgency(soma: SomaState, field: FieldState): UrgencySignal {
  const somaWeight = somaUrgencyWeight(soma.level);
  const fieldWeight = fieldUrgencyWeight(field.threatLevel);

  // Opponent processing: the product is more informative than either factor
  const combined = somaWeight * fieldWeight;

  // Special case: starvation + food nearby = pressing opportunity
  if (soma.bottleneck === 'food' && field.opportunity?.includes('hunt')) {
    return {
      level: 'pressing',
      summary: `starving — food nearby. ${field.opportunity}.`,
    };
  }

  if (combined >= 0.7) {
    return {
      level: 'crisis',
      summary: buildUrgencySummary(soma, field, 'crisis'),
    };
  }
  if (combined >= 0.4) {
    return {
      level: 'pressing',
      summary: buildUrgencySummary(soma, field, 'pressing'),
    };
  }
  if (combined >= 0.15) {
    return {
      level: 'alert',
      summary: buildUrgencySummary(soma, field, 'alert'),
    };
  }

  return {
    level: 'calm',
    summary: 'no immediate demands.',
  };
}

function somaUrgencyWeight(level: SomaLevel): number {
  switch (level) {
    case 'dying': return 1.0;
    case 'critical': return 0.8;
    case 'declining': return 0.5;
    case 'stable': return 0.3;
    case 'thriving': return 0.1;
  }
}

function fieldUrgencyWeight(threat: ThreatLevel): number {
  switch (threat) {
    case 'extreme': return 1.0;
    case 'high': return 0.8;
    case 'medium': return 0.5;
    case 'low': return 0.3;
    case 'none': return 0.1;
  }
}

function buildUrgencySummary(soma: SomaState, field: FieldState, level: string): string {
  const parts: string[] = [];

  if (soma.level === 'dying' || soma.level === 'critical') {
    parts.push(`body ${soma.level}`);
    if (soma.bottleneck !== 'none') parts.push(`(${soma.bottleneck})`);
  }

  if (field.threatLevel !== 'none') {
    const topThreat = field.attention.find(i => i.category === 'threat');
    if (topThreat) parts.push(`${topThreat.what} ${topThreat.where}`);
  }

  if (level === 'crisis') parts.push('act now');
  else if (level === 'pressing') parts.push('needs attention');

  return parts.join(' — ') + '.';
}

// --- Relevance: Field × Narrative ---

/**
 * Does what's around me matter for what I'm doing?
 *
 * Diamond ore while mining for diamonds = critical.
 * Diamond ore while fleeing = irrelevant (but remember it).
 */
export function computeRelevance(field: FieldState, narrative: NarrativeState): RelevanceSignal {
  // If field is quiet, nothing is relevant
  if (field.attention.length === 0 || field.attention.every(i => i.urgency < 0.1)) {
    return { level: 'irrelevant', summary: 'nothing notable nearby.' };
  }

  // If interrupted or recovering, everything becomes potentially relevant
  // (need to reassess the whole situation)
  if (narrative.momentum === 'interrupted' || narrative.momentum === 'recovering') {
    return {
      level: 'critical',
      summary: `reassessing — ${narrative.doing}. ${field.attention.length} items in attention.`,
    };
  }

  // Check if any field items relate to the current goal
  const topItems = field.attention.filter(i => i.urgency > 0.2);

  // Threats are always relevant regardless of goal
  const threats = topItems.filter(i => i.category === 'threat');
  if (threats.length > 0) {
    return {
      level: threats[0]!.urgency > 0.6 ? 'critical' : 'relevant',
      summary: `threat: ${threats.map(t => `${t.what} ${t.where}`).join(', ')}.`,
    };
  }

  // When focused, non-threatening items are less relevant (tunnel vision)
  if (narrative.momentum === 'focused') {
    const relevant = topItems.filter(i => i.urgency > 0.5);
    if (relevant.length === 0) {
      return {
        level: 'irrelevant',
        summary: `staying focused on ${narrative.doing}. nearby items not worth interrupting for.`,
      };
    }
    return {
      level: 'notable',
      summary: `while ${narrative.doing}: ${relevant.map(i => `${i.what} ${i.where}`).join(', ')}.`,
    };
  }

  // When exploring or idle, everything is more interesting
  if (topItems.length > 0) {
    return {
      level: topItems[0]!.urgency > 0.5 ? 'relevant' : 'notable',
      summary: `noticed: ${topItems.map(i => `${i.what} ${i.where}`).join(', ')}.`,
    };
  }

  return { level: 'irrelevant', summary: 'nothing notable nearby.' };
}

// --- Momentum: Narrative × Soma ---

/**
 * Should I keep going or change course?
 *
 * Mining for 50 ticks + food declining = flagging (surface soon).
 * Just ate + heading to mine = full steam.
 */
export function computeMomentum(narrative: NarrativeState, soma: SomaState): MomentumSignal {
  // Crisis overrides everything
  if (soma.level === 'dying' || soma.level === 'critical') {
    return {
      level: 'halt',
      summary: `body ${soma.level} — stop everything, survive first.`,
    };
  }

  // Recovering → cautious
  if (narrative.momentum === 'recovering') {
    return {
      level: 'flagging',
      summary: 'recovering. take it slow, reassess.',
    };
  }

  // Interrupted → halt and reassess
  if (narrative.momentum === 'interrupted') {
    return {
      level: 'halt',
      summary: `interrupted — was ${narrative.doing}. reassess.`,
    };
  }

  // Focused but declining → flagging
  if (narrative.momentum === 'focused' && soma.level === 'declining') {
    return {
      level: 'flagging',
      summary: `${soma.bottleneck} becoming a problem. ${soma.trend === 'worsening' ? 'wrap up soon.' : 'watch it.'}`,
    };
  }

  // Focused and stable+ → full steam or steady
  if (narrative.momentum === 'focused') {
    if (soma.level === 'thriving') {
      return { level: 'full-steam', summary: `${narrative.doing}. body thriving. go.` };
    }
    return { level: 'steady', summary: `${narrative.doing}. body stable.` };
  }

  // Idle → depends on soma
  if (narrative.momentum === 'idle') {
    if (soma.level === 'declining') {
      return { level: 'flagging', summary: `idle and ${soma.bottleneck} is a problem. do something about it.` };
    }
    return { level: 'steady', summary: 'idle. pick a direction.' };
  }

  // Exploring → steady unless declining
  if (soma.level === 'declining' && soma.trend === 'worsening') {
    return { level: 'flagging', summary: `exploring but ${soma.bottleneck} worsening. find a fix.` };
  }

  return { level: 'steady', summary: `exploring. ${soma.level}.` };
}

// --- Brain Call Decision ---

/**
 * Should the brain be consulted this tick?
 *
 * Not every tick needs a brain call. Reflexes handle survival.
 * The brain is for decisions.
 */
export function shouldCallBrain(
  urgency: UrgencySignal,
  relevance: RelevanceSignal,
  momentum: MomentumSignal,
  narrative: NarrativeState,
  heartbeatInterval: number = 30,
): { should: boolean; reason: string | null } {
  // Always call on crisis
  if (urgency.level === 'crisis') {
    return { should: true, reason: 'crisis — urgent action needed' };
  }

  // Call when interrupted (need to reassess)
  if (momentum.level === 'halt') {
    return { should: true, reason: 'halted — need to reassess' };
  }

  // Call when something relevant appeared
  if (relevance.level === 'critical') {
    return { should: true, reason: 'critical relevance — situation changed' };
  }

  // Call on chat messages (another player spoke)
  if (narrative.changed.some(c => c.includes('chat'))) {
    return { should: true, reason: 'chat message received' };
  }

  // Call on significant changes
  if (narrative.changed.some(c =>
    c.includes('entered') || c.includes('displacement') || c.includes('spawned')
  )) {
    return { should: true, reason: `context changed: ${narrative.changed.join(', ')}` };
  }

  // Heartbeat: call periodically even when nothing's happening
  if (narrative.sinceBrainCall >= heartbeatInterval) {
    return { should: true, reason: `heartbeat (${narrative.sinceBrainCall} ticks since last call)` };
  }

  // Call when flagging (might need to change plans)
  if (momentum.level === 'flagging' && narrative.sinceBrainCall >= 5) {
    return { should: true, reason: `momentum flagging — ${momentum.summary}` };
  }

  return { should: false, reason: null };
}

// --- Prompt Formatting ---

/**
 * Format the full perception into a brain prompt.
 *
 * This is the paragraph, not the data dump. Six signals,
 * not fifteen raw values.
 */
export function formatBrainPrompt(
  soma: SomaState,
  field: FieldState,
  narrative: NarrativeState,
  urgency: UrgencySignal,
  relevance: RelevanceSignal,
  momentumSignal: MomentumSignal,
  tickCount: number,
  callReason: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`[Tick ${tickCount} | ${narrative.when} | ${narrative.where}]`);
  lines.push('');

  // Three channels — one line each
  lines.push(`SOMA: ${soma.level} — ${soma.detail}`);
  lines.push(`FIELD: ${field.detail}`);
  lines.push(`NARRATIVE: ${narrative.detail}`);
  lines.push('');

  // Three cross-channel signals
  if (urgency.level !== 'calm') {
    lines.push(`URGENCY: ${urgency.summary}`);
  }
  if (relevance.level !== 'irrelevant') {
    lines.push(`RELEVANCE: ${relevance.summary}`);
  }
  lines.push(`MOMENTUM: ${momentumSignal.summary}`);
  lines.push('');

  // Why the brain was called
  lines.push(`→ Called because: ${callReason}`);

  return lines.join('\n');
}

// --- Main Integration ---

/**
 * Integrate all three channels into a single perception.
 */
export function integrate(
  soma: SomaState,
  field: FieldState,
  narrative: NarrativeState,
  tickCount: number,
  heartbeatInterval: number = 30,
): IntegratedPerception {
  const urgency = computeUrgency(soma, field);
  const relevance = computeRelevance(field, narrative);
  const momentumSignal = computeMomentum(narrative, soma);

  const { should: shouldCall, reason: callReason } = shouldCallBrain(
    urgency, relevance, momentumSignal, narrative, heartbeatInterval,
  );

  const prompt = shouldCall
    ? formatBrainPrompt(soma, field, narrative, urgency, relevance, momentumSignal, tickCount, callReason!)
    : '';

  return {
    soma,
    field,
    narrative,
    urgency,
    relevance,
    momentum: momentumSignal,
    shouldCallBrain: shouldCall,
    callReason,
    prompt,
  };
}
