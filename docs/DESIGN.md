# BLIND SHOT — Design Plan

## 1. Final technology decision

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language, shared types between client and server |
| Rendering | **Three.js** (single engine) | Small, fast, full control of materials/lighting for a toon look |
| UI | **React 18 + Vite** (DOM overlay on top of the canvas) | Chunky game UI in CSS, instant HMR |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) on the client only | Ragdolls and props. Gameplay hit tests do not depend on it |
| Hit tests | Pure-TS analytic raycasts in `packages/shared` | Bit-identical on client (solo) and server (online). No WASM on the server |
| Networking | **Socket.IO 4** with typed event maps | WebSocket with fallback, rooms, reconnect |
| Server | Node 20+, TypeScript, `tsx` in dev, `esbuild` bundle for prod | Can also serve the built client = single-service deploy |
| Audio | Web Audio API, **procedurally synthesised** | Every sound is original; zero licensing risk; tiny download |
| Font | **Anton** (OFL) for display, **Barlow Condensed** (OFL) for body | Heavy, compressed, very readable |

React Three Fiber was considered. The game loop is an explicit, imperative state machine with pooled VFX and ragdolls; driving that from a React reconciler adds overhead and couples game code to React. React owns the menus/HUD only, Three.js owns the world. One rendering engine, no mixing.

## 2. Architecture

```
            ┌──────────────── packages/shared ────────────────┐
            │ types · events · constants · math · arena       │
            │ MatchSimulation  ─ hosts a GameMode             │
            │ BlindShotMode    ─ explicit round state machine │
            │ shotResolution   ─ two-step simultaneous fire   │
            │ BotBrain         ─ fair, memory-based bots      │
            │ visibility       ─ per-viewer snapshot filter   │
            └───────────────▲──────────────────▲──────────────┘
                            │                  │
   apps/client                                  apps/server
   GameSession interface                        RoomManager / Matchmaker
     ├─ LocalSession  (solo: sim runs in tab)   Room → MatchSimulation @30 Hz
     └─ NetSession    (online: Socket.IO)       per-player filtered snapshots @20 Hz
   Engine (Three.js) ← renders a *filtered* view only
   React UI overlay
```

The same `MatchSimulation` runs inside the browser for solo play and inside the server for online play. The renderer never receives hidden enemy data: it consumes the same per-viewer filtered snapshot in both cases, so "invisible means invisible" is enforced by data, not by opacity.

## 3. Folder structure

```
/apps/client/src
  game/core        Engine, loop, input, GameController
  game/characters  SubjectModel (procedural toon character), animation, Ragdoll
  game/weapons     Gun model, LaserSight
  game/maps        TestChamber01
  game/camera      CameraRig
  game/effects     muzzle flash, tracers, smoke, sparks, decals, shake
  game/audio       procedural SFX + ambience
  game/physics     Rapier world wrapper
  game/modes/blindShot  client-side presentation of the Blind Shot phases
  networking       LocalSession, NetSession
  state            settings store, app store
  ui               React screens + HUD
/apps/server/src
  rooms  matchmaking  game  players  modes/blindShot  networking  validation
/packages/shared/src
  types  events  constants  gameState  math  arena  sim  modes/blindShot  bots
```

## 4. Round state machine

A **match** is first-to-N round wins (default 3, i.e. best of 5).
A **round** is played until one subject (or team) remains. It is made of one or more **shots** (volleys); every alive subject fires exactly **once per shot**. Most rounds take 1–3 shots ≈ 15–40 s.

```
ROUND_INTRO (1.6s, "ROUND 03 / BLIND SHOT / MEMORIZE YOUR TARGET")
  → SPAWN (0.6s, subjects drop onto pads)            [first shot of the round only]
  → VISIBLE (5s, "AIM. MEMORIZE.", lasers on)
  → HIDE (0.7s, warning tone, flicker, "VISUAL FEED DISABLED")
  → BLIND (0.8s, "TARGETS HIDDEN")
  → COUNTDOWN (3s, "SHOOTOUT IN 3·2·1")
  → FIRE (instant: snapshot + two-step resolution)
  → RESOLUTION (1.4s, flashes, tracers, ragdolls)
  → REVEAL (1.6s, everyone visible, "2 SURVIVORS")
      ├─ >1 side alive → next shot: VISIBLE (shot counter +1)
      └─ ≤1 side alive → ROUND_RESULTS (3s, "SUBJECT 02 WINS / NEXT ROUND IN 3")
           ├─ someone reached N wins → MATCH_END
           └─ else → ROUND_INTRO
```

Visible / blind durations are host-configurable. If a round reaches 6 shots without a winner, it is a draw. All transitions live in one table in `BlindShotMode`; nothing else changes phase.

## 5. Player data model

```ts
PlayerState {
  id, name, subjectNumber, color, team (0 = none),
  isBot, botDifficulty?, connected, isHost,
  pos {x,z}, yaw, padIndex, alive,
  stats { hits, shots, kills, deaths, roundWins, survivedShots, score }
}
```

## 6. Networking model

* Client → server: `playerInput { seq, move{x,z}, sprint, yaw }` at 30 Hz while in a match. Never "I hit X".
* Server simulates at 30 Hz, sends per-recipient **filtered** snapshots at 20 Hz. During HIDE/BLIND/COUNTDOWN, enemy entries are removed entirely (no position, no yaw, no laser).
* Discrete events: `roomState`, `phaseChanged`, `shootout`, `roundEnded`, `matchEnded`.
* Client predicts its own movement with the shared `stepMovement` and reconciles; remote subjects are interpolated with a 100 ms buffer.
* Reconnect: a session token in localStorage lets a dropped player reclaim their slot for 30 s. Host migrates on leave.

## 7. Simultaneous shot resolution

At FIRE the authority (server, or the local sim in solo):
1. Freezes a snapshot of every **alive** subject: position, yaw → muzzle origin and direction.
2. **Step 1 – compute:** for each shooter, raycast against arena geometry (walls, pillars) and all subjects alive *in the snapshot* (excluding self, and teammates when friendly fire is off). Record `{shooter, origin, dir, end, hitPlayer?, zone}`. No state is modified.
3. **Step 2 – apply:** collect every hit target and eliminate them all at once, then award points.

Because step 1 reads only the frozen snapshot, A and B can kill each other. If every remaining subject (or team) dies, the round is a draw.

## 8. Bot AI design

Bots read the **same filtered view** a human would (no wall-hacks). Each bot keeps a memory of the last-seen position, velocity and aim of each enemy.

| | Easy | Normal | Hard |
|---|---|---|---|
| Reaction delay | 0.6–1.1 s | 0.3–0.6 s | 0.15–0.3 s |
| Memory noise | 1.4 m | 0.6 m | 0.25 m |
| Aim error | ±9° | ±4.5° | ±2° |
| Wrong-target chance | 30% | 10% | 3% |
| Predicts movement | no | velocity × 0.5 | velocity + dodge guess |
| Dodges when aimed at | rarely | sometimes | often |

Targets are chosen with a weighted score (proximity, "is aiming at me", clear line). Bots turn at a limited rate and strafe inside their pad area.

## 9. Asset strategy

Everything is generated in code, so everything is original:
* Subjects: procedural toon models (oversized helmeted head with a visor, chunky jumpsuit, gloves, boots, number patch) built from smoothed primitives, toon-shaded with ink outlines.
* Gun: oversized "industrial test pistol": drum, thick barrel, hazard ring, big grip.
* Map: TEST CHAMBER 01: elevated circular platform, warning stripes, railings, pillars, observation windows, pipes, giant painted chamber numbers, steam.
* Textures: small canvas-generated textures (≤ 512 px).
* Audio: Web Audio synthesis (layered gunshot = transient + sub thump + mechanical clack + room echo).
* Fonts: Anton + Barlow Condensed via `@fontsource` (SIL OFL 1.1).

## 10. Implementation milestones

1. Monorepo, strict TS, renderer, procedural character, arena, camera, movement, aim, gun, laser.
2. Shared sim: state machine, visibility filter, hitscan, two-step shootout, bots.
3. Ragdolls (Rapier), VFX, audio, HUD, menus, results, scoreboard → **polished solo MVP**.
4. Socket.IO server, rooms, codes, quick play, reconnect, host migration.
5. Team mode (2v2–4v4), friendly-fire setting, team scoring.
6. Settings, tutorial, polish, README, deployment config.
