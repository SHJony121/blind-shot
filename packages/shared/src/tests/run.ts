/* Minimal dependency-free test runner for the shared simulation. Run: npm test */

import { ARENAS, TEST_CHAMBER_01, randomSpawns, resolveCollisions } from '../arena/arena';
import { Rng } from '../util/rng';
import { DEFAULT_MATCH_CONFIG } from '../gameState/config';
import { dirToYaw, sub } from '../math/vec';
import { collectEliminations, computeShots } from '../sim/shotResolution';
import { MatchSimulation } from '../sim/MatchSimulation';
import { sanitizeName, normalizeRoomCode } from '../util/names';
import type { MatchEvent } from '../types';

let failures = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

console.log('shared simulation tests');

test('two subjects facing each other eliminate each other simultaneously', () => {
  const a = { id: 'a', team: 0 as const, pos: { x: 0, z: -5 }, yaw: 0 };
  const b = { id: 'b', team: 0 as const, pos: { x: 0, z: 5 }, yaw: Math.PI };
  const shots = computeShots(TEST_CHAMBER_01, [a, b], false);
  const dead = collectEliminations(shots).sort();
  assert(dead.join(',') === 'a,b', `expected mutual kill, got ${dead.join(',')}`);
});

test('result does not depend on shooter order', () => {
  const s = [
    { id: 'a', team: 0 as const, pos: { x: -5, z: 0 }, yaw: Math.PI / 2 },
    { id: 'b', team: 0 as const, pos: { x: 5, z: 0 }, yaw: -Math.PI / 2 },
    { id: 'c', team: 0 as const, pos: { x: 0, z: 6 }, yaw: dirToYaw(sub({ x: 5, z: 0 }, { x: 0, z: 6 })) },
  ];
  const d1 = collectEliminations(computeShots(TEST_CHAMBER_01, s, false)).sort().join();
  const d2 = collectEliminations(computeShots(TEST_CHAMBER_01, [...s].reverse(), false)).sort().join();
  assert(d1 === d2, `order changed result: ${d1} vs ${d2}`);
});

test('pillars stop bullets', () => {
  const pillar = TEST_CHAMBER_01.obstacles.find((o) => o.kind === 'circle');
  if (!pillar) throw new Error('arena has pillars');
  const from = { x: 0, z: 0 };
  const behind = { x: pillar.pos.x * 2, z: pillar.pos.z * 2 };
  const yaw = dirToYaw(sub(behind, from));
  const shots = computeShots(
    TEST_CHAMBER_01,
    [
      { id: 'a', team: 0, pos: from, yaw },
      { id: 'b', team: 0, pos: behind, yaw: 0 },
    ],
    false,
  );
  assert(shots[0]?.hitSurface === 'PILLAR', `expected PILLAR, got ${shots[0]?.hitSurface}`);
});

test('friendly fire off lets bullets pass through teammates', () => {
  const shots = computeShots(
    TEST_CHAMBER_01,
    [
      { id: 'a', team: 1, pos: { x: 0, z: -6 }, yaw: 0 },
      { id: 'mate', team: 1, pos: { x: 0, z: -2 }, yaw: 0 },
      { id: 'enemy', team: 2, pos: { x: 0, z: 5 }, yaw: Math.PI / 2 },
    ],
    false,
  );
  assert(shots[0]?.hitPlayerId === 'enemy', `expected enemy, got ${shots[0]?.hitPlayerId}`);
});

test('hidden enemies are absent from a viewer snapshot', () => {
  const sim = new MatchSimulation(
    DEFAULT_MATCH_CONFIG,
    [
      { id: 'h', name: 'Human', isBot: false },
      { id: 'b1', name: 'Bot1', isBot: true },
      { id: 'b2', name: 'Bot2', isBot: true },
    ],
    42,
  );
  sim.start();
  let sawHidden = false;
  for (let i = 0; i < 30 * 15 && !sawHidden; i++) {
    sim.tick(1 / 30);
    if (sim.phase === 'COUNTDOWN') {
      sawHidden = true;
      const view = sim.buildView('h');
      assert(view.bodies.length === 1 && view.bodies[0]?.id === 'h', 'only self should be visible while hidden');
    }
  }
  assert(sawHidden, 'reached COUNTDOWN phase');
});

test('a full bot match always terminates with a winner or a draw', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const sim = new MatchSimulation(
      { ...DEFAULT_MATCH_CONFIG, botDifficulty: 'HARD' },
      [1, 2, 3, 4].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })),
      seed,
    );
    sim.start();
    const events: MatchEvent[] = [];
    for (let i = 0; i < 30 * 60 * 20 && !sim.finished; i++) {
      sim.tick(1 / 30);
      events.push(...sim.drainEvents());
    }
    assert(sim.finished, `seed ${seed}: match did not finish`);
    assert(events.some((e) => e.type === 'matchEnded'), `seed ${seed}: no matchEnded event`);
  }
});

test('team match terminates', () => {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, mode: 'TEAMS' },
    [1, 2, 3, 4].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })),
    7,
  );
  sim.start();
  for (let i = 0; i < 30 * 60 * 20 && !sim.finished; i++) sim.tick(1 / 30);
  assert(sim.finished, 'team match did not finish');
});

test('sequential volley: a subject shot earlier never fires', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const sim = new MatchSimulation(
      { ...DEFAULT_MATCH_CONFIG, fireOrder: 'SEQUENTIAL' },
      [1, 2, 3, 4].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })),
      seed,
    );
    sim.start();
    const dead = new Set<string>();
    for (let i = 0; i < 30 * 60 * 10 && !sim.finished; i++) {
      sim.tick(1 / 30);
      for (const e of sim.drainEvents()) {
        if (e.type === 'roundEnded') dead.clear();
        if (e.type !== 'shotFired') continue;
        assert(!dead.has(e.data.result.shooterId), `seed ${seed}: dead subject fired`);
        for (const id of e.data.eliminated) dead.add(id);
      }
    }
  }
});

test('spawns stay inside the arena and clear of obstacles', () => {
  for (const arena of Object.values(ARENAS)) {
    const spawns = randomSpawns(arena, [0, 0, 0, 0, 0, 0, 0, 0], new Rng(3));
    for (const s of spawns) {
      assert(Math.abs(s.pos.x) < arena.halfX && Math.abs(s.pos.z) < arena.halfZ, `${arena.id}: spawn outside`);
      const r = resolveCollisions(arena, s.pos, 0.5);
      assert(Math.hypot(r.x - s.pos.x, r.z - s.pos.z) < 1e-6, `${arena.id}: spawn inside an obstacle`);
    }
  }
});

test('names and room codes are sanitised', () => {
  assert(sanitizeName('<script>alert(1)</script>') === 'scriptalert1sc', 'strips markup');
  assert(sanitizeName('   ') === 'Guest', 'falls back');
  assert(normalizeRoomCode('k7d4q') === 'K7D4Q', 'uppercases');
  assert(normalizeRoomCode('K7D4O') === null, 'rejects ambiguous letters');
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
