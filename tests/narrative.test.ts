import test from 'ava';
import {
  NarrativeTracker,
  describeTime,
  type RawContext,
} from '../src/perception/narrative.js';

// --- Helpers ---

function ctx(overrides: Partial<RawContext> = {}): RawContext {
  return {
    position: { x: 0, y: 70, z: 0 },
    biome: 'taiga',
    timeOfDay: 6000,  // noon
    isRaining: false,
    dimension: 'overworld',
    ...overrides,
  };
}

// --- describeTime ---

test('time: dawn', (t) => {
  t.is(describeTime(500, false), 'dawn');
});

test('time: noon', (t) => {
  t.is(describeTime(6000, false), 'noon');
});

test('time: night', (t) => {
  t.is(describeTime(14000, false), 'night');
});

test('time: rain included', (t) => {
  t.is(describeTime(6000, true), 'noon, rain');
});

test('time: midnight', (t) => {
  t.is(describeTime(18000, false), 'midnight');
});

// --- NarrativeTracker ---

test('first tick shows "just spawned"', (t) => {
  const tracker = new NarrativeTracker();
  const state = tracker.process(ctx(), 'stable');
  t.true(state.changed.includes('just spawned'));
});

test('where includes biome', (t) => {
  const tracker = new NarrativeTracker();
  const state = tracker.process(ctx({ biome: 'dark_forest' }), 'stable');
  t.true(state.where.includes('dark forest'));
});

test('where includes depth hint for underground', (t) => {
  const tracker = new NarrativeTracker();
  const state = tracker.process(ctx({ position: { x: 0, y: 30, z: 0 } }), 'stable');
  t.true(state.where.includes('underground'));
});

test('where includes "at base" when near home', (t) => {
  const tracker = new NarrativeTracker();
  tracker.setHome({ x: 0, y: 70, z: 0 });
  const state = tracker.process(ctx({ position: { x: 3, y: 70, z: 2 } }), 'stable');
  t.true(state.where.includes('at base'));
});

test('where includes distance from home', (t) => {
  const tracker = new NarrativeTracker();
  tracker.setHome({ x: 0, y: 70, z: 0 });
  const state = tracker.process(ctx({ position: { x: 100, y: 70, z: 0 } }), 'stable');
  t.true(state.where.includes('far from base'));
});

test('where includes coordinates', (t) => {
  const tracker = new NarrativeTracker();
  const state = tracker.process(ctx({ position: { x: 42, y: 65, z: -10 } }), 'stable');
  t.true(state.where.includes('[42, 65, -10]'));
});

test('detects biome change', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ biome: 'taiga' }), 'stable');
  const state = tracker.process(ctx({ biome: 'plains' }), 'stable');
  t.true(state.changed.some(c => c.includes('plains')));
});

test('detects time phase transition', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ timeOfDay: 10000 }), 'stable');   // afternoon (< 11000)
  const state = tracker.process(ctx({ timeOfDay: 12000 }), 'stable');  // dusk (< 13000)
  t.true(state.changed.some(c => c.includes('dusk')));
});

test('detects weather change', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ isRaining: false }), 'stable');
  const state = tracker.process(ctx({ isRaining: true }), 'stable');
  t.true(state.changed.some(c => c.includes('rain started')));
});

test('detects large displacement', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ position: { x: 0, y: 70, z: 0 } }), 'stable');
  const state = tracker.process(ctx({ position: { x: 200, y: 70, z: 0 } }), 'stable');
  t.true(state.changed.some(c => c.includes('displacement')));
});

test('detects sharp descent', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ position: { x: 0, y: 70, z: 0 } }), 'stable');
  const state = tracker.process(ctx({ position: { x: 0, y: 55, z: 0 } }), 'stable');
  t.true(state.changed.some(c => c.includes('descended')));
});

// --- Momentum ---

test('momentum: idle when stationary with no goal', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx(), 'stable');
  tracker.process(ctx(), 'stable');
  tracker.process(ctx(), 'stable');
  const state = tracker.process(ctx(), 'stable');
  t.is(state.momentum, 'idle');
});

test('momentum: focused when goal is set', (t) => {
  const tracker = new NarrativeTracker();
  tracker.setGoal('mining for iron');
  const state = tracker.process(ctx(), 'stable');
  t.is(state.momentum, 'focused');
  t.true(state.doing.includes('mining for iron'));
});

test('momentum: exploring when moving without goal', (t) => {
  const tracker = new NarrativeTracker();
  // Simulate movement over several ticks
  tracker.process(ctx({ position: { x: 0, y: 70, z: 0 } }), 'stable');
  tracker.process(ctx({ position: { x: 2, y: 70, z: 2 } }), 'stable');
  tracker.process(ctx({ position: { x: 5, y: 70, z: 5 } }), 'stable');
  const state = tracker.process(ctx({ position: { x: 8, y: 70, z: 8 } }), 'stable');
  t.is(state.momentum, 'exploring');
});

test('momentum: interrupted when focused + crisis', (t) => {
  const tracker = new NarrativeTracker();
  tracker.setGoal('mining for iron');
  tracker.process(ctx(), 'stable');
  // Sudden teleport (death/respawn)
  const state = tracker.process(
    ctx({ position: { x: 200, y: 70, z: 200 } }),
    'dying'
  );
  t.is(state.momentum, 'interrupted');
});

test('momentum: recovering after crisis notification', (t) => {
  const tracker = new NarrativeTracker();
  tracker.setGoal('mining');
  tracker.process(ctx(), 'stable');
  tracker.notifyCrisis();
  const state = tracker.process(ctx(), 'stable');
  t.is(state.momentum, 'recovering');
  // Goal should be cleared
  t.true(state.doing.includes('recovering'));
});

test('momentum: recovers from crisis when soma improves', (t) => {
  const tracker = new NarrativeTracker();
  tracker.notifyCrisis();
  tracker.process(ctx(), 'critical');  // still in crisis
  t.is(tracker.process(ctx(), 'critical').momentum, 'recovering');
  // Soma improves — recovery lingers one tick (body needs a moment)
  t.is(tracker.process(ctx(), 'stable').momentum, 'recovering');
  // Next tick: fully recovered
  t.is(tracker.process(ctx(), 'stable').momentum, 'idle');
});

// --- Brain call tracking ---

test('sinceBrainCall increments each tick', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx(), 'stable');
  tracker.process(ctx(), 'stable');
  const state = tracker.process(ctx(), 'stable');
  t.is(state.sinceBrainCall, 3);
});

test('sinceBrainCall resets on notifyBrainCall', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx(), 'stable');
  tracker.process(ctx(), 'stable');
  tracker.notifyBrainCall();
  // Next tick should show 1 (this tick) since the notification happened at tick 2
  // Actually: tickCount is 2 at notify, lastBrainCallTick = 2. Next process increments to 3. sinceBrainCall = 3-2 = 1
  const state = tracker.process(ctx(), 'stable');
  t.true(state.sinceBrainCall <= 2);
});

// --- Detail formatting ---

test('detail includes location and time', (t) => {
  const tracker = new NarrativeTracker();
  const state = tracker.process(ctx({ biome: 'taiga', timeOfDay: 6000 }), 'stable');
  t.true(state.detail.includes('taiga'));
  t.true(state.detail.includes('noon'));
});

test('detail mentions changes', (t) => {
  const tracker = new NarrativeTracker();
  tracker.process(ctx({ isRaining: false }), 'stable');
  const state = tracker.process(ctx({ isRaining: true }), 'stable');
  t.true(state.detail.includes('rain started'));
});
