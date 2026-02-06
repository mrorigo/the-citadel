# Citadel Development Guide & Agent Instructions

This document outlines the architectural patterns, testing strategies, and development rules specific to the **The Citadel** repository.

## 🏗️ Core Architecture Patterns

### 1. Dependency Injection vs. Singletons
While the system uses singletons for runtime convenience (via `src/core/registry.ts`), **Dependency Injection (DI)** is preferred for testability.

- **Pattern**: Core classes like `CoreAgent` accept optional dependencies in their constructor.
- **Usage**:
  ```typescript
  // Runtime (uses singleton default)
  const agent = new WorkerAgent(model); 
  
  // Testing (injects mock)
  const mockBeads = { ... };
  const agent = new WorkerAgent(model, mockBeads);
  ```

### 2. Beads Client (`bd`)
- **JSONL Source of Truth**: The system relies exclusively on `.beads/issues.jsonl`.
- **`--no-db` Mode**: All `bd` commands MUST use the `--no-db` flag to prevent SQLite corruption and stack overflow crashes in the underlying Go binary.
- **Integration**: `BeadsClient` wraps the CLI. Do not spawn child processes for `bd` manually; use `BeadsClient.runCommand()`.

### 3. Context Management
- **Token Counting**: `CoreAgent` automatically tracks token usage and reports it to the Bead via comments.
- **History Pruning**: Configurable in `citadel.config.ts`. The agent automatically prunes history but preserves:
    - System prompt
    - The most recent `tool-call` / `tool-result` pairs (to avoid hanging tool calls).

## 🧪 Testing Strategy (Non-Obvious patterns)

### 1. Unit Test Isolation
Global singletons (`beads_client`, `work_queue`) persist across tests if not managed. 

**Rule**: Always clean up globals in `beforeEach` or `afterAll`.

```typescript
import { clearGlobalSingleton } from '../../src/core/registry';

beforeEach(() => {
    clearGlobalSingleton('beads_client');
    clearGlobalSingleton('work_queue');
    // ... setup mocks
});
```

### 2. Mocking AI SDK
We use a mock provider pattern for `LanguageModel`. 
**Important**: The `specificationVersion` must be compatible with the AI SDK version installed.

```typescript
const mockModel = {
    specificationVersion: 'v1', // or 'v3' depending on SDK version
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => ({ ... })
} as unknown as LanguageModel;
```

### 3. E2E Testing & Global Overrides
For E2E tests (`tests/e2e/`), we run the full `Conductor` loop in-process. To bridge the gap between valid `WorkerAgents` (running in the loop) and the test assertions, we sometimes attach mocks to `globalThis`.

- **Example**: `globalThis.__TEST_QUEUE__` is used to inspect queue state during E2E runs.

## 🛡️ Development Rules

1. **Strict Linting (Biome)**:
   - Run `bunx biome lint .`
   - **NO `any`**: Do not use `any`. Define a type or use `unknown` with narrowing.
   - **NO `biome-ignore`**: Fix the issue properly.

2. **Tool implementation**:
   - Tools must validate inputs using `zod`.
   - Tool outputs must be strictly typed.
   - Use `AgentContext` to access `beadId` inside tools (auto-injected).

3. **Release Flow**:
   - Bump version in `package.json`.
   - Update `CHANGELOG.md`.
   - Commit.
   - Tag `vX.Y.Z`.
   - `git push && git push --tags`.
