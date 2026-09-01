# Animal Care Co-op

A 2D veterinary-clinic time-management prototype built from the project's design document.

The current focus is the **local gameplay loop**. Multiplayer infrastructure remains in the repository, but networking is deliberately paused while the clinic, patients, physical object handling and moment-to-moment game feel are developed further.

## Current playable slice

- **procedurally generated clinic** on every new run;
- six functional rooms arranged around a central corridor;
- guaranteed waiting room, reception, storage, diagnostics and two treatment rooms;
- procedural room order, room widths and door positions;
- walls, narrow doorways and soft circulation bottlenecks;
- procedural functional decorations: chairs, plants, cabinets, sinks and bins;
- decoration placement keeps the critical door-to-workstation route clear;
- visible dog, cat and rabbit patients;
- patients now **walk autonomously** between the entrance, waiting room, reception, diagnostics, treatment rooms and exit;
- patients reserve an available workstation and wait if the next destination is busy;
- two case-flow archetypes: direct treatment and longer diagnostic chains;
- diagnostic chain can require reception → analyzer → sample kit → analysis → treatment room → medication/tool → final treatment → exit;
- physical world items inspired by Overcooked-style handling;
- two physical copies of each core supply to make staging meaningful;
- one carried object at a time;
- items can be picked up, carried above the player, dropped on the floor and picked up again;
- **limited-capacity staging counters** in work rooms;
- items can be placed on counters, collected later and transferred between rooms;
- bandages, sample kits, eye drops, treats and disinfectant are visible objects;
- treatment stations consume the required carried object and restock supplies after a delay;
- dirty workstations require physically fetching disinfectant;
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

So the normal workflow is simply:

```bash
git clone https://github.com/quendae/AnimalHospital2D.git
cd AnimalHospital2D
start.bat
```

### Any platform with Node.js

```bash
npm start
```

On Linux/macOS you can also use:

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
- **E / Space** — interact / admit / pick up / place on counter / drop / deliver / start treatment
- **1–4** — choose a filter during sample analysis
- **Q** — show the current priority task
- **R** — after results, generate a fresh clinic and start again

## Gameplay flow

1. Start the shift. Patients enter the clinic and walk to waiting positions.
2. Use quiet moments to stage frequently needed supplies on work-room counters.
3. Go to reception and admit the next waiting patient.
4. The patient walks automatically to the next required destination.
5. If a workstation is busy, the patient waits for it to become available.
6. Read the workstation request, fetch the required physical item and carry it through the clinic.
7. Use a nearby counter as a buffer when useful, or deliver the item directly.
8. Complete the treatment/analysis minigame.
9. A simple case heads toward the exit; a diagnostic case may continue to another room for a second treatment stage.
10. Fetch disinfectant and clean dirty workstations so the next patient can use them.
11. Keep the whole clinic flow moving until the shift ends.

## Procedural clinic generation

The base generator lives in `packages/shared/src/layout.ts`. Gameplay furniture and routing helpers live in `packages/shared/src/gameplayLayout.ts`. Both are deterministic by seed.

Each generated clinic keeps a safe gameplay contract instead of being unconstrained random noise:

- exactly six rooms;
- one central circulation corridor;
- one waiting room;
- one reception room;
- one storage room;
- one diagnostic room;
- two treatment rooms;
- every room has a door into the main corridor;
- treatment stations and item spawn points derive from the room layout;
- staging counters are added to storage, diagnostics and treatment rooms;
- functional decorations hug side/far walls instead of occupying the direct door lane;
- patient routes use room-door waypoints and the shared corridor;
- the player starts near reception;
- the queue has three valid waiting positions.

This keeps navigation and logistics changing without letting decoration RNG create unwinnable layouts.

## Patient workflows

`packages/shared/src/workflow.ts` contains renderer-independent case pipelines.

**Direct treatment**

```text
reception → treatment room → requested item → procedure → exit
```

**Diagnostic case**

```text
reception → diagnostics → sample kit → sample analysis
          → treatment room → post-diagnosis item → treatment → exit
```

The workflow state is intentionally separate from Phaser so future cases can add, remove or reorder stages without turning the rendering scene into the rules engine.

## Architecture

```text
apps/
  client/   Phaser world, procedural-room rendering, autonomous patients, physical objects and minigames
  server/   paused Colyseus multiplayer scaffold
packages/
  shared/   patient/shift rules, case workflows, procedural layout, furniture generation and route helpers
scripts/
  start.mjs smart local bootstrapper
start.bat   Windows one-click launcher
start.sh    Linux/macOS launcher
```

The procedural generators and workflow rules do not depend on Phaser, so they can be tested independently and later reused by the server if multiplayer work resumes.

## Quality checks

```bash
npm test
npm run build
```

GitHub Actions runs shared tests and the full shared/client/server build on pushes and pull requests to `main`.

## Current direction

Networking remains intentionally on hold. The local game is being pushed toward a readable physical-task flow: autonomous patients, visible work queues, constrained staging space, multi-room treatment chains and a clinic layout whose bottlenecks create decisions rather than arbitrary frustration.
