# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-01-29

### Fixed
- **Conductor Resilience**: Implemented exponential backoff for the main router loop to prevent log flooding and CPU spikes during infrastructure outages (e.g., database synchronization errors).
- **Environment Validation**: Added a startup check (`bd doctor`) to ensure the Conductor only starts when the `beads` database is in a healthy state.

## [0.1.3] - 2026-01-29

### Fixed
- **Zombie Task Prevention**: Added error handling and state recovery to worker and gatekeeper hooks. If an agent exits without calling a terminal tool (`submit_work`, `approve_work`, `reject_work`), the bead is automatically returned to an actionable state with appropriate labels (`agent-incomplete`, `agent-error`, `evaluator-incomplete`, `evaluator-error`) for retry. This prevents tasks from getting permanently stuck in `in_progress` or `verify` states.

## [0.1.2] - 2026-01-29

### Fixed
- **Dependency-Aware Task Routing**: The Conductor now uses `beadsClient.ready()` instead of `list('open')` to ensure only beads with satisfied dependencies (all blockers closed) are routed to workers. This prevents wasting resources on tasks that cannot proceed due to missing dependencies.
- **Recovery Logic**: Re-added recovery bead handling to correctly skip recovery tasks when their dependencies succeed.

## [0.1.1] - 2026-01-29

### Added
- **Parameter Auto-Injection**: Citadel now automatically injects mandatory parameters like `beadId` and `parentBeadId` from the agent's context into tool calls if they are missing. This significantly improves reliability for weaker local models (e.g., 20B class models) that sometimes fail to extract context into tool arguments.

## [0.1.0] - 2026-01-28

### Fixed
- **CRITICAL: Tool Execution Context Shadowing**: Fixed a major bug where `AgentContext` (including `beadId`) was being ignored during tool execution. This now correctly passes the agent's run-time context to all tools, enabling `enqueue_task`, `submit_work`, and `report_progress` to function correctly without explicit `beadId` parameters.
- **WorkerAgent Typo**: Fixed a minor syntax typo in the `run_command` handler.

## [0.0.9] - 2026-01-28

### Improved
- **Tool Parameter Tolerance**: Made tools more forgiving of LLM variations:
  - `run_command` now accepts both `command` (string) and `cmd` (string or array), automatically converting arrays to space-separated strings
  - `run_command` uses `.passthrough()` to allow extra parameters like `timeout` that LLMs might add
  - `enqueue_task` now makes `beadId` optional, falling back to context if not provided
  - Reduces wasted API calls from agents learning tool schemas through trial and error

## [0.0.8] - 2026-01-28

### Fixed
- **Bug #1 - Invalid State Transition**: Fixed the Conductor to properly move beads to `in_progress` status when workers **start** processing tasks, not when they finish. This prevents the invalid `open` → `verify` transition that was occurring in `submit_work`.
- **Bug #2 - Output Schema Mismatch**: Updated `submit_work` to accept both string and object types for the `output` parameter, allowing agents to submit structured data naturally without manual stringification.
- **Bug #3 - Tool Schema Ambiguity**: Improved `run_command` tool description to explicitly clarify that `command` must be a single string, not an array, reducing agent confusion and wasted API calls.

## [0.0.7] - 2026-01-28

### Fixed
- **JSON Schema Validation Error (Complete Fix)**: Fixed the root cause in `jsonSchemaToZod` function that was converting empty JSON Schema objects to `z.record()`, which generates invalid schemas. Now uses `z.object({}).passthrough()` for dynamic objects. This resolves production errors when using workflow formulas with output schemas.
- **RouterAgent Schema**: Also fixed `instantiate_formula` tool's `variables` parameter (from v0.0.6).

## [0.0.6] - 2026-01-28

### Fixed
- **JSON Schema Validation Error**: Fixed RouterAgent's `instantiate_formula` tool generating invalid JSON schemas. Replaced `z.record()` with `z.object({}).passthrough()` to properly support dynamic variable objects in workflow formulas.

## [0.0.5] - 2026-01-28

### Added
- **100% WorkerAgent Test Coverage**: Achieved full line and function coverage for `src/agents/worker.ts`.
- **Agent Dependency Injection**: Refactored `CoreAgent`, `WorkerAgent`, and `EvaluatorAgent` to support `LanguageModel` injection, eliminating reliance on global mocks.

### Changed
- **Test Suite Modernization**: Removed all cache-busting hacks (`?t=...`) and broad module mocks to unify coverage reporting and improve test reliability.
- **Lint & Type Safety**: Resolved all `any` warnings in agent constructors and optimized import styles (`import type`).

### Fixed
- **Coverage Shadowing**: Fixed issues where global mocks were interfering with coverage tracking across different test files.
- **LLM Mocking Stability**: Implemented role-validated LLM mocks in integration tests to prevent unauthorized API calls during testing.

## [0.0.4] - 2026-01-28

### Added
- **100% Biome Lint Compliance**: Achieved full compliance across `src/` directory, resolving 18 warnings without ignore comments.
- **Strict Tool Validation**: `CoreAgent` now performs explicit Zod schema validation on all tool inputs.
- **Improved Test Isolation**: Switched to dynamic imports for `WorkerAgent` in integration tests to prevent singleton leakage.

### Fixed
- **enqueue_task Constraint Failure**: Resolved `NOT NULL` constraint errors by providing default values in `WorkQueue` and marking `RouterAgent` parameters as optional.
- **Build Compilation Errors**: Fixed several TypeScript "possibly undefined" and type mismatch errors in core logic and tests.
- **AI Mocking**: Repaired incomplete `ai` module mocks in unit tests.

## [0.0.3] - 2026-01-28

### Added
- **Dynamic Data Piping (DDP)**: Enabled structured data flow between workflow steps using `{{steps.ID.output.KEY}}` syntax.
- **Dynamic Schema Enforcement**: Worker Agents now rigidly enforce Formula-defined `output_schema` using Zod validation.
- **Context Preservation**: Beads now support a structured `context` property persisted in description frontmatter.
- **Data Piper Service**: Just-in-time dependency resolution and context injection.

## [0.0.2] - 2026-01-27

### Fixed
- **Configuration State Duplication**: Resolved a critical bug where bundled CLI state was duplicated, causing "Config not loaded" errors. Corrected by implementing a global singleton registry using `globalThis` and `Symbol.for`.

## [0.0.1] - 2026-01-24

### Added
- **Parallel Multi-Worker Support**: Introduced `WorkerPool` for dynamic scaling.
- **Workflow Engine**: Implemented TOML-based "Formulas".
- **Dynamic Task Decomposition**: Enabled Worker Agents to delegate subtasks.
- **NPM Package Readiness**: Configured package metadata and CLI entry points.

### Changed
- **Documentation**: Comprehensive update to `USER-GUIDE.md` and technical docs.
