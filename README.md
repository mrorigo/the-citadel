# The Citadel

**Deterministic Agent Orchestration System**

The Citadel is an orchestration engine that turns chaotic agent swarms into a deterministic factory. It decouples **State** (What needs to be done) from **Compute** (Who does it) using a rigorous Directed Acyclic Graph (DAG) of tasks.

The system adheres to a strict state machine: `Open` -> `In Progress` -> `Verify` -> `Done`.

## Features

- **Strict State Machine**: Agents cannot hallucinate progress. Every transition is validated.
- **Role-Based Queuing**: specialized queues for Workers (Execution) and Gatekeepers (Verification).
- **Durable State**: All context is stored in **Beads** (Git-backed JSON issues), ensuring restartability and auditability.
- **Provider Agnostic**: integrated with Vercel AI SDK to support Ollama, OpenAI, Anthropic, and more.
- **Project Awareness**: Automatically discovers and adheres to [**AGENTS.md**](https://agents.md) files for project-specific configuration.

## Prerequisites

- **[Bun](https://bun.sh)** (Runtime)
- **[Ollama](https://ollama.com)** (For local inference, optional if using API keys)
- **[Beads](https://github.com/.../beads)** (CLI tool `bd` must be in PATH)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/the-citadel.git
cd the-citadel

# Install dependencies
bun install
```

## Configuration

The Citadel looks for a `citadel.config.ts` file in the project root.

```typescript
// citadel.config.ts
import { defineConfig } from './src/config/schema';

export default defineConfig({
    env: 'development',
    
    // Configure AI Providers
    providers: {
        ollama: {
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama', // Required for standard OpenAI client compatibility
        },
        // openai: { apiKey: 'sk-...' }
    },

    // Assign Models to Agent Roles
    agents: {
        router: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
        worker: { provider: 'ollama', model: 'qwen3:14b' },
        gatekeeper: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
        supervisor: { provider: 'ollama', model: 'llama3.2:3b' },
    },

    // Queue Settings
    worker: {
        timeout: 300, // Seconds
        maxRetries: 3,
        costLimit: 1.00, // USD
    }
});
```

You can also use Environment Variables (prefixed with `CITADEL_`) to override settings:
- `CITADEL_OLLAMA_BASE_URL`
- `CITADEL_ENV`

## Usage

### 1. Start the Conductor
The Conductor is the heart of the system. It runs the Router loop and manages worker queues.

```bash
# First time setup
bun link

# Start the system
citadel start
```

### 2. Create Tasks (Beads)
Use the `bd` CLI to create tasks. The Citadel watches the `.beads` directory.

```bash
bd create "Implement Login Feature" --priority 0
```

The **Router** agent will automatically pick this up, analyze it, and assign it to the **Worker** queue.

### 3. Inspect System State
View the status of a specific bead or the queue.

```bash
# Inspect a specific bead's active ticket
bun run src/index.ts inspect <bead-id>

# Reset the queue (DANGER: clears all in-progress assignments)
bun run src/index.ts reset-queue
```

## Architecture

1.  **Beads (Data Plane)**: A folder of JSONL files representing the state.
2.  **Conductor (Control Plane)**: A TypeScript service that:
    - Runs the **RouterAgent** to dispatch tasks.
    - Spawns **WorkerHooks** to process `Open` tasks.
    - Spawns **GatekeeperHooks** to verify `Verify` tasks.
3.  **Agents (Compute Plane)**: Stateless, ephemeral agent instances that perform work and update the Bead state.

## Development

Run the test suite:

```bash
# Run all tests
bun test

# Run End-to-End validation (requires Ollama)
bun test tests/e2e/e2e.test.ts
```
