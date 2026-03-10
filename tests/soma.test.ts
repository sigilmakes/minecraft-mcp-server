import test from 'ava';
import {
  computeLevel,
  computeBottleneck,
  computeTrend,
  processSoma,
  SomaHistory,
  type VitalSigns,
} from '../src/perception/soma.js';

// --- Helpers ---

function vitals(overrides: Partial<VitalSigns> = {}): VitalSigns {
  return {
    health: 20,
    food: 20,
    saturation: 5,
    oxygen: 300,
    damageTaken: 0,
    isOnFire: false,
    effects: [],
    ...overrides,
  };
}

// --- computeLevel ---

test('level: thriving at full stats', (t) => {
  t.is(computeLevel(vitals()), 'thriving');
});

test('level: stable when health or food slightly below max', (t) => {
  t.is(computeLevel(vitals({ health: 18, food: 20 })), 'stable');
  t.is(computeLevel(vitals({ health: 20, food: 16 })), 'stable');
});

test('level: declining when food is low', (t) => {
  t.is(computeLevel(vitals({ food: 5 })), 'declining');
});

test('level: declining when health is low', (t) => {
  t.is(computeLevel(vitals({ health: 8 })), 'declining');
});

test('level: critical when starving (food=0)', (t) => {
  t.is(computeLevel(vitals({ food: 0, health: 20 })), 'critical');
});

test('level: critical when health very low', (t) => {
  t.is(computeLevel(vitals({ health: 5 })), 'critical');
});

test('level: dying when health <= 2', (t) => {
  t.is(computeLevel(vitals({ health: 2 })), 'dying');
  t.is(computeLevel(vitals({ health: 1 })), 'dying');
  t.is(computeLevel(vitals({ health: 0 })), 'dying');
});

test('level: dying when oxygen depleted', (t) => {
  t.is(computeLevel(vitals({ oxygen: 0 })), 'dying');
});

test('level: critical when on fire with moderate health', (t) => {
  t.is(computeLevel(vitals({ isOnFire: true, health: 8 })), 'critical');
});

test('level: declining when on fire with high health', (t) => {
  t.is(computeLevel(vitals({ isOnFire: true, health: 18 })), 'declining');
});

test('level: declining when poisoned', (t) => {
  t.is(computeLevel(vitals({
    effects: [{ name: 'poison', amplifier: 0, remainingTicks: 100 }],
  })), 'declining');
});

test('level: critical when poisoned with low health', (t) => {
  t.is(computeLevel(vitals({
    health: 7,
    effects: [{ name: 'poison', amplifier: 0, remainingTicks: 100 }],
  })), 'critical');
});

test('level: critical when oxygen low', (t) => {
  t.is(computeLevel(vitals({ oxygen: 40 })), 'critical');
});

test('level: declining when oxygen at half', (t) => {
  t.is(computeLevel(vitals({ oxygen: 140 })), 'declining');
});

// --- computeBottleneck ---

test('bottleneck: none when all good', (t) => {
  t.is(computeBottleneck(vitals()), 'none');
});

test('bottleneck: damage when taking damage', (t) => {
  t.is(computeBottleneck(vitals({ damageTaken: 3 })), 'damage');
});

test('bottleneck: fire when on fire (even if food is low)', (t) => {
  t.is(computeBottleneck(vitals({ isOnFire: true, food: 4 })), 'fire');
});

test('bottleneck: oxygen when drowning', (t) => {
  t.is(computeBottleneck(vitals({ oxygen: 100 })), 'oxygen');
});

test('bottleneck: poison when poisoned', (t) => {
  t.is(computeBottleneck(vitals({
    effects: [{ name: 'poison', amplifier: 0, remainingTicks: 100 }],
  })), 'poison');
});

test('bottleneck: food when food is low', (t) => {
  t.is(computeBottleneck(vitals({ food: 5 })), 'food');
});

test('bottleneck: food when health low and food not high enough to regen', (t) => {
  // health < 10 and food < 14 → food is the bottleneck (can't regen)
  t.is(computeBottleneck(vitals({ health: 8, food: 12 })), 'food');
});

test('bottleneck: health when health low but food is fine', (t) => {
  t.is(computeBottleneck(vitals({ health: 8, food: 18 })), 'health');
});

// --- computeTrend ---

test('trend: stable with no history', (t) => {
  const history = new SomaHistory();
  t.is(computeTrend(vitals(), history), 'stable');
});

test('trend: stable with short history', (t) => {
  const history = new SomaHistory();
  history.push(vitals());
  history.push(vitals());
  t.is(computeTrend(vitals(), history), 'stable');
});

test('trend: worsening when food drops over time', (t) => {
  const history = new SomaHistory();
  // 5 ticks of declining food
  history.push(vitals({ food: 18 }));
  history.push(vitals({ food: 16 }));
  history.push(vitals({ food: 14 }));
  history.push(vitals({ food: 12 }));
  history.push(vitals({ food: 10 }));

  const current = vitals({ food: 8 });
  t.is(computeTrend(current, history), 'worsening');
});

test('trend: improving when health recovers', (t) => {
  const history = new SomaHistory();
  history.push(vitals({ health: 8, food: 18 }));
  history.push(vitals({ health: 10, food: 18 }));
  history.push(vitals({ health: 12, food: 18 }));
  history.push(vitals({ health: 14, food: 18 }));
  history.push(vitals({ health: 16, food: 18 }));

  const current = vitals({ health: 18, food: 18 });
  t.is(computeTrend(current, history), 'improving');
});

test('trend: stable when nothing changes', (t) => {
  const history = new SomaHistory();
  for (let i = 0; i < 5; i++) {
    history.push(vitals({ health: 14, food: 14 }));
  }
  t.is(computeTrend(vitals({ health: 14, food: 14 }), history), 'stable');
});

// --- SomaHistory ---

test('history: ring buffer caps at maxLength', (t) => {
  const history = new SomaHistory(3);
  history.push(vitals({ health: 1 }));
  history.push(vitals({ health: 2 }));
  history.push(vitals({ health: 3 }));
  history.push(vitals({ health: 4 }));
  t.is(history.length, 3);
  t.is(history.ago(0)?.health, 4);
  t.is(history.ago(2)?.health, 2);
  t.is(history.ago(3), null);
});

test('history: ago returns null for out-of-range', (t) => {
  const history = new SomaHistory();
  t.is(history.ago(0), null);
  history.push(vitals());
  t.is(history.ago(0)?.health, 20);
  t.is(history.ago(1), null);
});

// --- processSoma (integration) ---

test('processSoma: thriving at full stats', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals(), history);
  t.is(state.level, 'thriving');
  t.is(state.bottleneck, 'none');
  t.is(state.trend, 'stable');
  t.true(state.detail.includes('full health'));
});

test('processSoma: records vitals in history', (t) => {
  const history = new SomaHistory();
  processSoma(vitals({ health: 15 }), history);
  t.is(history.length, 1);
  t.is(history.ago(0)?.health, 15);
});

test('processSoma: declining with low food shows bottleneck', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals({ food: 4 }), history);
  t.is(state.level, 'declining');
  t.is(state.bottleneck, 'food');
  t.true(state.detail.includes('food 4/20'));
});

test('processSoma: critical with starvation', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals({ food: 0, health: 14 }), history);
  t.is(state.level, 'critical');
  t.is(state.bottleneck, 'food');
});

test('processSoma: dying when health at 1', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals({ health: 1 }), history);
  t.is(state.level, 'dying');
});

test('processSoma: shows damage in detail', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals({ health: 14, damageTaken: 6 }), history);
  t.true(state.detail.includes('took 6 damage'));
  t.is(state.bottleneck, 'damage');
});

test('processSoma: shows fire in detail', (t) => {
  const history = new SomaHistory();
  const state = processSoma(vitals({ isOnFire: true }), history);
  t.true(state.detail.includes('on fire'));
});

test('processSoma: trend detection over multiple ticks', (t) => {
  const history = new SomaHistory();

  // Simulate food dropping over 5 ticks
  processSoma(vitals({ food: 18 }), history);
  processSoma(vitals({ food: 16 }), history);
  processSoma(vitals({ food: 14 }), history);
  processSoma(vitals({ food: 12 }), history);

  const state = processSoma(vitals({ food: 8 }), history);
  t.is(state.trend, 'worsening');
});
