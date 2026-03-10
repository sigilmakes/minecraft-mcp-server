import test from 'ava';
import {
  computeUrgency,
  computeRelevance,
  computeMomentum,
  shouldCallBrain,
  integrate,
  formatBrainPrompt,
  type UrgencySignal,
  type RelevanceSignal,
  type MomentumSignal,
} from '../src/perception/integration.js';
import type { SomaState } from '../src/perception/soma.js';
import type { FieldState, FieldItem } from '../src/perception/field.js';
import type { NarrativeState, Momentum } from '../src/perception/narrative.js';

// --- Helpers ---

function somaState(overrides: Partial<SomaState> = {}): SomaState {
  return {
    level: 'stable',
    bottleneck: 'none',
    trend: 'stable',
    detail: 'health 18/20, food 16/20. →',
    raw: {
      health: 18, food: 16, saturation: 3, oxygen: 300,
      damageTaken: 0, isOnFire: false, effects: [],
    },
    ...overrides,
  };
}

function fieldState(overrides: Partial<FieldState> = {}): FieldState {
  return {
    attention: [],
    threatLevel: 'none',
    opportunity: null,
    terrain: 'grassland',
    detail: 'grassland. quiet — nothing demands attention.',
    ...overrides,
  };
}

function narrativeState(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    where: 'taiga, [0, 70, 0]',
    when: 'noon',
    doing: 'standing still',
    momentum: 'idle' as Momentum,
    sinceBrainCall: 0,
    changed: [],
    detail: 'taiga, [0, 70, 0]. noon.',
    ...overrides,
  };
}

function threat(urgency = 0.5): FieldItem {
  return {
    what: 'zombie',
    where: '6 blocks north',
    urgency,
    actionHint: 'fight',
    category: 'threat',
  };
}

function food(urgency = 0.5): FieldItem {
  return {
    what: 'cow',
    where: '8 blocks east',
    urgency,
    actionHint: 'hunt',
    category: 'food',
  };
}

// --- Urgency: Soma × Field ---

test('urgency: calm when thriving + no threats', (t) => {
  const result = computeUrgency(
    somaState({ level: 'thriving' }),
    fieldState()
  );
  t.is(result.level, 'calm');
});

test('urgency: crisis when dying + extreme threat', (t) => {
  const result = computeUrgency(
    somaState({ level: 'dying' }),
    fieldState({
      threatLevel: 'extreme',
      attention: [threat(0.9)],
    })
  );
  t.is(result.level, 'crisis');
});

test('urgency: pressing when starving + food nearby', (t) => {
  const result = computeUrgency(
    somaState({ level: 'critical', bottleneck: 'food' }),
    fieldState({
      opportunity: 'hunt cow (8 blocks east)',
    })
  );
  t.is(result.level, 'pressing');
  t.true(result.summary.includes('food'));
});

test('urgency: alert when declining + medium threat', (t) => {
  const result = computeUrgency(
    somaState({ level: 'declining' }),
    fieldState({
      threatLevel: 'medium',
      attention: [threat(0.4)],
    })
  );
  // declining(0.5) * medium(0.5) = 0.25 → alert
  t.is(result.level, 'alert');
});

test('urgency scales with both inputs (opponent processing)', (t) => {
  // Same field, different soma → different urgency
  const field = fieldState({
    threatLevel: 'medium',
    attention: [threat(0.5)],
  });

  const calmResult = computeUrgency(somaState({ level: 'thriving' }), field);
  const alertResult = computeUrgency(somaState({ level: 'declining' }), field);
  const crisisResult = computeUrgency(somaState({ level: 'dying' }), field);

  // Urgency should increase with soma severity
  const levels = ['calm', 'alert', 'pressing', 'crisis'];
  t.true(levels.indexOf(crisisResult.level) >= levels.indexOf(alertResult.level));
  t.true(levels.indexOf(alertResult.level) >= levels.indexOf(calmResult.level));
});

// --- Relevance: Field × Narrative ---

test('relevance: irrelevant when field is quiet', (t) => {
  const result = computeRelevance(fieldState(), narrativeState());
  t.is(result.level, 'irrelevant');
});

test('relevance: critical when interrupted (need to reassess)', (t) => {
  const result = computeRelevance(
    fieldState({ attention: [threat(0.3)] }),
    narrativeState({ momentum: 'interrupted', doing: 'interrupted — was mining' })
  );
  t.is(result.level, 'critical');
});

test('relevance: threat always relevant regardless of goal', (t) => {
  const result = computeRelevance(
    fieldState({
      attention: [threat(0.7)],
      threatLevel: 'high',
    }),
    narrativeState({ momentum: 'focused', doing: 'mining for iron' })
  );
  t.not(result.level, 'irrelevant');
});

test('relevance: non-threatening items less relevant when focused', (t) => {
  const result = computeRelevance(
    fieldState({
      attention: [food(0.3)],  // low urgency food
    }),
    narrativeState({ momentum: 'focused', doing: 'mining for iron' })
  );
  t.is(result.level, 'irrelevant');
});

test('relevance: items more interesting when exploring', (t) => {
  const result = computeRelevance(
    fieldState({
      attention: [food(0.4)],
    }),
    narrativeState({ momentum: 'exploring', doing: 'exploring' })
  );
  t.not(result.level, 'irrelevant');
});

// --- Momentum: Narrative × Soma ---

test('momentum: halt when body is critical', (t) => {
  const result = computeMomentum(
    narrativeState({ momentum: 'focused', doing: 'mining' }),
    somaState({ level: 'critical' })
  );
  t.is(result.level, 'halt');
});

test('momentum: full-steam when focused + thriving', (t) => {
  const result = computeMomentum(
    narrativeState({ momentum: 'focused', doing: 'mining for iron' }),
    somaState({ level: 'thriving' })
  );
  t.is(result.level, 'full-steam');
});

test('momentum: flagging when focused + declining', (t) => {
  const result = computeMomentum(
    narrativeState({ momentum: 'focused', doing: 'mining for iron' }),
    somaState({ level: 'declining', bottleneck: 'food', trend: 'worsening' })
  );
  t.is(result.level, 'flagging');
  t.true(result.summary.includes('food'));
});

test('momentum: steady when idle + stable', (t) => {
  const result = computeMomentum(
    narrativeState({ momentum: 'idle' }),
    somaState({ level: 'stable' })
  );
  t.is(result.level, 'steady');
  t.true(result.summary.includes('pick a direction'));
});

test('momentum: halt when interrupted', (t) => {
  const result = computeMomentum(
    narrativeState({ momentum: 'interrupted', doing: 'interrupted — was mining' }),
    somaState({ level: 'stable' })
  );
  t.is(result.level, 'halt');
});

// --- Should Call Brain ---

test('brain: called on crisis', (t) => {
  const { should } = shouldCallBrain(
    { level: 'crisis', summary: 'test' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'steady', summary: '' } as MomentumSignal,
    narrativeState(),
  );
  t.true(should);
});

test('brain: called on halt', (t) => {
  const { should } = shouldCallBrain(
    { level: 'calm', summary: '' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'halt', summary: 'interrupted' } as MomentumSignal,
    narrativeState(),
  );
  t.true(should);
});

test('brain: called on heartbeat', (t) => {
  const { should, reason } = shouldCallBrain(
    { level: 'calm', summary: '' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'steady', summary: '' } as MomentumSignal,
    narrativeState({ sinceBrainCall: 35 }),
    30,
  );
  t.true(should);
  t.true(reason!.includes('heartbeat'));
});

test('brain: not called when calm + steady + recent call', (t) => {
  const { should } = shouldCallBrain(
    { level: 'calm', summary: '' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'steady', summary: '' } as MomentumSignal,
    narrativeState({ sinceBrainCall: 2 }),
  );
  t.false(should);
});

test('brain: called on context change (biome)', (t) => {
  const { should } = shouldCallBrain(
    { level: 'calm', summary: '' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'steady', summary: '' } as MomentumSignal,
    narrativeState({ changed: ['entered plains'] }),
  );
  t.true(should);
});

test('brain: called when flagging (after a few ticks)', (t) => {
  const { should } = shouldCallBrain(
    { level: 'alert', summary: '' } as UrgencySignal,
    { level: 'irrelevant', summary: '' } as RelevanceSignal,
    { level: 'flagging', summary: 'food worsening' } as MomentumSignal,
    narrativeState({ sinceBrainCall: 6 }),
  );
  t.true(should);
});

// --- Prompt Formatting ---

test('prompt contains all six signals', (t) => {
  const prompt = formatBrainPrompt(
    somaState({ level: 'declining', detail: 'food 6/20, health 14/20. ↓ bottleneck: food' }),
    fieldState({
      detail: 'grassland. opportunity: hunt cow (8 blocks east).',
      opportunity: 'hunt cow (8 blocks east)',
    }),
    narrativeState({
      where: 'taiga, near base (15 blocks)',
      when: 'midday, clear',
      detail: 'taiga, near base. midday. exploring.',
    }),
    { level: 'pressing', summary: 'starving — food nearby.' },
    { level: 'notable', summary: 'noticed: cow 8 blocks east.' },
    { level: 'flagging', summary: 'food becoming a problem. wrap up soon.' },
    247,
    'crisis — urgent action needed',
  );

  t.true(prompt.includes('Tick 247'));
  t.true(prompt.includes('SOMA'));
  t.true(prompt.includes('FIELD'));
  t.true(prompt.includes('NARRATIVE'));
  t.true(prompt.includes('URGENCY'));
  t.true(prompt.includes('RELEVANCE'));
  t.true(prompt.includes('MOMENTUM'));
  t.true(prompt.includes('Called because'));
});

// --- Full Integration ---

test('integrate: produces all components', (t) => {
  const result = integrate(
    somaState(),
    fieldState(),
    narrativeState(),
    100,
  );

  t.truthy(result.soma);
  t.truthy(result.field);
  t.truthy(result.narrative);
  t.truthy(result.urgency);
  t.truthy(result.relevance);
  t.truthy(result.momentum);
  t.is(typeof result.shouldCallBrain, 'boolean');
});

test('integrate: brain not called on quiet tick', (t) => {
  const result = integrate(
    somaState({ level: 'thriving' }),
    fieldState(),
    narrativeState({ sinceBrainCall: 2 }),
    5,
  );
  t.false(result.shouldCallBrain);
  t.is(result.prompt, '');
});

test('integrate: brain called on crisis', (t) => {
  const result = integrate(
    somaState({ level: 'dying' }),
    fieldState({
      threatLevel: 'extreme',
      attention: [threat(0.9)],
    }),
    narrativeState(),
    10,
  );
  t.true(result.shouldCallBrain);
  t.true(result.prompt.length > 0);
  t.true(result.prompt.includes('SOMA'));
});
