import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT ?? 3001);

/** Comma-separated list of allowed browser origins, or "*" (default) for any. */
export const CORS_ORIGIN: string | string[] = (() => {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();

/**
 * Built client to serve from this same process (single-service deploys).
 * Defaults to apps/client/dist relative to this server; disabled when it does not exist.
 */
export const CLIENT_DIST: string | null = (() => {
  const candidates = [
    process.env.CLIENT_DIST,
    resolve(here, '../../client/dist'),
    resolve(here, '../../../apps/client/dist'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(resolve(p, 'index.html'))) ?? null;
})();

/** Max inputs per second accepted from one socket (client sends 30). */
export const MAX_INPUTS_PER_SECOND = 60;
