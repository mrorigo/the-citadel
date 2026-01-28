# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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
