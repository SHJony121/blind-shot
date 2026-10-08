# BLIND SHOT

> **Remember. Aim. Fire.** A 3D party game that runs straight in the browser: open the link, type a name, and play.

Every subject in the test chamber holds a gun with a laser sight. For a few seconds you can see everyone and where they are aiming. Then the lights cut out and **every opponent disappears**: you can still run and aim, but you're playing from memory. A popup counts down `PLAYERS REVEALED IN 5 · 4 · 3 · 2 · 1`, then everyone reappears and **freezes** with their aim locked. The shots go off **one by one**, the ragdolls fly, and the last subject standing wins.

| Visible: memorise | Hidden: they're gone | Freeze: aims locked | Shots, one by one |
|---|---|---|---|
| ![Visible phase](docs/screenshots/visible-phase.png) | ![Hidden phase](docs/screenshots/blind-phase.png) | ![Freeze](docs/screenshots/factory-freeze.png) | ![Shooting](docs/screenshots/shootout.png) |

| Main menu | Teams: allies stay ghosted |
|---|---|
| ![Menu](docs/screenshots/menu.png) | ![Teams](docs/screenshots/teams-ghost.png) |

<!-- TODO: add a short gameplay GIF -->

---

## Core loop

`SEE → AIM → MEMORIZE → DISAPPEAR → PREDICT → FREEZE → SHOOT (ONE BY ONE) → LAUGH → REPEAT`

| Phase | What happens |
|---|---|
| **Round intro** | `ROUND 03` → `BLIND SHOT` → `MEMORIZE YOUR TARGET.` |
| **Spawn** | Subjects drop in at random spots anywhere on the floor |
| **Visible (5 s, up to 15 s)** | Everyone is visible with laser sights. Move, aim, read who is aiming at you, and memorise |
| **Hide** | Warning tone, the lights flicker, and enemies vanish (`TARGETS HIDDEN`) |
| **Hidden: move (5 s, 2–15 s)** | Enemies are truly gone. Everyone can still move to a new spot and aim. Popup: `MOVE · POSITIONS LOCK IN 5…1` |
| **Hidden: locked countdown (5 s, up to 15 s)** | `POSITIONS LOCKED`: nobody can move any more, but you can still turn and aim. Popup: `PLAYERS REVEALED IN 5 · 4 · 3 · 2 · 1` |
| **Freeze (3 s)** | Everyone reappears where they really are. Nobody can move, and every aim is locked (`FREEZE!`). Scroll and drag to inspect the lasers |
| **Shooting** | Subjects fire **one at a time** in a random order. A subject who gets shot before their turn never fires |
| **Reveal** | `HIT!`, `MISS`, `EVERYBODY MISSED`, `2 SURVIVORS`… |
| **Round results** | Volleys repeat until one subject (or team) is left. That side wins the round |

Hosts can switch **Shots** to `ALL AT ONCE`, where every subject fires simultaneously and two subjects can kill each other.

## Maps

| Map | Size | Layout |
|---|---|---|
| **White Room** (default) | 32 × 32 m | Bright white checker platform floating high in the sky. No walls: walk off the orange edge and you fall to your death |
| **Test Chamber 01** | 28 × 28 m | Open square floor inside the industrial chamber |
| **Factory Floor** | 36 × 26 m | Long, open brick factory hall |
| **Cooling Room** | 30 × 30 m | Open tiled reactor cooling room |

A match is **first to 3 round wins** (best of 5). Hosts can change this.

**The arena shrinks after every volley.** After each volley of shots the boundary slides in by 10% (down to 40% of the full size), with an `ARENA SHRINKING` callout. Anyone left outside is pushed back in. Every new round starts again at full size. On the White Room the edge is a bold orange line, and beyond it there is only sky.

## Characters

Pick your character on the main menu (◀ ▶ under your name). The choice is saved in your browser, and other players see it online. Bots pick at random. All eight are original designs with their own body shapes:

| Character | Look |
|---|---|
| **Test Dummy** | The original round toon test subject in a jumpsuit, helmet and visor |
| **The Blind** | Slim blocky figure, spiky white hair, black blindfold, dark outfit |
| **Brawler** | Big chunky build, white headband, red shirt, green trousers |
| **Agent** | Black suit, white shirt, red tie, shades, slicked hair |
| **Punk** | Skinny, pink mohawk, open black jacket, jeans |
| **Cowpoke** | Wide-brim hat, red bandana, rust shirt |
| **Unit Bot** | Boxy metal robot with a screen face and an antenna |
| **Astro** | Toon subject in a glass bubble helmet |

In TEAMS mode the blocky characters wear their team colour as their shirt.

## Controls (desktop)

| Input | Action |
|---|---|
| Mouse | Aim. Your subject turns to face the cursor |
| WASD / arrows | Move anywhere on the floor (while visible and during the hidden move time; never during the locked countdown or the freeze) |
| Shift | Sprint |
| Tab | Scoreboard |
| Mouse wheel | Zoom in (toward the cursor) and out, at any time |
| Click + drag (any mouse button, any time) | Turn the view freely: orbit the camera, tilt down low to see the sky. Your aim holds still while you drag |
| C | Reset the camera view |
| Esc | Pause / menu |

You never press fire. Your shot goes off automatically after the freeze, so you get **one shot per volley**, and it goes wherever you were aiming when the freeze hit. In Settings you can switch to a pointer-locked "mouse turn" aim mode.

## Modes

* **Solo:** you plus 1 to 7 bots (EASY / NORMAL / HARD). It runs entirely in your browser with no server needed.
* **Quick Play:** joins an open public lobby, or creates one.
* **Private Room:** creates a room with a 5-character code (e.g. `K7D4Q`) for friends to join. The host configures the mode, max players (2–8), rounds, visible and hidden phase length, shot order (one by one / all at once), friendly fire, bot fill and map.
* **Free For All:** last subject alive wins the round. If everyone dies at once, the round is a draw.
* **Teams (2v2 / 3v3 / 4v4):** blue vs orange. Teammates stay faintly visible (ghosted) while enemies are hidden. Friendly fire is off by default; with it off, bullets pass through teammates.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Rendering | Three.js (one engine), toon shading with inverted-hull ink outlines |
| UI | React 18 overlay, Vite |
| Physics | Rapier (`@dimforge/rapier3d-compat`), used only on the client for ragdolls and flying guns |
| Gameplay hit tests | Analytic 2D raycasts in `packages/shared`, identical on client and server |
| Networking | Socket.IO 4 with fully typed event maps |
| Server | Node 20+, plain `http` + Socket.IO; it can also serve the built client |
| Audio | Web Audio API, procedurally synthesised (no audio files) |

## Architecture

```
apps/
  client/            Vite + React + Three.js game client
    src/game/        core (Engine, ClientWorld, GameController, Input), characters, weapons,
                     maps, camera, effects, audio, physics, modes/blindShot (presenter)
    src/networking/  GameSession interface, LocalSession (solo), NetSession + NetClient (online)
    src/state/       settings + HUD stores
    src/ui/          menus, lobby, HUD, results, settings, tutorial
  server/            Node + Socket.IO authoritative server
    src/rooms/       Room (lobby + match + host + reconnect), RoomManager (codes, quick play)
    src/game/        MatchRunner (30 Hz sim, 20 Hz filtered snapshots)
    src/networking/  typed handlers; src/players/ guest identities; src/validation/ rate limits
packages/
  shared/            Everything both sides agree on
    src/types, events, constants, gameState (config sanitiser), math, arena
    src/sim/         MatchSimulation, movement, visibility filter, shot resolution
    src/modes/       GameMode interface + BlindShotMode (the round state machine)
    src/bots/        BotBrain (fair, memory-based bots)
```

**One simulation, two hosts.** `MatchSimulation` is the same code in both places. For solo it runs inside the browser (`LocalSession`), and for online play it runs on the server (`MatchRunner`). The renderer only ever consumes a `MatchView`, so it cannot tell the two apart.

**Modular game modes.** `GameMode` (`initialize / startRound / update / endRound / cleanup`) is the extension point. `BlindShotMode` is the first implementation, and future modes (Quick Draw, Double Shot, Ricochet…) can plug into `MatchSimulation` the same way.

**Explicit state machine.** Every phase transition lives in `BlindShotMode.advance()`. Nothing else changes the phase.

## Multiplayer architecture

* The **server is authoritative** for the round phase, timers, movement, alive state, shot resolution, score, victory and room state.
* Clients send only **intent**: `playerInput { seq, moveX, moveZ, sprint, yaw }` at 30 Hz. A client never says "I hit X".
* Every input is sanitised (finite numbers, move vector clamped, yaw wrapped) and rate-limited. The server queues them and applies **one input per tick**, so a client cannot bank inputs to move faster.
* The server sends **per-player filtered snapshots** at 20 Hz. While enemies are hidden, their entries are **removed from the data**. Position, yaw, laser and shadow can't leak because the client never receives them. Eliminated spectators get the same filtering, so they can't call out positions over voice chat.
* The local subject is predicted with the shared `stepMovement` and reconciled by replaying unacknowledged inputs. Remote subjects are interpolated with a 100 ms buffer.
* **Reconnect:** a guest session token (per tab) lets a dropped player reclaim their seat for 30 s. If the host leaves, host transfers to the next player. A player who drops mid-round is removed from that round safely, and if only one side remains, the round finishes.

## How the shots are resolved

When the hidden countdown ends, the server enters **FREEZE**: movement and aim input stop being applied, so every subject's position and aim are locked on the server. Clients only ever sent intent, so nobody can change their aim after the lock.

**One by one (default)** (`BlindShotMode.updateShooting()`):

1. The living subjects are shuffled into a random firing order, so nobody is always first.
2. Every 0.85 s the next subject fires: the server raycasts from their muzzle along their locked aim against the walls, obstacles and every subject still alive.
3. A hit eliminates the target immediately. A subject who is eliminated before their turn never fires.
4. Once only one side is left, the remaining turns are skipped.

**All at once (host option)** (`BlindShotMode.fireSimultaneous()`):

1. Compute every shot from one frozen snapshot (pure, changes nothing).
2. Apply all eliminations together. A and B can kill each other, and shooter order never matters (there is a unit test for this). If everyone dies at once, the round is a draw.

The server owns the timing, so latency never decides who shoots first. Each shot is broadcast as a `shotFired` event, and clients play the flash, tracer, sound and ragdoll for it.

Scoring: hit +100, elimination +100, survived volley +50, round win +200.

## Local setup

Requires **Node 20+**.

```bash
npm install
npm run dev          # server on :3001 + client on :5173 together
```

Open <http://localhost:5173>. Solo works even if the server is not running.

Other scripts:

```bash
npm run dev:client   # client only (solo play)
npm run dev:server   # server only
npm run typecheck    # strict TS across all packages
npm test             # shared simulation tests (mutual kills, order-independence, visibility…)
npm run smoke -w @blindshot/server   # end-to-end multiplayer test against a running server
npx tsx packages/shared/src/tests/balance.ts   # bot hit-rate / round-length report
```

## Environment variables

See [`.env.example`](.env.example).

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `PORT` | server | `3001` | Port to listen on (set automatically by most hosts) |
| `BLINDSHOT_PORT` | server | — | Overrides `PORT` (handy when tooling sets `PORT` for the client) |
| `CORS_ORIGIN` | server | `*` | Comma-separated allowed origins when the client is hosted elsewhere |
| `CLIENT_DIST` | server | `apps/client/dist` | Built client to serve from the same process |
| `VITE_SERVER_URL` | client (build time) | same origin (prod) / `:3001` (dev) | Where the client connects for online play |

## Production build

```bash
npm install
npm run build        # builds apps/client/dist and apps/server/dist
npm start            # serves the game AND the Socket.IO server on $PORT
```

## Deployment

**Option A, one service (simplest).** Deploy the whole repo to any WebSocket-friendly Node host (Railway, Render, Fly.io). The server serves the built client, so no CORS or extra configuration is needed.

* Build command: `npm install && npm run build`
* Start command: `npm start`
* A [`render.yaml`](render.yaml) blueprint and a [`Dockerfile`](Dockerfile) (for Fly.io / Railway / anything Docker) are included.

**Option B, static client plus game server.**

1. Deploy the server (Railway / Render / Fly.io) with `npm run build -w @blindshot/server` and `npm start`, and set `CORS_ORIGIN=https://your-client.example`.
2. Deploy `apps/client` to Vercel, Netlify or Cloudflare Pages with build command `npm run build -w @blindshot/client`, output `apps/client/dist`, and env `VITE_SERVER_URL=https://your-server.example`.

## Roadmap

Done in v0.1: the solo MVP (bots, best-of-5, ragdolls, VFX, audio, HUD, results, settings, tutorial), online rooms with quick play, reconnect and host transfer, and team mode.

Next:

* [ ] TODO: 2–4 s **replay** after each shootout (true positions, aim lines, hits)
* [ ] TODO: touch controls (left stick move, right stick aim; firing is already automatic)
* [ ] TODO: style points (Double Kill, Longest Shot, No-Move Kill, Mutual Elimination)
* [ ] TODO: pre-shootout emotes (wave, point, shrug)
* [ ] TODO: more arenas (Factory Floor, Cargo Platform, Cooling Room…) behind the existing `ArenaDef` / `MapId`
* [ ] TODO: more modes behind the `GameMode` interface (Quick Draw, Double Shot, Moving Target, Ricochet)
* [ ] TODO: cosmetic jumpsuits, helmets and gun skins (no pay-to-win)
* [ ] TODO: optional stylised gore toggle

## Asset credits

Every model, texture and visual effect is **original and generated in code**, and all sounds are either synthesised or CC0 recordings. Nothing is copied from another game.

* **3D models:** procedural (`SubjectModel`, `GunModel`, `TestChamber`) built from Three.js primitives.
* **Textures:** drawn at runtime with Canvas 2D (`characters/textures.ts`, `maps/arenaTextures.ts`).
* **Gunshots:** real recordings from [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) (CC0 1.0, public domain): single shots from the 1911 (takes A_42P, A_34P) and Smith & Wesson 642 (take V_22P), trimmed, mono, 44.1 kHz. Stored in `apps/client/public/sfx/` with a `LICENSE.txt`. The synthesized shot is only a fallback if the files fail to load.
* **Other audio:** synthesised at runtime with the Web Audio API (`audio/AudioEngine.ts`).
* **Fonts:** [Anton](https://fonts.google.com/specimen/Anton) by Vernon Adams and [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) by Jeremy Tribby, both under the SIL Open Font License 1.1, bundled via `@fontsource`.
* **Libraries:** Three.js (MIT), Rapier (Apache-2.0), React (MIT), Socket.IO (MIT), Vite (MIT).
