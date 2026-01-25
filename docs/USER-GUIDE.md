# The Citadel User Guide

Welcome to **The Citadel**, a deterministic orchestration engine for AI agents. This system transforms chaotic agent interactions into a rigorous, verifiable software factory using the **MEOW Stack** (Molecular Expression of Work).

## Core Concepts

### 1. Beads (The Atoms)
**Beads** are the fundamental unit of work and state. Every task, issue, or decision is captured as a Bead in a Git-backed SQLite database.
- **Intent**: What needs to be done.
- **State**: Strictly tracked (`open` -> `in_progress` -> `verify` -> `done`).
- **History**: An immutable log of all agent actions.

👉 **reference: [steveyegge/beads](https://github.com/steveyegge/beads)**

> **Note:** A list of community-built UIs, extensions, and tools for interacting with Beads can be found here: [Community Tools](https://github.com/steveyegge/beads/blob/main/docs/COMMUNITY_TOOLS.md).

### 2. The Foundry (Workflow Engine)
The Citadel goes beyond simple task lists by implementing a **Workflow Engine** that compiles static templates into dynamic graphs of work.

#### Formulas (The Recipes)
Formulas are deterministic TOML templates stored in `.citadel/formulas/`. They define standard operating procedures (SOPs).

```toml
# .citadel/formulas/feature_release.toml
formula = "feature"
description = "Implement feature {{name}}"

[vars.name]
description = "Feature name"
required = true

[[steps]]
id = "impl"
title = "Implement {{name}}"
description = "Write code and tests"

[[steps]]
id = "docs"
title = "Document {{name}}"
description = "Update user guide"
needs = ["impl"] # Dependency: 'docs' is blocked by 'impl'
```

#### Molecules (The Instances)
When a Formula is instantiated (e.g., "Run feature release for Dark Mode"), The Citadel "cooks" it into a **Molecule**.
- A Molecule is a Root Epic containing all the steps defined in the formula.
- Dependencies are automatically wired using `bd dep add`.

#### Convoys (The Shipments)
A **Convoy** is a long-lived context (Meta-Epic) used to group unrelated Molecules together, such as "Q1 Deliverables" or "Release v1.2". Agents can assign new Molecules directly to a specific Convoy.

### 3. Agents (The Workforce)
- **RouterAgent**: The foreman. Analyzes requests, instantiates Formulas, and assigns tasks.
- **WorkerAgent**: The builder. Picks up `open` Beads, writes code, and can **recursively breakdown work** (Dynamic Bonding).
- **EvaluatorAgent**: The QA. Verifies `verify` Beads against acceptance criteria before closing them.

---

## Usage Guide

### 1. Initialize a Project
Turn any directory into a Citadel-managed project (The Foundry).

```bash
citadel init
```

This creates:
- `.citadel/formulas/`: Where you store workflow templates.
- `citadel.config.ts`: Configuration file.
- `AGENTS.md`: Project-specific rules.
- `.beads/`: Local database.

### 2. Starting the System
The **Conductor** manages the agent loop.

```bash
citadel start
```

### 2. Running Workflows
You don't talk to agents directly; you assign them work via Beads. To trigger a workflow, simply create a request that the Router understands.

**Natural Language Trigger:**
```bash
bd create "Run the system migration formula for the Auth module"
```

**What happens next?**
1.  The **Router** picks up this request.
2.  It identifies the `system_migration` formula.
3.  It extracts the variable `target_system=Auth`.
4.  It compiles the Formula into a **Molecule** (a graph of Beads).
5.  **Workers** immediately start claiming the `open` steps.

### 3. Dynamic Bonding
Workers are not limited to single tasks. If a Worker picks up a large task (e.g., "Refactor API"), it can:
1.  Explore the codebase.
2.  Realize the task is too big.
3.  **Delegate** sub-tasks (create new child beads) to other workers.
4.  Block the parent task until children are complete.

### 4. Project Awareness (AGENTS.md)
You can "teach" agents about your specific project by placing `AGENTS.md` files in your repository.

**Example `.citadel/AGENTS.md`:**
```markdown
# Project Rules
- Framework: Next.js 14 (App Router)
- Styling: TailwindCSS
- Testing: Playwright

# Commands
- Test: `npm test`
- Lint: `npm run lint`

# Behavior
- Always write a test plan before implementing.
```

When a Worker enters a directory, it automatically merges the instructions from the nearest `AGENTS.md`.

---

## Advanced: Creating a New Formula

1.  Create a file in `.citadel/formulas/my_workflow.toml`.
2.  Define `vars` for any inputs you need.
3.  Define `steps` for the tasks.
4.  Use `needs = ["step_id"]` to define execution order.

The Router will automatically discover the new formula on its next cycle.

### 5. Smart Molecules
Formulas support advanced logic like **Conditions** and **Loops**.

```toml
[[steps]]
id = "prod_check"
title = "Run safety check"
if = "{{env}} == 'prod'"  # Only runs if env is prod
```

For more details on conditionals, loops, and failure handling, see the **[Formula Reference Manual](./FORMULA-REFERENCE.md)**.
