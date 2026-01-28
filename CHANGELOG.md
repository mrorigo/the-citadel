# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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
