/* Bot balance report: hit rate and shots per round per difficulty. Run: npx tsx src/tests/balance.ts */
import { DEFAULT_MATCH_CONFIG } from '../gameState/config';
import { MatchSimulation } from '../sim/MatchSimulation';
import type { BotDifficulty } from '../types';

for (const diff of ['EASY', 'NORMAL', 'HARD'] as BotDifficulty[]) {
  let shots = 0;
  let hits = 0;
  let rounds = 0;
  let volleys = 0;
  let time = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sim = new MatchSimulation(
      { ...DEFAULT_MATCH_CONFIG, botDifficulty: diff },
      [1, 2, 3, 4].map((i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })),
      seed,
    );
    sim.start();
    for (let i = 0; i < 30 * 60 * 30 && !sim.finished; i++) {
      sim.tick(1 / 30);
      for (const e of sim.drainEvents()) {
        if (e.type === 'roundEnded') rounds++;
        if (e.type === 'phaseChanged' && e.data.phase === 'SHOOTING') volleys++;
      }
    }
    time += sim.time;
    for (const p of sim.players.values()) {
      shots += p.stats.shots;
      hits += p.stats.hits;
    }
  }
  console.log(
    `${diff.padEnd(6)} hit rate ${((hits / shots) * 100).toFixed(1)}%  shots/round ${(volleys / rounds).toFixed(2)}  round length ${(time / rounds).toFixed(1)}s`,
  );
}
