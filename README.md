# Animal Care Co-op

A 2D veterinary-clinic time-management game built with Phaser and TypeScript. The current playable slice combines a procedural local clinic loop with a **host-authoritative P2P co-op layer**, a character lobby and automated Playwright coverage.

## Current playable slice

### Clinic gameplay

- procedurally generated clinic on every new run;
- six functional rooms arranged around a central corridor;
- reception includes the waiting area inside the same room;
- three physical queue seats are mapped 1:1 to visible chairs;
- one storage room, one diagnostics room and three treatment rooms;
- procedural room order, room widths and door positions;
- walls, narrow doorways and soft circulation bottlenecks;
- dog, cat and rabbit patients walking autonomously through the clinic;
- concrete workstation reservation after admission;
- physical patient collision and soft patient-to-patient separation;
- direct-treatment and longer diagnostic case chains;
- physical Overcooked-style item handling with one carried object per player;
- dedicated supply cabinets for bandages, sample kits, eye drops, treats and disinfectant;
- limited-capacity staging counters in diagnostics and treatment rooms;
- dirty workstations that require disinfectant;
- maintenance spills generated from positions patients actually traversed;
- hold-to-clean spill interaction, clinic stress and patience pressure;
- timing-treatment and sample-analysis minigames;
- coins, shift timer and 0–3 star results;
- deterministic clinic seeds for reproducible layouts.

### Characters and game feel

The lobby currently exposes four playable staff characters:

- **Lena** — veterinary intern, turquoise/stethoscope motif;
- **Maks** — animal handler, amber/paw motif;
- **Iga** — diagnostics, violet/microscope motif;
- **Bruno** — treatment assistant, coral/bandage motif.

Each character has a separate portrait asset, a characteristic top-down treatment and a matching HUD identity. Character cards use explicit hover, press and selected states. Interactions and patient arrivals also receive short squash/pop feedback so actions read more clearly without turning the scene into constant animation noise.

Portrait assets live under `apps/client/public/portraits/` and can be replaced by final painted art without touching lobby or networking code.

## Multiplayer

Multiplayer uses a **host-authoritative WebRTC star topology**:

```text
                   Colyseus :2567
              lobby / reconnect / signaling
                 /        |        \
                /         |         \
             HOST ===== GUEST A     GUEST B
               \\==================//
                  WebRTC DataChannels
```

Colyseus is intentionally kept out of the high-frequency gameplay path. It creates rooms, publishes the roster, handles reconnect/host selection and relays opaque SDP/ICE messages. Once peers connect, guest inputs and authoritative world snapshots travel directly through WebRTC data channels.

The host owns collisions, item ownership, patients/workflows, workstations, spills and procedures. Guests send input and receive authoritative snapshots, with local movement prediction/reconciliation for responsiveness.

Lobby features include:

- create room;
- join by room code;
- share/deep-link using `?room=...`;
- hero and display-name selection;
- ready state and host-only start;
- one shared procedural seed;
- automatic signaling reconnection;
- P2P topology rebuild after reconnect;
- lobby host migration when a disconnected host does not return.

For reliable public-Internet play behind strict/symmetric NAT, configure a TURN server. See [`docs/multiplayer.md`](docs/multiplayer.md) and [`.env.example`](.env.example).

> **Current authority limitation:** lobby/signaling host migration is implemented. Seamless migration of an already running authoritative clinic simulation is not claimed yet; that needs resumable world checkpoints before an in-progress shift can safely move to another host.

## Stack

- Phaser 3
- TypeScript
- Vite
- Vitest
- WebRTC DataChannels
- Colyseus 0.18 for lobby/signaling/reconnect
- Playwright for browser E2E and responsive tests
- npm workspaces (`apps/client`, `apps/server`, `packages/shared`)

## Quick start

Node.js 22+ is recommended.

### Windows

Double-click:

```text
start.bat
```

or run:

```bash
start.bat
```

### Any platform

```bash
npm start
```

On Linux/macOS you can also use:

```bash
sh start.sh
```

The launcher:

1. checks whether dependencies changed;
2. runs `npm install` only when required;
3. builds the shared rules package;
4. starts the Colyseus lobby/signaling service on port `2567`;
5. starts Vite and opens the game.

To reproduce a generated hospital, add a seed:

```text
?seed=12345
```

To prefill a multiplayer invitation:

```text
?room=<room-code>
```

### Separate development terminals

Client:

```bash
npm run dev
```

Signaling server:

```bash
npm run dev:server
```

For testing from another device on the LAN, expose Vite explicitly, for example:

```bash
npm run dev -- --host 0.0.0.0
```

## Controls

- **WASD / Arrow keys** — move
- **E / Space** — interact / admit / take from cabinet / pick up / place / drop / deliver / procedure input
- **Hold E near a spill** — wipe the floor
- **1–4** — choose a filter during sample analysis
- **Q** — priority/help ping
- **R** — after results, start a fresh generated clinic

## Gameplay flow

1. Start the shift. Patients enter reception and occupy physical chairs.
2. Take supplies from dedicated storage cabinets and stage useful items on counters.
3. Admit a seated patient at reception.
4. The patient reserves a concrete analyzer or treatment table and walks there automatically.
5. If that workstation is unavailable, the patient waits for the assigned room.
6. Fetch and physically deliver the requested item.
7. Complete the treatment/analysis minigame.
8. Diagnostic cases may continue to another room for a second stage.
9. Disinfect dirty workstations and clean corridor spills.
10. Keep the clinic moving until the shift ends.

In co-op, these actions share the host-authoritative world: item ownership, workstation state and patient workflows are not separate per player.

## Procedural clinic generation

The base generator lives in `packages/shared/src/layout.ts`. Gameplay furniture, supply-cabinet placement and routing helpers live in `packages/shared/src/gameplayLayout.ts`. Both are deterministic by seed.

The generator keeps a safe gameplay contract:

- exactly six rooms;
- one central circulation corridor;
- combined reception + waiting area with three queue seats;
- one storage room;
- one diagnostic room;
- three treatment rooms;
- every room connected to the corridor;
- five dedicated supply cabinets fitted safely into storage;
- staging counters in diagnostics and treatment rooms;
- reception chairs matching the exact patient queue positions;
- routed patient movement through room-door waypoints;
- a safe player spawn near reception.

## Architecture

```text
apps/
  client/
    Phaser clinic scene
    character/lobby UI
    WebRTC P2P session + host-authoritative scene bridge
  server/
    Colyseus lobby, roster, reconnect and WebRTC signaling relay
packages/
  shared/
    patient/shift rules, workflows, procedural layout and route helpers
tests/
  e2e/
    Playwright local, multiplayer, reconnect and responsive scenarios
docs/
  multiplayer.md
```

## Quality checks

Domain/unit tests and full TypeScript builds:

```bash
npm test
npm run build
```

Playwright:

```bash
npx playwright install chromium
npm run test:e2e
```

The E2E suite starts both Vite and Colyseus automatically and covers:

- hero-card selection and local launch;
- room-code deep links;
- real two-browser host/join flow;
- WebRTC DataChannel readiness;
- guest movement reaching the host simulation;
- a shared procedural seed;
- automatic signaling reconnect;
- lobby host migration;
- phone/tablet/desktop layout checks, including portrait and landscape.

GitHub Actions runs domain tests, the full shared/client/server build and Playwright Chromium on pull requests and pushes to `main`. On E2E failure it retains Playwright traces, screenshots/video and the HTML report for diagnosis.
