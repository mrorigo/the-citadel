# The Citadel

**Deterministic Agent Orchestration System** – a lightweight engine that turns chaotic agent swarms into an auditable, deterministic pipeline.

---

## Features

- **Foundry (Workflow Engine)** – Compile deterministic TOML `Formulas` into dynamic **Molecules** (task DAGs).
- **Stateful Agents** – The *state machine* guarantees `Open → In Progress → Verify → Done` transitions.
- **Dynamic Bonding** – Workers spawn sub‑tasks in parallel.
- **Durable State** – All context is stored in Git‑backed SQLite **Beads** (audit‑ready, restartable).
- **Provider‑agnostic** – Works with Ollama, OpenAI, Anthropic, and more.
- **Project Aware** – Finds `AGENTS.md` rules automatically.

---

## Quick Start

```bash
# 1️⃣ Install deps (Bun is required)
bun install

# 2️⃣ Bootstrap a new project
citadel init   # creates .citadel/ + config + sample formula

# 3️⃣ Run a workload
bd create "Hello world"
citadel start
```

⚙️ The **Conductor** will orchestrate agents automatically. Log output is written to `log.txt` courtesy of the shared `CitadelLogger`.

---

## Bridge TUI

The **Bridge** is the lightweight terminal dashboard built with **Ink** that shows the orchestration in real time.

```bash
# Launch the Bridge (Conductor + UI)
citadel bridge   # or
bun run script:bridge
```

The dashboard remains open until you hit **Ctrl+C**.

---

## Project Structure

```
├─ src/                      # Source code
│   ├─ bridge/               # Terminal UI (Ink)
│   │  ├─ index.tsx          # Entry point
│   │  └─ components/         # Dashboard panes
│   ├─ core/                 # Core engine (queue, logger, beads)
│   ├─ config/               # Config handling
│   ├─ services/              # Conductor & agent services
│   └─ types/                # Shared TS types
├─ docs/                     # Documentation (this file included)
├─ tests/                     # Unit tests
└─ README.md                  # This file
```

---

## Extending & Customising

- **New panels** – Add a component under `src/bridge/components` and import it into `Dashboard.tsx`.
- **Event‑driven UI** – Replace polling in `AgentMatrix` / `MoleculeTree` with Conductor events.
- **Custom loggers** – Hook into the global `CitadelLogger` to emit richer data.

---

## Build / Test / Lint

```bash
# TypeScript type-check
bun run tsc --noEmit

# Lint
bunx biome lint .

# Tests
bun test tests/
```

---

## Contribution

1. `bd ready` → Find a work item.
2. `bd update <id> --status in_progress` → Claim it.
3. code & tests → Pass all checks.
4. `bd close <id>` → Ship it.

Love to see you play around!
