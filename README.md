# Animal Care Co-op

A 2D veterinary-clinic time-management prototype built from the project's design document.

The current focus is the **local gameplay loop**. Multiplayer infrastructure remains in the repository, but networking is deliberately paused while the clinic, patients, object handling and moment-to-moment game feel are developed further.

## Current playable slice

- **procedurally generated clinic** on every new run;
- six functional rooms arranged around a central corridor;
- guaranteed waiting room, reception, storage, diagnostics and two treatment rooms;
- procedural room order, room widths and door positions;
- visible walls, doors, counters and room labels;
- visible dog, cat and rabbit patients physically waiting in the clinic;
- admitted patients follow the player to their destination and remain visible beside the treatment station;
- physical world items inspired by Overcooked-style handling;
- one carried object at a time;
- items can be picked up, carried above the player, dropped on the floor and picked up again;
- bandages, sample kits, eye drops, treats and disinfectant are visible objects in the storage room;
- treatment stations consume the required carried object and restock it after a short delay;
- dirty treatment stations require physically fetching disinfectant;
- patient priorities, patience and clinic stress;
- treatment timing and sample-analysis minigames;
- coins, score, shift timer and 0–3 star results screen;
- deterministic clinic seeds for reproducing a generated map;
- renderer-independent domain rules and procedural-layout tests.

## Stack

- Phaser 3
- TypeScript
- Vite
- Vitest
- Colyseus server scaffold (currently not the gameplay focus)
- npm workspaces (`apps/client`, `apps/server`, `packages/shared`)

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

To reproduce a particular generated hospital, add a seed to the URL, for example:

```text
?seed=12345
```

## Controls

- **WASD / Arrow keys** — move
- **E / Space** — interact / pick up / drop / deliver / start treatment
- **1–4** — choose a filter during sample analysis
- **Q** — show the current priority task
- **R** — after results, generate a fresh clinic and start again

## Gameplay flow

1. Start the shift. Three patients appear physically in the waiting room.
2. Go to reception and admit the first patient.
3. The patient follows you through the clinic.
4. Bring the patient to the required treatment room or analyzer.
5. Walk to storage and physically pick up the requested item.
6. Carry it through the hospital and deliver it to the occupied station.
7. Complete the treatment minigame.
8. The recovered patient walks toward the exit.
9. Fetch disinfectant and clean the dirty station.
10. Keep the queue moving until the shift ends.

## Procedural clinic generation

The generator lives in `packages/shared/src/layout.ts` and is deterministic by seed. Each generated clinic keeps a safe gameplay contract instead of being unconstrained random noise:

- exactly six rooms;
- one central circulation corridor;
- one waiting room;
- one reception room;
- one storage room;
- one diagnostic room;
- two treatment rooms;
- every room has a door into the main corridor;
- treatment stations and item spawn points are generated from the room layout;
- the player always starts near reception;
- the queue always has three valid waiting positions.

This keeps the navigation changing without producing unwinnable layouts.

## Architecture

```text
apps/
  client/   Phaser world, procedural-room rendering, patients, items and minigames
  server/   paused Colyseus multiplayer scaffold
packages/
  shared/   patient/shift rules, scoring, config and procedural clinic generator
```

The procedural map generator and gameplay rules do not depend on Phaser, so they can be tested independently and later reused by the server if multiplayer work resumes.

## Quality checks

```bash
npm test
npm run build
```

GitHub Actions runs domain/layout tests and the full shared/client/server build on pushes and pull requests to `main`.

## Current direction

Networking is intentionally on hold. The next iterations should continue pushing the local game toward the readable physical-task feel of a co-op kitchen game: better patient movement, stronger object silhouettes, more station types, counters/shelves for placing objects, environmental events, room decorations and more treatment chains before returning to multiplayer.
