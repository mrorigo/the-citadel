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
  const mockPearls = { ... };
  const agent = new WorkerAgent(model, mockPearls);
  ```

### 2. Pearls Client (`prl`)
- **JSONL Source of Truth**: The system relies exclusively on `.pearls/issues.jsonl`.
- **Integration**: `PearlsClient` wraps the CLI. Do not spawn child processes for `prl` manually; use `PearlsClient.runCommand()`.

### 3. Context Management
- **Token Counting**: `CoreAgent` automatically tracks token usage and reports it to the Pearl via comments.
- **History Pruning**: Configurable in `citadel.config.ts`. The agent automatically prunes history but preserves:
    - System prompt
    - The most recent `tool-call` / `tool-result` pairs (to avoid hanging tool calls).

### 4. Deterministic Routing
The Conductor uses **deterministic routing** based on pearl status, eliminating the need for LLM-based routing decisions:
- **`open` pearls** → Routed to `worker` queue
- **`verify` pearls** → Routed to `gatekeeper` queue
- **Priority**: Uses the pearl's `priority` field (0-4) directly from the Pearls database.

This approach is synchronous, fast, and eliminates race conditions that previously existed with async Router Agent calls.

## 🧪 Testing Strategy (Non-Obvious patterns)

### 1. Registry & Singleton Isolation
Global singletons (`pearls_client`, `work_queue`, `mcp_service`) persist across tests if not managed. 

**Rule**: Always clean up globals in `afterEach` or `afterAll` using the registry tools.

```typescript
import { clearGlobalSingleton } from '../../src/core/registry';

afterEach(() => {
    clearGlobalSingleton('pearls_client');
    clearGlobalSingleton('mcp_service');
    clearGlobalSingleton('work_queue');
});
```

### 2. Mocking Guidelines
- **Avoid `mock.module` for Core Services**: Bun's `mock.module` pollutes the module cache and can leak into unrelated tests. Prefer `setGlobalSingleton` from the registry for `mcp_service` or `pearls_client`.
- **Interface Completeness**: When mocking shared services (like `MCPService`), implement the **full interface**. Leaving methods like `readResource` or `callTool` as undefined will cause downstream failures in components like `InstructionService`.
- **Config Context**: Any test path involving `PearlsClient` or `MCPResourceProvider` requires a loaded configuration. Use `setConfig` in `beforeEach` to avoid "Config not loaded" errors.

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
   - Use `AgentContext` to access `pearlId` inside tools (auto-injected).

3. **Release Flow**:
   - Bump version in `package.json`.
   - Update `CHANGELOG.md`.
   - Commit.
   - Tag `vX.Y.Z`.
   - `git push && git push --tags`.
