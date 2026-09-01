# Animal Care Co-op

A 2D veterinary-clinic time-management prototype built from the project's design document.

The current focus is the **local gameplay loop**. Multiplayer infrastructure remains in the repository, but networking is deliberately paused while the clinic, patients, physical object handling and moment-to-moment game feel are developed further.

## Current playable slice

- **procedurally generated clinic** on every new run;
- six functional rooms arranged around a central corridor;
- reception now includes the **waiting area inside the same room**;
- three physical queue seats are mapped 1:1 to visible chairs;
- one storage room, one diagnostics room and **three treatment rooms**;
- procedural room order, room widths and door positions;
- walls, narrow doorways and soft circulation bottlenecks;
- procedural functional decorations: chairs, plants, cabinets, sinks and bins;
- decoration placement keeps critical routes clear;
- visible dog, cat and rabbit patients;
- patients walk autonomously between the entrance, their assigned reception seat, diagnostics, treatment rooms and exit;
- patients reserve a concrete workstation immediately after admission and wait for that specific room if it is unavailable;
- two case-flow archetypes: direct treatment and longer diagnostic chains;
- six rotating patient profiles;
- physical world items inspired by Overcooked-style handling;
- two physical copies of each core supply to make staging meaningful;
- one carried object at a time;
- items can be picked up, carried above the player, dropped on the floor and picked up again;
- **limited-capacity staging counters** in work rooms;
- items can be placed on counters, collected later and transferred between rooms;
- treatment stations consume the required carried object and restock supplies after a delay;
- dirty workstations require physically fetching disinfectant;
- first environmental maintenance event: **spilled fluid in the corridor** slows movement, increases clinic stress over time and must be cleaned with disinfectant;
- patient priorities, patience and clinic stress;
- timing-treatment and sample-analysis minigames;
- coins, shift timer and 0–3 star results screen;
- deterministic clinic seeds for reproducing a generated map;
- renderer-independent domain, workflow, route and procedural-layout tests.

## Stack

- Phaser 3
- TypeScript
- Vite
- Vitest
- Colyseus server scaffold (currently not the gameplay focus)
- npm workspaces (`apps/client`, `apps/server`, `packages/shared`)

## Quick start

After cloning the repository, **you do not need to run `npm install` manually**.

### Windows

Double-click:

```text
start.bat
```

Or from a terminal:

```bash
start.bat
```

The launcher automatically:

1. checks whether dependencies are already installed and current;
2. runs `npm install` only on the first launch or after dependency manifests change;
3. builds the shared package;
4. starts Vite;
5. opens the game in your browser.

Normal workflow:

```bash
git clone https://github.com/quendae/AnimalHospital2D.git
cd AnimalHospital2D
start.bat
```

### Any platform with Node.js

```bash
npm start
```

On Linux/macOS:

```bash
sh start.sh
```

Node.js 22+ is recommended.

To reproduce a particular generated hospital, add a seed to the URL, for example:

```text
?seed=12345
```

## Controls

- **WASD / Arrow keys** — move
- **E / Space** — interact / admit / pick up / place on counter / drop / deliver / clean / start treatment
- **1–4** — choose a filter during sample analysis
- **Q** — show the current priority task
- **R** — after results, generate a fresh clinic and start again

## Gameplay flow

1. Start the shift. Patients enter reception and occupy one of the three physical chairs.
2. Use quiet moments to stage frequently needed supplies on work-room counters.
3. Admit the next seated patient at reception.
4. The patient is immediately assigned to a concrete analyzer or treatment table and walks there automatically.
5. If that workstation is unavailable, the patient waits for the assigned room instead of choosing another one silently.
6. Fetch and physically deliver the required item.
7. Complete the treatment/analysis minigame.
8. A simple case heads toward the exit; a diagnostic case may continue to another room for a second stage.
9. Clean dirty workstations and environmental spills with disinfectant.
10. Keep the whole clinic flow moving until the shift ends.

## Procedural clinic generation

The base generator lives in `packages/shared/src/layout.ts`. Gameplay furniture and routing helpers live in `packages/shared/src/gameplayLayout.ts`. Both are deterministic by seed.

Each generated clinic keeps a safe gameplay contract:

- exactly six rooms;
- one central circulation corridor;
- one combined **reception + waiting area** with three queue seats;
- one storage room;
- one diagnostic room;
- three treatment rooms;
- every room has a door into the main corridor;
- treatment stations and item spawn points derive from the room layout;
- supply spawns remain inside a reachable storage lane away from the supply table;
- staging counters are added to storage, diagnostics and treatment rooms;
- reception chairs use the exact patient queue positions;
- patient routes use room-door waypoints and the shared corridor;
- the player starts near reception.

This keeps navigation and logistics changing without letting decoration RNG create unwinnable layouts.

## Rendering

The client now uses Phaser `RESIZE` mode instead of post-render `FIT` scaling. The canvas is resized to its real parent size and the camera fits the logical 1280×720 clinic to that renderer surface. This avoids CSS stretching of the finished frame and improves sharpness on large desktop displays.

## Patient workflows

`packages/shared/src/workflow.ts` contains renderer-independent case pipelines.

**Direct treatment**

```text
reception → assigned treatment room → requested item → procedure → exit
```

**Diagnostic case**

```text
reception → assigned diagnostics → sample kit → sample analysis
          → assigned treatment room → post-diagnosis item → treatment → exit
```

## Architecture

```text
apps/
  client/   Phaser world, autonomous patients, physical objects, maintenance events and minigames
  server/   paused Colyseus multiplayer scaffold
packages/
  shared/   patient/shift rules, case workflows, procedural layout, furniture generation and route helpers
scripts/
  start.mjs smart local bootstrapper
start.bat   Windows one-click launcher
start.sh    Linux/macOS launcher
```

## Quality checks

```bash
npm test
npm run build
```

GitHub Actions runs shared tests and the full shared/client/server build on pushes and pull requests to `main`.

## Current direction

Networking remains intentionally on hold. The local game is being pushed toward a readable physical-task flow: occupied reception seats, concrete room assignments, constrained staging space, multi-room treatment chains, environmental maintenance and procedural bottlenecks that create decisions rather than arbitrary frustration.
