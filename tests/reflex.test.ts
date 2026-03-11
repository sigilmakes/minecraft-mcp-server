import test from 'ava';
import { ReflexEngine, type ReflexLog } from '../src/perception/reflex.js';
import type { IntegratedPerception } from '../src/perception/integration.js';
import type { SomaState } from '../src/perception/soma.js';
import type { FieldState, FieldItem } from '../src/perception/field.js';
import type { NarrativeState } from '../src/perception/narrative.js';

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
    detail: 'grassland. quiet.',
    ...overrides,
  };
}

function narrativeState(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    doing: 'idle',
    where: '0, 64, 0',
    when: 'midday',
    momentum: 'idle' as any,
    changed: [],
    sinceBrainCall: 0,
    detail: 'idle at 0, 64, 0. midday.',
    ...overrides,
  };
}

function perception(overrides: {
  soma?: Partial<SomaState>;
  field?: Partial<FieldState>;
  narrative?: Partial<NarrativeState>;
} = {}): IntegratedPerception {
  const soma = somaState(overrides.soma);
  const field = fieldState(overrides.field);
  const narrative = narrativeState(overrides.narrative);
  return {
    soma,
    field,
    narrative,
    urgency: { level: 'calm', summary: 'no immediate demands.' },
    relevance: { level: 'irrelevant', summary: 'nothing notable nearby.' },
    momentum: { level: 'steady', summary: 'idle.' },
    shouldCallBrain: false,
    callReason: null,
    prompt: '',
  };
}

// Minimal mock bot for condition testing
function mockPos(x = 0, y = 64, z = 0) {
  return {
    x, y, z,
    distanceTo: (other: any) => Math.sqrt((x - other.x) ** 2 + (y - other.y) ** 2 + (z - other.z) ** 2),
    offset: (dx: number, dy: number, dz: number) => mockPos(x + dx, y + dy, z + dz),
  };
}

function mockBot(overrides: {
  food?: number;
  health?: number;
  oxygenLevel?: number;
  inventory?: { name: string }[];
  entities?: Record<string, any>;
  entity?: any;
} = {}): any {
  const items = (overrides.inventory ?? []).map((i, idx) => ({
    ...i,
    type: idx,
    count: 1,
    slot: idx,
    stackSize: 64,
  }));

  return {
    food: overrides.food ?? 20,
    health: overrides.health ?? 20,
    oxygenLevel: overrides.oxygenLevel ?? 300,
    entity: overrides.entity ?? {
      position: mockPos(),
      yaw: 0,
    },
    entities: overrides.entities ?? {},
    inventory: {
      items: () => items,
    },
    nearestEntity: () => null,
    sprint: () => {},
    setControlState: () => {},
    lookAt: async () => {},
    equip: async () => {},
    consume: async () => {},
    activateItem: () => {},
    deactivateItem: () => {},
    pathfinder: { setGoal: () => {}, stop: () => {} },
  };
}

// --- ReflexEngine basics ---

test('engine starts enabled', (t) => {
  const engine = new ReflexEngine();
  t.true(engine.isEnabled());
});

test('engine can be disabled', (t) => {
  const engine = new ReflexEngine();
  engine.setEnabled(false);
  t.false(engine.isEnabled());
});

test('disabled engine fires nothing', async (t) => {
  const engine = new ReflexEngine();
  engine.setEnabled(false);

  // Starving with food — should trigger eat if enabled
  const p = perception({
    soma: {
      level: 'declining',
      bottleneck: 'food',
      raw: { health: 20, food: 4, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 4, inventory: [{ name: 'bread' }] });

  const logs = await engine.run(p, bot, 1);
  t.is(logs.length, 0);
});

test('eat reflex fires when food is low and has food', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 8, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 8, inventory: [{ name: 'bread' }] });

  const logs = await engine.run(p, bot, 1);
  t.true(logs.some(l => l.reflex === 'eat'));
});

test('eat reflex does NOT fire when food is high', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 18, saturation: 5, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 18, inventory: [{ name: 'bread' }] });

  const logs = await engine.run(p, bot, 1);
  t.false(logs.some(l => l.reflex === 'eat'));
});

test('eat reflex does NOT fire when no food in inventory', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 4, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 4, inventory: [{ name: 'cobblestone' }] });

  const logs = await engine.run(p, bot, 1);
  t.false(logs.some(l => l.reflex === 'eat'));
});

test('cooldown prevents reflex from firing again too soon', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 8, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 8, inventory: [{ name: 'bread' }] });

  // First tick: fires
  const logs1 = await engine.run(p, bot, 1);
  t.true(logs1.some(l => l.reflex === 'eat'));

  // Second tick: on cooldown (eat cooldown = 40)
  const logs2 = await engine.run(p, bot, 2);
  t.false(logs2.some(l => l.reflex === 'eat'));

  // After cooldown: fires again
  const logs3 = await engine.run(p, bot, 50);
  t.true(logs3.some(l => l.reflex === 'eat'));
});

test('flee-explosive fires on nearby creeper', async (t) => {
  const engine = new ReflexEngine();

  const creeperItem: FieldItem = {
    what: 'creeper',
    where: 'north, 5 blocks',
    category: 'threat',
    actionHint: 'flee',
    urgency: 0.8,
  };

  const p = perception({
    field: {
      attention: [creeperItem],
      threatLevel: 'high',
    },
  });

  // Mock bot with a nearby creeper entity
  const bot = mockBot();
  bot.nearestEntity = (filter: any) => {
    const fakeCreeper = {
      name: 'creeper',
      position: { x: 0, y: 64, z: 5, distanceTo: () => 5 },
      height: 1.7,
    };
    return filter(fakeCreeper) ? fakeCreeper : null;
  };

  const logs = await engine.run(p, bot, 1);
  t.true(logs.some(l => l.reflex === 'flee-explosive'));
});

test('flee-explosive suppresses eat (higher priority + exclusive)', async (t) => {
  const engine = new ReflexEngine();

  const creeperItem: FieldItem = {
    what: 'creeper',
    where: 'north, 5 blocks',
    category: 'threat',
    actionHint: 'flee',
    urgency: 0.8,
  };

  const p = perception({
    soma: {
      raw: { health: 20, food: 4, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
    field: {
      attention: [creeperItem],
      threatLevel: 'high',
    },
  });

  const bot = mockBot({ food: 4, inventory: [{ name: 'bread' }] });
  bot.nearestEntity = (filter: any) => {
    const fakeCreeper = {
      name: 'creeper',
      position: { x: 0, y: 64, z: 5, distanceTo: () => 5 },
      height: 1.7,
    };
    return filter(fakeCreeper) ? fakeCreeper : null;
  };

  const logs = await engine.run(p, bot, 1);

  // Flee should fire
  t.true(logs.some(l => l.reflex === 'flee-explosive'));
  // Eat should NOT fire (suppressed by exclusive flee)
  t.false(logs.some(l => l.reflex === 'eat'));
});

test('surface fires on low oxygen', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 20, saturation: 5, oxygen: 60, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ oxygenLevel: 60 });

  const logs = await engine.run(p, bot, 1);
  t.true(logs.some(l => l.reflex === 'surface'));
});

test('surface does NOT fire when oxygen is fine', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 20, saturation: 5, oxygen: 280, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ oxygenLevel: 280 });

  const logs = await engine.run(p, bot, 1);
  t.false(logs.some(l => l.reflex === 'surface'));
});

test('recent logs accumulate', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 8, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 8, inventory: [{ name: 'bread' }] });

  await engine.run(p, bot, 1);
  await engine.run(p, bot, 50); // after cooldown

  const logs = engine.getRecentLogs();
  t.is(logs.length, 2);
  t.true(logs.every(l => l.reflex === 'eat'));
});

test('resetCooldowns allows immediate re-firing', async (t) => {
  const engine = new ReflexEngine();

  const p = perception({
    soma: {
      raw: { health: 20, food: 8, saturation: 0, oxygen: 300, damageTaken: 0, isOnFire: false, effects: [] },
    },
  });
  const bot = mockBot({ food: 8, inventory: [{ name: 'bread' }] });

  await engine.run(p, bot, 1);
  engine.resetCooldowns();

  const logs = await engine.run(p, bot, 2);
  t.true(logs.some(l => l.reflex === 'eat'));
});
