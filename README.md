# The Citadel

**Deterministic Agent Orchestration System**

The Citadel is an orchestration engine that turns chaotic agent swarms into a deterministic factory. It decouples **State** (What needs to be done) from **Compute** (Who does it) using a rigorous Directed Acyclic Graph (DAG) of tasks.

The system adheres to a strict state machine: `Open` -> `In Progress` -> `Verify` -> `Done`.

## Features

- **The Foundry (Workflow Engine)**: compile deterministic TOML **Formulas** into dynamic **Molecules** (task graphs).
- **Strict State Machine**: Agents cannot hallucinate progress. Every transition is verified.
- **Dynamic Bonding**: Workers can recursively break down large tasks into parallel sub-tasks.
- **Durable State**: All context is stored in **Beads** (Git-backed SQLite), ensuring restartability and auditability.
- **Provider Agnostic**: Integrated with Vercel AI SDK to support Ollama, OpenAI, Anthropic, and more.
- **Project Awareness**: Automatically discovers and adheres to `AGENTS.md` files for project-specific rules.

## Prerequisites

- **[Bun](https://bun.sh)** (Runtime)
- **[Ollama](https://ollama.com)** (For local inference)
- **[Beads](https://github.com/steveyegge/beads)** (CLI tool `bd` must be in PATH)

# Link the binary
bun link

# Initialize a new project
mkdir my-new-project
cd my-new-project
citadel init
```

## Configuration

The Citadel looks for a `citadel.config.ts` file in the project root. See `src/config/schema.ts` for full options.

```typescript
export default defineConfig({
    env: 'development',
    providers: {
        ollama: { baseURL: 'http://localhost:11434/v1' }
    },
    agents: {
        router: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
        worker: { provider: 'ollama', model: 'qwen3:14b' },
    }
});
```

## Usage

### Start the System
The **Conductor** manages the orchestration loop.

```bash
citadel start
```

### Interact with Agents
You drive the system by creating **Beads** (tickets).

**1. Create a simple task:**
```bash
bd create "Fix the login page typo"
```

**2. Trigger a Workflow (Formula):**
Assuming you have a `migration.toml` formula:
```bash
bd create "Run migration formula for Auth service"
```

The **Router** will analyze the request, instantiate the workflow, and dispatch workers.

## Documentation

- [**User Guide**](./docs/USER-GUIDE.md): Full manual on Formulas, Molecules, and Agent behaviors.
- [**The Foundry Spec**](./docs/WORKFLOW_ENGINE.md): Technical specification of the Workflow Engine.

## Architecture

1.  **Beads (Data Plane)**: A folder of JSONL files representing the state.
2.  **Conductor (Control Plane)**: A TypeScript service that runs the **Router** and manages **Hooks**.
3.  **Agents (Compute Plane)**:
    - **Router**: Compiles Formulas and assigns tasks.
    - **Worker**: Executes tasks and delegates sub-work.
    - **Gatekeeper**: Verifies completion.
