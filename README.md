# Animal Care Co-op

A cooperative 2D veterinary clinic time-management game prototype.

This repository follows the **Animal Care Co-op** design document and starts with a deliberately small vertical slice: one clinic, patient queue, top-down movement, item handling, treatment flow, scoring, and two treatment minigames.

## Stack

- Phaser 3
- TypeScript
- Vite
- Vitest
- Colyseus-ready shared domain model

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Controls

- **WASD / Arrow keys** — move
- **E / Space** — interact / pick up / drop / use
- **Q** — ping current objective
- **Esc** — close treatment panel

## Prototype flow

1. Go to reception and admit a patient.
2. Read the patient card and take the required item from storage.
3. Deliver the item to the highlighted treatment station.
4. Complete the treatment minigame.
5. Repeat before the shift timer reaches zero.

## Architecture

The domain model lives in `packages/shared` and does not depend on Phaser. The client renders that state and translates keyboard input into gameplay intents. A later Colyseus server can own the same state and validation rules without rewriting treatment logic.

## Scope

This first implementation intentionally targets the vertical slice rather than the whole campaign. It is meant to prove that moving through the clinic, triaging patients, carrying tools and completing short procedures is readable and fun before content is scaled up.
