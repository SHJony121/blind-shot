import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Server } from 'socket.io';
import { CLIENT_DIST, CORS_ORIGIN, PORT } from './config';
import { registerHandlers } from './networking/handlers';
import type { BlindShotServer } from './networking/types';
import { PlayerRegistry } from './players/PlayerRegistry';
import { RoomManager } from './rooms/RoomManager';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

let rooms: RoomManager;

/** Serves /health and, when a client build is present, the static game itself. */
function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms?.size ?? 0 }));
    return;
  }
  if (!CLIENT_DIST) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('BLIND SHOT server is running. Start the client with `npm run dev`.');
    return;
  }
  const root = resolve(CLIENT_DIST);
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(join(root, safe));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(root, 'assets')}`);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const http = createServer(handleHttp);
const io: BlindShotServer = new Server(http, {
  cors: { origin: CORS_ORIGIN },
  // Small payloads at 20-30 Hz: keep latency low.
  perMessageDeflate: false,
  pingInterval: 10000,
  pingTimeout: 8000,
});

rooms = new RoomManager(io);
registerHandlers(io, rooms, new PlayerRegistry());

http.listen(PORT, () => {
  console.log(`[blindshot] server listening on :${PORT}${CLIENT_DIST ? ` (serving client from ${CLIENT_DIST})` : ''}`);
});
