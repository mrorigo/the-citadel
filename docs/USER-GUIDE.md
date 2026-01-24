# The Citadel User Guide

Welcome to **The Citadel**, a multi-agent coding environment designed to automate software development tasks. This system leverages specialized AI agents to plan, execute, and verify code changes while adhering to project-specific constraints.

## Core Concepts

### 1. Beads
**Beads** are the fundamental unit of work and state in The Citadel. Think of them as "issues" or "tickets" but designed for AI consumption. A Bead captures:
- **Intent**: What needs to be done.
- **Context**: Relevant files, code snippets, or logs.
- **State**: Current status (`open`, `in_progress`, `verify`, `done`).
- **History**: A log of actions taken by agents on this specific unit of work.

For a deep dive into the Beads data structure and philosophy, please refer to the official documentation:
👉 **[steveyegge/beads](https://github.com/steveyegge/beads)**

### 2. Agents
The Citadel operates with a team of specialized agents:
- **RouterAgent**: The entry point. breaks down high-level requests into manageable Beads and assigns them.
- **WorkerAgent**: The builder. Picks up a Bead, explores the codebase, plans the implementation, and writes the code. It is project-aware (see below).
- **EvaluatorAgent**: The QA. Reviews the work submitted by the Worker, runs tests, and approves or rejects the changes.

## Project Awareness (AGENTS.md)

One of The Citadel's most powerful features is its ability to automatically discover and follow project-specific rules defined in `AGENTS.md` files. This allows you to "teach" the agents how to behave in your specific repository.

### How it Works
When a Worker Agent starts a task, it scans the file system from the target directory up to the root to find `AGENTS.md` files.
- **Discovery**: It looks for `AGENTS.md` in the current directory and parent directories.
- **Merging**: It merges instructions from the closest `AGENTS.md` (most specific) with the root `AGENTS.md` (global policies), ensuring that local overrides work while maintaining global standards.
- **Parsing**: It extracts commands (setup, test, lint, build) and behavioral rules ("Always do X") to guide its actions.

### Examples

#### Basic Example
Place this in the root of your repository (`/AGENTS.md`) to define global standards.

```markdown
# Intro
This is a TypeScript project using Bun.

# Rules
- Always use strict types.
- Always include a JSDoc comment for exported functions.
- Never use `any`.

# Commands
- Setup: `bun install`
- Test: `bun test`
- Lint: `bunx biome lint .`
- Build: `bun build src/index.ts`
```

#### Monorepo / Nested Example
In a monorepo, you might have specific instructions for a frontend package (`packages/web/AGENTS.md`) that inherit from or override the root.

**File: `packages/web/AGENTS.md`**

```markdown
# Frontend Rules
- Use React functional components.
- Prefer Tailwind CSS for styling.

# Commands
- Setup: `bun install`
- Test: `bun test --filter web`
- Start: `bun run dev`

# Specific Constraints
- Ensure all components have a recognized "data-testid" for E2E testing.
```

The agent working in `packages/web` will see **both** the global rules (e.g., "Never use `any`") and these frontend-specific rules.

```bash
bun link

# Start the system
citadel
```
