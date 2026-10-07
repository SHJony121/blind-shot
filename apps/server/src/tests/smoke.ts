/**
 * End-to-end multiplayer smoke test against a running server.
 *   npm run dev:server   (in another terminal)
 *   npm run smoke -w @blindshot/server
 * Two guests create/join a private room, start a 2-human + 2-bot match, and the test
 * checks that hidden enemies never appear in a snapshot and that shootouts resolve.
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, MatchView, RoomState, ServerToClientEvents, ShootoutEvent } from '@blindshot/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const URL = process.env.SERVER_URL ?? 'http://localhost:3001';

const connect = (): Promise<S> =>
  new Promise((resolve, reject) => {
    const s: S = io(URL, { transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const hello = (s: S, name: string) =>
  new Promise<string>((resolve, reject) =>
    s.emit('hello', { name }, (r) => (r.ok ? resolve(r.data.playerId) : reject(new Error(r.error)))),
  );

async function main() {
  const a = await connect();
  const b = await connect();
  const idA = await hello(a, 'Alpha');
  const idB = await hello(b, 'Bravo');

  const room = await new Promise<RoomState>((resolve, reject) =>
    a.emit('createRoom', { visibleSeconds: 2, blindSeconds: 2, roundsToWin: 1 }, (r) => (r.ok ? resolve(r.data) : reject(new Error(r.error)))),
  );
  console.log(`room ${room.code} created`);
  await new Promise<RoomState>((resolve, reject) =>
    b.emit('joinRoom', room.code.toLowerCase(), (r) => (r.ok ? resolve(r.data) : reject(new Error(r.error)))),
  );
  a.emit('updateRoom', { botFill: 2 });
  await new Promise((r) => setTimeout(r, 200));

  let leaks = 0;
  let blindViews = 0;
  let shootouts = 0;
  const check = (viewer: string) => (v: MatchView) => {
    if (v.phase === 'BLIND' || v.phase === 'COUNTDOWN') {
      blindViews++;
      for (const body of v.bodies) if (body.id !== viewer && body.alive) leaks++;
    }
  };
  a.on('snapshot', check(idA));
  b.on('snapshot', check(idB));
  a.on('shootout', (e: ShootoutEvent) => {
    shootouts++;
    console.log(`shootout r${e.round}s${e.shot}: ${e.shots.length} shots, eliminated ${e.eliminated.length}`);
  });
  const ended = new Promise<void>((resolve) => a.on('matchEnded', () => resolve()));
  // Keep inputs flowing like a real client would.
  let seq = 0;
  const pump = setInterval(() => {
    seq++;
    a.emit('playerInput', { seq, moveX: 0, moveZ: 0, sprint: false, yaw: seq * 0.01 });
    b.emit('playerInput', { seq, moveX: 1, moveZ: 0, sprint: false, yaw: -seq * 0.01 });
  }, 33);

  await new Promise<void>((resolve, reject) => a.emit('startMatch', (r) => (r.ok ? resolve() : reject(new Error(r.error)))));
  console.log('match started');
  await Promise.race([ended, new Promise((_, rej) => setTimeout(() => rej(new Error('match did not end in 120s')), 120000))]);
  clearInterval(pump);
  a.close();
  b.close();

  console.log(`blind snapshots: ${blindViews}, leaked enemies: ${leaks}, shootouts: ${shootouts}`);
  if (leaks > 0) throw new Error('hidden enemy data leaked to a client');
  if (blindViews === 0 || shootouts === 0) throw new Error('match never reached blind phase / shootout');
  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
