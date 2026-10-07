import { HIDDEN_PHASES, type BodyState, type Phase } from '../types';
import { areEnemies, type SimPlayer } from './SimPlayer';

const toBody = (p: SimPlayer, visibility: BodyState['visibility']): BodyState => ({
  id: p.id,
  pos: { x: p.pos.x, z: p.pos.z },
  yaw: p.yaw,
  alive: p.alive,
  moving: p.moving,
  visibility,
});

/**
 * Decide which bodies a viewer may receive. This is the single place that enforces
 * "hidden means hidden": hidden enemies are omitted from the data entirely.
 *
 * Rules during hidden phases (HIDE / BLIND / COUNTDOWN):
 *  - the viewer always sees themselves;
 *  - alive teammates are sent as 'ghost' (faintly identifiable);
 *  - alive enemies are omitted;
 *  - eliminated spectators see no alive subject except ghosts of their own team,
 *    so they cannot leak positions to the living over external voice chat;
 *  - dead bodies are always visible (they are no secret).
 */
export function visibleBodies(viewer: SimPlayer | undefined, players: Iterable<SimPlayer>, phase: Phase): BodyState[] {
  const hidden = HIDDEN_PHASES.has(phase);
  const out: BodyState[] = [];
  for (const p of players) {
    if (!p.inRound) continue;
    if (!hidden || !p.alive) {
      out.push(toBody(p, 'full'));
      continue;
    }
    if (viewer && p.id === viewer.id) {
      out.push(toBody(p, 'full'));
      continue;
    }
    if (viewer && viewer.team !== 0 && !areEnemies(viewer, p)) {
      out.push(toBody(p, 'ghost'));
    }
  }
  return out;
}
