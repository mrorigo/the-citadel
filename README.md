# The Citadel

**Deterministic Agent Orchestration System** – a lightweight engine that turns chaotic agent swarms into an auditable, deterministic **Knowledge Factory**.

---

Use The Citadel for complex, multi-step objectives: **building software features**, **conducting deep research**, **synthesizing market reports**, or **managing content pipelines**. By decoupling the *process* (SOPs) from the *execution* (Agents), it ensures that even creative work follows a reliable, auditable path.

---

## Installation

```bash
npm install the-citadel@0.0.1
```

---

## Features

- **Foundry (Workflow Engine)** – Compile standard operating procedures (SOPs) into dynamic **Molecules** (task DAGs).
- **Process Integrity** – The *state machine* guarantees `Open → In Progress → Verify → Done` transitions for every task.
- **Dynamic Bonding** – Agents can spawn sub‑tasks in parallel to handle complex objectives (research, coding, analysis).
- **Resilient Recovery** – Automated `on_failure` handling with conditional skips.
- **Durable State** – All context is stored in Git‑backed SQLite **Beads** (audit‑ready, restartable).
- **Parallel Execution** – Configurable `max_workers` and `load_factor` for high-throughput concurrency.
- **Provider‑agnostic** – Works with Ollama, OpenAI, Anthropic, and more.
- **Provider‑agnostic** – Works with Ollama, OpenAI, Anthropic, and more.
- **Context Aware** – Adheres to specific project rules and style guides (`AGENTS.md`) automatically. Supports [YAML Frontmatter](docs/agent/AGENTS.md.frontmatter.md) for strict `ignore`, `read_only`, and `forbidden` file constraints.
- **Dynamic Data Piping** – Pass rich inputs (`context`) to tasks and pipe outputs between steps (`{{steps.foo.output.bar}}`).

---

## Quick Start

```bash
# 1️⃣ Install globally
npm install -g the-citadel@0.0.1

# 2️⃣ Bootstrap a new project
citadel init   # creates .citadel/ + config + sample formula

# 3️⃣ Run a workload
# Option A: Simple Task
citadel create "Hello world"

# Option B: Run a Formula
citadel create "My Release" --formula feature_release --vars name="Dark Mode"

citadel start
```

⚙️ The **Conductor** will orchestrate agents automatically. Log output is written to `log.txt` courtesy of the shared `CitadelLogger`.

---

## Documentation

For detailed usage instructions, including advanced configuration, formula creation, and troubleshooting, please refer to the **[User Guide](wiki/USER-GUIDE.md)**.

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
3. execute & verify → Pass all checks.
4. `bd close <id>` → Ship it.

Love to see you play around!
