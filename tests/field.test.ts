import test from 'ava';
import {
  classifyEntity,
  classifyResource,
  processField,
  describeTerrain,
  type RawEntity,
  type RawBlockScan,
  type FieldInput,
  type SomaContext,
} from '../src/perception/field.js';

// --- Helpers ---

function soma(overrides: Partial<SomaContext> = {}): SomaContext {
  return { level: 'stable', bottleneck: 'none', ...overrides };
}

function entity(overrides: Partial<RawEntity> = {}): RawEntity {
  return { type: 'zombie', distance: 10, direction: 'north', ...overrides };
}

function blocks(overrides: Partial<RawBlockScan> = {}): RawBlockScan {
  return {
    below: 'grass_block',
    ahead: 'air',
    above: 'air',
    nearbyResources: [],
    shelterNearby: false,
    waterNearby: false,
    ...overrides,
  };
}

function fieldInput(overrides: Partial<FieldInput> = {}): FieldInput {
  return {
    entities: [],
    blocks: blocks(),
    lightLevel: 15,
    ...overrides,
  };
}

// --- classifyEntity ---

test('hostile mob classified as threat', (t) => {
  const item = classifyEntity(entity({ type: 'zombie' }), soma());
  t.is(item.category, 'threat');
  t.true(item.urgency > 0);
});

test('food animal classified as food', (t) => {
  const item = classifyEntity(entity({ type: 'cow', distance: 8 }), soma());
  t.is(item.category, 'food');
});

test('player classified as player', (t) => {
  const item = classifyEntity(
    entity({ type: 'player', name: 'sigil__', distance: 5 }),
    soma()
  );
  t.is(item.category, 'player');
  t.is(item.what, 'sigil__');
});

test('unknown entity classified as neutral', (t) => {
  const item = classifyEntity(entity({ type: 'armor_stand' }), soma());
  t.is(item.category, 'neutral');
});

// --- Threat urgency: opponent processing ---

test('threat urgency increases when body is weak', (t) => {
  const z = entity({ type: 'zombie', distance: 5 });
  const stableUrgency = classifyEntity(z, soma({ level: 'stable' })).urgency;
  const criticalUrgency = classifyEntity(z, soma({ level: 'critical' })).urgency;
  t.true(criticalUrgency > stableUrgency,
    `critical (${criticalUrgency}) should be > stable (${stableUrgency})`);
});

test('threat urgency increases with proximity', (t) => {
  const far = classifyEntity(entity({ type: 'zombie', distance: 15 }), soma()).urgency;
  const near = classifyEntity(entity({ type: 'zombie', distance: 3 }), soma()).urgency;
  t.true(near > far, `near (${near}) should be > far (${far})`);
});

test('creeper has higher base threat than zombie', (t) => {
  const s = soma();
  const creeper = classifyEntity(entity({ type: 'creeper', distance: 8 }), s).urgency;
  const zombie = classifyEntity(entity({ type: 'zombie', distance: 8 }), s).urgency;
  t.true(creeper > zombie, `creeper (${creeper}) should be > zombie (${zombie})`);
});

test('close creeper when dying → flee', (t) => {
  const item = classifyEntity(
    entity({ type: 'creeper', distance: 3 }),
    soma({ level: 'dying' })
  );
  t.is(item.actionHint, 'flee');
});

test('far zombie when thriving → ignore', (t) => {
  const item = classifyEntity(
    entity({ type: 'zombie', distance: 14 }),
    soma({ level: 'thriving' })
  );
  t.is(item.actionHint, 'ignore');
});

// --- Food urgency: opponent processing ---

test('cow urgency high when starving', (t) => {
  const item = classifyEntity(
    entity({ type: 'cow', distance: 6 }),
    soma({ level: 'critical', bottleneck: 'food' })
  );
  t.is(item.category, 'food');
  t.is(item.actionHint, 'hunt');
  t.true(item.urgency > 0.5, `urgency (${item.urgency}) should be > 0.5 when starving`);
});

test('cow urgency low when thriving', (t) => {
  const item = classifyEntity(
    entity({ type: 'cow', distance: 6 }),
    soma({ level: 'thriving', bottleneck: 'none' })
  );
  t.is(item.actionHint, 'ignore');
  t.true(item.urgency < 0.2, `urgency (${item.urgency}) should be < 0.2 when thriving`);
});

// --- Resource classification ---

test('diamond ore has high urgency when stable', (t) => {
  const item = classifyResource(
    { type: 'diamond_ore', distance: 4, direction: 'below' },
    soma()
  );
  t.is(item.category, 'resource');
  t.true(item.urgency > 0.4);
});

test('resources become invisible when dying', (t) => {
  const item = classifyResource(
    { type: 'diamond_ore', distance: 4, direction: 'below' },
    soma({ level: 'dying' })
  );
  t.is(item.urgency, 0, 'diamond should have 0 urgency when dying');
});

test('resources fade when critical', (t) => {
  const stable = classifyResource(
    { type: 'iron_ore', distance: 4, direction: 'east' },
    soma()
  ).urgency;
  const critical = classifyResource(
    { type: 'iron_ore', distance: 4, direction: 'east' },
    soma({ level: 'critical' })
  ).urgency;
  t.true(critical < stable * 0.3,
    `critical (${critical}) should be much less than stable (${stable})`);
});

// --- Terrain description ---

test('grassland terrain', (t) => {
  const terrain = describeTerrain(blocks(), 15);
  t.true(terrain.includes('grassland'));
});

test('underground terrain', (t) => {
  const terrain = describeTerrain(blocks({ below: 'stone' }), 5);
  t.true(terrain.includes('underground'));
  t.true(terrain.includes('dark'));
});

test('shelter noted in terrain', (t) => {
  const terrain = describeTerrain(blocks({ shelterNearby: true }), 12);
  t.true(terrain.includes('shelter'));
});

// --- processField (integration) ---

test('empty field is quiet', (t) => {
  const state = processField(fieldInput(), soma());
  t.is(state.threatLevel, 'none');
  t.is(state.opportunity, null);
  t.true(state.detail.includes('quiet'));
});

test('field with threat sets threat level', (t) => {
  const state = processField(
    fieldInput({
      entities: [entity({ type: 'creeper', distance: 4 })],
    }),
    soma()
  );
  t.not(state.threatLevel, 'none');
  t.true(state.attention.length > 0);
  t.is(state.attention[0]!.category, 'threat');
});

test('field limits attention to 5 items', (t) => {
  const entities: RawEntity[] = [];
  for (let i = 0; i < 10; i++) {
    entities.push(entity({ type: 'zombie', distance: 5 + i, direction: 'north' }));
  }
  const state = processField(fieldInput({ entities }), soma());
  t.is(state.attention.length, 5);
});

test('field: attention sorted by urgency (highest first)', (t) => {
  const state = processField(
    fieldInput({
      entities: [
        entity({ type: 'zombie', distance: 15 }),
        entity({ type: 'creeper', distance: 3 }),
      ],
    }),
    soma()
  );
  t.true(state.attention.length >= 2);
  t.true(state.attention[0]!.urgency >= state.attention[1]!.urgency);
  t.is(state.attention[0]!.what, 'creeper');
});

test('field: cow becomes opportunity when hungry', (t) => {
  const state = processField(
    fieldInput({
      entities: [entity({ type: 'cow', distance: 6, direction: 'east' })],
    }),
    soma({ level: 'declining', bottleneck: 'food' })
  );
  t.not(state.opportunity, null);
  t.true(state.opportunity!.includes('cow'));
});

test('field: shelter appears as item when body is critical', (t) => {
  const state = processField(
    fieldInput({
      blocks: blocks({ shelterNearby: true }),
    }),
    soma({ level: 'critical', bottleneck: 'health' })
  );
  const shelterItem = state.attention.find(i => i.what === 'shelter');
  t.truthy(shelterItem);
  t.true(shelterItem!.urgency > 0.5);
});

test('field: shelter does not appear when thriving', (t) => {
  const state = processField(
    fieldInput({
      blocks: blocks({ shelterNearby: true }),
    }),
    soma({ level: 'thriving' })
  );
  const shelterItem = state.attention.find(i => i.what === 'shelter');
  t.falsy(shelterItem);
});

test('field: when critically starving, food outranks moderate threats and resources', (t) => {
  const state = processField(
    fieldInput({
      entities: [
        entity({ type: 'zombie', distance: 6, direction: 'north' }),
        entity({ type: 'cow', distance: 8, direction: 'east' }),
      ],
      blocks: blocks({
        nearbyResources: [
          { type: 'diamond_ore', distance: 5, direction: 'below' },
        ],
      }),
    }),
    soma({ level: 'critical', bottleneck: 'food' })
  );

  // When critically starving: food outranks moderate-distance threats
  // (the body screams "FOOD" louder than "DANGER" when starvation is the bottleneck)
  t.true(state.attention.length >= 3);
  t.is(state.attention[0]!.category, 'food');

  // Food should rank above diamonds during crisis
  const foodIdx = state.attention.findIndex(i => i.category === 'food');
  const resourceIdx = state.attention.findIndex(i => i.category === 'resource');
  t.true(foodIdx < resourceIdx,
    'food should rank above resources when starving');
});

test('field: close threat dominates even when starving', (t) => {
  const state = processField(
    fieldInput({
      entities: [
        entity({ type: 'creeper', distance: 2, direction: 'north' }),
        entity({ type: 'cow', distance: 8, direction: 'east' }),
      ],
    }),
    soma({ level: 'critical', bottleneck: 'food' })
  );

  // A creeper 2 blocks away is more urgent than any cow
  t.is(state.attention[0]!.category, 'threat');
  t.is(state.attention[0]!.actionHint, 'flee');
});
