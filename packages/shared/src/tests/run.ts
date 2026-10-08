/* Minimal dependency-free test runner for the shared simulation. Run: npm test */

import { ARENAS, TEST_CHAMBER_01, randomSpawns, resolveCollisions } from '../arena/arena';
import { Rng } from '../util/rng';
import { DEFAULT_MATCH_CONFIG } from '../gameState/config';
import { dirToYaw, sub } from '../math/vec';
import { collectEliminations, computeShots } from '../sim/shotResolution';
import { MatchSimulation } from '../sim/MatchSimulation';
import { sanitizeName, normalizeRoomCode } from '../util/names';
import { AIM_PHASES, MOVE_PHASES, type MatchEvent } from '../types';
import { stepMovement } from '../sim/movement';
import { LOCK_GRACE_SECONDS } from '../constants/game';

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

test('obstacles stop bullets', () => {
  const arena = {
    ...TEST_CHAMBER_01,
    obstacles: [{ kind: 'circle' as const, pos: { x: 0, z: 0 }, radius: 0.8, height: 3 }],
  };
  const shots = computeShots(
    arena,
    [
      { id: 'a', team: 0, pos: { x: 0, z: -5 }, yaw: 0 },
      { id: 'b', team: 0, pos: { x: 0, z: 5 }, yaw: 0 },
    ],
    false,
  );
  assert(shots[0]?.hitSurface === 'PILLAR', `expected PILLAR, got ${shots[0]?.hitSurface}`);
});

test('walking off a floating platform eliminates the subject', () => {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, mapId: 'WHITE_ROOM', botDifficulty: 'EASY' },
    [
      { id: 'h', name: 'Human', isBot: false },
      { id: 'b1', name: 'Bot1', isBot: true },
      { id: 'b2', name: 'Bot2', isBot: true },
    ],
    5,
  );
  sim.start();
  while (sim.phase !== 'VISIBLE') sim.tick(1 / 30);
  const me = sim.players.get('h')!;
  let fell = false;
  for (let seq = 1; seq < 30 * 20 && me.alive; seq++) {
    sim.queueInput('h', { seq, moveX: 1, moveZ: 0, sprint: true, yaw: 0 });
    sim.tick(1 / 30);
    for (const e of sim.drainEvents()) if (e.type === 'playerFell' && e.data.id === 'h') fell = true;
  }
  assert(!me.alive && fell, 'subject should fall off the edge');
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
    for (let i = 0; i < 30 * 60 * 40 && !sim.finished; i++) {
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

test('arena shrinks within a round and resets to full size each new round', () => {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, mapId: 'TEST_CHAMBER_01' },
    [1, 2, 3, 4].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })),
    11,
  );
  sim.start();
  let shrunk = false;
  let checkedReset = false;
  for (let i = 0; i < 30 * 60 * 40 && !sim.finished && !checkedReset; i++) {
    sim.tick(1 / 30);
    if (sim.arenaScale < 1) shrunk = true;
    for (const e of sim.drainEvents()) {
      if (e.type === 'phaseChanged' && e.data.phase === 'ROUND_INTRO' && e.data.round > 1) {
        assert(sim.arenaScale === 1, `round ${e.data.round} started at scale ${sim.arenaScale}`);
        checkedReset = true;
      }
    }
  }
  assert(shrunk && checkedReset, 'expected a shrink and a later round reset');
});

test('hidden phase: free to move, then positions lock for the countdown', () => {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, mapId: 'TEST_CHAMBER_01' },
    [
      { id: 'h', name: 'Human', isBot: false },
      { id: 'b1', name: 'Bot1', isBot: true },
    ],
    3,
  );
  sim.start();
  const me = sim.players.get('h')!;
  let seq = 0;
  const stepAndMeasure = (phase: string): number => {
    while (sim.phase !== phase) {
      sim.queueInput('h', { seq: ++seq, moveX: 0, moveZ: 0, sprint: false, yaw: 0 });
      sim.tick(1 / 30);
    }
    const before = { ...me.pos };
    for (let i = 0; i < 10; i++) {
      sim.queueInput('h', { seq: ++seq, moveX: i % 2 ? 1 : -1, moveZ: 0.3, sprint: false, yaw: 0 });
      sim.tick(1 / 30);
    }
    return Math.hypot(me.pos.x - before.x, me.pos.z - before.z);
  };
  assert(stepAndMeasure('REPOSITION') > 0.05, 'should move during REPOSITION');
  // Let the short lock grace window (for in-flight inputs) pass before checking the lock.
  while (sim.phase !== 'COUNTDOWN') {
    sim.queueInput('h', { seq: ++seq, moveX: 0, moveZ: 0, sprint: false, yaw: 0 });
    sim.tick(1 / 30);
  }
  for (let i = 0; i < Math.ceil((LOCK_GRACE_SECONDS + 0.1) * 30); i++) {
    sim.queueInput('h', { seq: ++seq, moveX: 0, moveZ: 0, sprint: false, yaw: 0 });
    sim.tick(1 / 30);
  }
  assert(stepAndMeasure('COUNTDOWN') < 1e-6, 'must not move during the locked COUNTDOWN');
  const yawBefore = me.yaw;
  for (let i = 0; i < 10; i++) {
    sim.queueInput('h', { seq: ++seq, moveX: 0, moveZ: 0, sprint: false, yaw: yawBefore + 1 + i * 0.1 });
    sim.tick(1 / 30);
  }
  assert(sim.phase !== 'COUNTDOWN' || me.yaw === yawBefore, 'aim must stay locked during the COUNTDOWN');
});

test('phase rules: the locked countdown freezes both movement and aim', () => {
  // The client predicts movement only in MOVE_PHASES; if this ever includes COUNTDOWN again the
  // local subject would jitter (predicted forward, snapped back by the authority).
  for (const p of ['COUNTDOWN', 'FREEZE', 'SHOOTING'] as const) {
    assert(!MOVE_PHASES.has(p), `${p} must not allow movement`);
    assert(!AIM_PHASES.has(p), `${p} must not allow aiming`);
  }
  assert(AIM_PHASES.has('REPOSITION'), 'aiming is allowed during the hidden move time');
  assert(MOVE_PHASES.has('REPOSITION'), 'moving is allowed during the hidden reposition time');
});

test('a solo match with an idle human plays every round to one matchEnded', () => {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, roundsToWin: 2 },
    [{ id: 'h', name: 'Human', isBot: false }, ...[1, 2, 3].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true }))],
    21,
  );
  sim.start();
  let ended = 0;
  let waitingMidMatch = false;
  for (let i = 0; i < 30 * 60 * 40 && !sim.finished; i++) {
    sim.tick(1 / 30);
    if (sim.phase === 'WAITING') waitingMidMatch = true;
    for (const e of sim.drainEvents()) if (e.type === 'matchEnded') ended++;
  }
  assert(sim.finished && ended === 1, `match should end exactly once (ended=${ended})`);
  assert(!waitingMidMatch, 'the match must never drop back to WAITING mid-way');
});

/**
 * A simulated client with network latency: it predicts its own movement, keeps sending
 * inputs until it *sees* the lock (one latency late), and each input reaches the server one
 * latency later. At the end the server's position must equal where the client left its subject.
 */
function lockMismatch(latencyTicks: number): number {
  const sim = new MatchSimulation(
    { ...DEFAULT_MATCH_CONFIG, mapId: 'TEST_CHAMBER_01', repositionSeconds: 2, blindSeconds: 3 },
    [
      { id: 'h', name: 'Human', isBot: false },
      { id: 'b1', name: 'Bot1', isBot: true },
    ],
    9,
  );
  sim.start();
  const me = sim.players.get('h')!;
  const phaseLog: string[] = [];
  const inFlight: { arrive: number; input: { seq: number; moveX: number; moveZ: number; sprint: boolean; yaw: number } }[] = [];
  let predicted = { ...me.pos };
  let seq = 0;
  for (let tick = 0; tick < 30 * 40; tick++) {
    // Deliver inputs that have finished their trip to the server.
    while (inFlight.length > 0 && inFlight[0]!.arrive <= tick) sim.queueInput('h', inFlight.shift()!.input);
    sim.tick(1 / 30);
    phaseLog.push(sim.phase);
    // The client sees the phase one latency late.
    const seen = phaseLog[Math.max(0, tick - latencyTicks)]!;
    if (MOVE_PHASES.has(seen as never)) {
      const a = (tick / 30) * 2.1;
      const cmd = { seq: ++seq, moveX: Math.cos(a), moveZ: Math.sin(a), sprint: tick % 40 < 10, yaw: a };
      predicted = stepMovement(predicted, cmd, 1 / 30, sim.arena);
      inFlight.push({ arrive: tick + latencyTicks, input: cmd });
    }
    // Compare a moment after the lock grace period has ended.
    if (sim.phase === 'FREEZE') return Math.hypot(predicted.x - me.pos.x, predicted.z - me.pos.z);
  }
  throw new Error('never reached FREEZE');
}

test('locking freezes the subject exactly where the player sees it, even with latency', () => {
  for (const latency of [0, 2, 3, 5]) {
    const off = lockMismatch(latency);
    assert(off < 1e-6, `latency ${latency * 33} ms: subject ended ${off.toFixed(3)} m from where the client left it`);
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
