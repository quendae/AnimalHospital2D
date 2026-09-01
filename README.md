# Animal Care Co-op

A cooperative 2D veterinary-clinic time-management game prototype built from the project's design document.

The repository currently contains a **playable local vertical slice** plus the **authoritative Colyseus server foundation** for the online co-op layer. The next networking step is wiring the Phaser client to rooms/lobby state; the README deliberately does not claim that online matchmaking is finished yet.

## Current vertical slice

- one readable top-down clinic layout;
- reception and a three-patient queue;
- dog, cat and rabbit cases with priorities, patience and clinic stress;
- escorting patients to the correct treatment station;
- storage, required tools, pickup/use flow and station cleaning;
- two minigame models: timing treatment and sample analysis;
- recoverable mistakes and three treatment-quality levels;
- coins, score, shift timer and 0–3 star results screen;
- team-task ping (`Q`);
- shared renderer-independent gameplay rules with Vitest coverage;
- Colyseus room scaffold for up to four players, validated movement, host start, ping and reconnect window;
- relative Vite build paths suitable for an itch.io HTML5 package.

## Stack

- Phaser 3
- TypeScript
- Vite
- Vitest
- Colyseus 0.18 / `@colyseus/schema` 5
- npm workspaces (`apps/client`, `apps/server`, `packages/shared`)

## Run the local game

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Run the multiplayer server scaffold

In a second terminal:

```bash
npm run dev:server
```

The server listens on port `2567` by default. The current Phaser vertical slice still runs locally; client room joining/lobby UI is the next networking milestone.

## Controls

- **WASD / Arrow keys** — move
- **E / Space** — interact, admit, pick up, deliver or start a procedure
- **1–3** — choose a tube during sample analysis
- **Q** — ping the current priority task
- **R** — replay after the results screen

## Prototype flow

1. Start the shift and go to reception.
2. Admit the first patient and escort them to the correct station.
3. Fetch the requested tool from storage.
4. Deliver it to the station and complete the treatment minigame.
5. Fetch disinfectant after treatment and clean the dirty station.
6. Keep the queue moving until the shift ends.

## Architecture

```text
apps/
  client/   Phaser rendering, input and treatment UI
  server/   Colyseus room/state and authoritative network validation
packages/
  shared/   patient, station, shift and scoring rules + configuration + tests
```

The shared domain layer has no Phaser dependency. That keeps patient flow, scoring and validation testable without rendering and gives the server a stable rule layer to take ownership of as multiplayer is connected.

## Quality checks

```bash
npm test
npm run build
```

GitHub Actions runs the same domain tests and full shared/client/server build on pushes and pull requests to `main`.

## Scope / next milestone

This first pass intentionally proves the clinic workflow before scaling content. The next smallest useful milestone is **real two-player client connectivity**: room create/join, remote-player rendering, server-owned movement/interactions and reconnect handoff. After that, add the shop and additional cases rather than expanding the campaign first.
