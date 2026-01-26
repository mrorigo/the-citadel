# The Citadel User Guide

Welcome to **The Citadel**, a deterministic orchestration engine for **Knowledge Work**. This system transforms chaotic agent interactions into a rigorous, verifiable process using the **MEOW Stack** (Molecular Expression of Work). It is designed to handle any complex objective—from software engineering and research analysis to content creation and data synthesis.

## What can you build?

The Citadel is agnostic to the domain of work. It shines whenever you need to maintain high quality and consistency across a series of tasks:
- **Software Engineering**: Plan, Implement, Test, and Document features.
- **Research & Analysis**: Gather data, summarize findings, and generate reports.
- **Content Operations**: Draft, Review, Edit, and Publish articles.

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

**Example 2: Podcast Production (Content)**
This formula orchestrates a creative pipeline with parallel tasks.

```toml
# .citadel/formulas/podcast.toml
formula = "podcast"
description = "Produce episode {{episode_num}}"

[vars.guest]
description = "Guest Name"
required = true

[[steps]]
id = "script"
title = "Draft Questions for {{guest}}"
description = "Research guest and draft interview outline"

[[steps]]
id = "scheduling"
title = "Schedule Recording"
description = "Coordinate time with {{guest}}"

[[steps]]
id = "record"
title = "Record Interview"
description = "Conduct remote recording session"
needs = ["script", "scheduling"] # Waits for both script and booking

[[steps]]
id = "edit"
title = "Edit Audio"
description = "Post-production and mastering"
needs = ["record"]
```

**Advanced Example: Deep Research Agent**
This formula demonstrates resilience. If analysis fails (e.g., due to insufficient data), the system automatically triggers a rollback to the gathering phase.

```toml
# .citadel/formulas/deep_research.toml
formula = "deep_research"
description = "Conduct deep research on {{topic}}"

[vars.topic]
description = "Research topic"
required = true

[[steps]]
id = "gather"
title = "Gather Information"
description = "Search web and filesystem for {{topic}}"

[[steps]]
id = "analyze"
title = "Analyze Findings"
description = "Synthesize gathered data into a summary"
needs = ["gather"]
on_failure = "gather" # <--- If analysis fails, retry gathering with new instructions

[[steps]]
id = "report"
title = "Write Report"
description = "Draft final report based on analysis"
needs = ["analyze"]
```

#### Molecules (The Instances)
When a Formula is instantiated (e.g., "Run feature release for Dark Mode"), The Citadel "cooks" it into a **Molecule**.
- A Molecule is a Root Epic containing all the steps defined in the formula.
- Dependencies are automatically wired using `bd dep add`.

#### Convoys (The Shipments)
A **Convoy** is a long-lived context (Meta-Epic) used to group unrelated Molecules together, such as "Q1 Deliverables" or "Release v1.2". Agents can assign new Molecules directly to a specific Convoy.

### 3. Agents (The Workforce)
- **RouterAgent**: The foreman. Analyzes requests, instantiates Formulas, and assigns tasks.
- **WorkerAgent**: The executor. Picks up `open` Beads, executes tasks (research, writing, coding, analysis) and can **recursively breakdown work** (Dynamic Bonding).
- **EvaluatorAgent**: The editor/verifier. Verifies `verify` Beads against acceptance criteria (accuracy, style, functionality) before closing them.

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

_or_

**Business Operations Trigger:**
```bash
bd create "Prepare Q3 Business Review for Sales Team"
# Router -> formula: qbr_prep, vars: quarter=Q3, team=Sales
```

**What happens next?**
1.  The **Router** picks up this request.
2.  It identifies the `system_migration` formula.
3.  It extracts the variable `target_system=Auth`.
4.  It compiles the Formula into a **Molecule** (a graph of Beads).
5.  **Workers** immediately start claiming the `open` steps.

### 3. Explicit Trigger (CLI)
For deterministic execution without relying on the Router to parse intent, use the CLI directly:

```bash
citadel create "Deploy Production" --formula deploy --vars env=prod
```

_or_

```bash
citadel create "AI Trends Whitepaper" --formula whitepaper --vars topic="Agentic Workflows"
```

### 4. Dynamic Bonding
Workers are not limited to single tasks. If a Worker picks up a large objective, it can recursively spawn child beads.

**Example A: Refactoring (Software)**
1.  Worker claims "Refactor API".
2.  Explores code, finds 3 distinct services.
3.  Spawns 3 child beads: "Refactor Auth", "Refactor Billing", "Refactor Users".
4.  Delegates beads to other workers.

**Example B: Market Analysis (Research)**
1.  Worker claims "Competitor Analysis 2024".
2.  Identifies 5 key competitors.
3.  Spawns 5 child beads (one per competitor) to gather deep data in parallel.
4.  Synthesizes the results once all children complete.

### 5. Project Awareness (AGENTS.md)
You can "teach" agents about your specific project by placing `AGENTS.md` files in your repository.

**Example `.citadel/AGENTS.md`:**
```markdown
# Project Rules
- Tone: Professional, Academic
- Format: APA Style Citations
- Tools: Use 'filesystem' for gathering existing data

# Behavior
- Always verify sources before citing.
- Summarize findings before drafting sections.
```

When a Worker enters a directory, it automatically merges the instructions from the nearest `AGENTS.md`.

---

## Advanced: Creating a New Formula

### 6. Writing Formulas

1.  Create a file in `.citadel/formulas/my_workflow.toml`.
2.  Define `vars` for any inputs you need.
3.  Define `steps` for the tasks.
4.  Use `needs = ["step_id"]` to define execution order.

The Router will automatically discover the new formula on its next cycle.

### 7. Smart Molecules
Formulas support advanced logic like **Conditions**, **Loops**, and **Resilient Recovery**.

```toml
[[steps]]
id = "prod_check"
title = "Run safety check"
if = "{{env}} == 'prod'"  # Only runs if env is prod
on_failure = "rollback"   # Triggers rollback if safety check fails
```

For more details on conditionals, loops, and the resilient failure handling logic, see the **[Formula Reference Manual](./FORMULA-REFERENCE.md)**.

---

## MCP Tools (Extending Capabilities)

The Citadel supports the **Model Context Protocol (MCP)**, allowing you to connect agents to external tools and data sources.

### 1. Configure MCP Servers
Add your MCP servers to `citadel.config.ts`. The Citadel supports both local **Stdio** servers (via `command`) and remote **HTTP/SSE** servers (via `url`).

```typescript
export default defineConfig({
    worker: {
        timeout: 300,
        maxRetries: 3,
        costLimit: 1.00,
        // Concurrency Settings
        min_workers: 1,    // Minimum number of active workers
        max_workers: 5,    // Scaled up when queue is deep
        load_factor: 1.0,  // Ratio of tasks to workers (1.0 = 1 task per worker)
    },
    gatekeeper: {
        min_workers: 1,
        max_workers: 5,
        load_factor: 1.0,
    },
  mcpServers: {
    // Local Stdio server
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    // Remote HTTP/SSE server
    professional_api: {
      url: 'https://mcp.company.com/api',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
      }
    }
  },
  // ...
});
```

> [!NOTE]
> The filesystem server uses **MCP Roots** to dynamically determine which directories it can access. The Citadel automatically provides the current project workspace to servers during initialization.

### 2. Assign Tools to Agents
You can selectively expose MCP tools to specific agent roles using the `mcpTools` array.

- `server:*`: Exposes all tools from that server (standard for **WorkerAgent**).
- `server:tool_name`: Exposes a specific tool (useful for restricting **EvaluatorAgent**).

```typescript
agents: {
  worker: { 
    mcpTools: ['filesystem:*'] 
  },
  gatekeeper: {
    mcpTools: [
      'filesystem:read_text_file',
      'filesystem:list_directory',
      // ... only read-only tools
    ]
  }
}
```

Agents will see these tools alongside their native capabilities, prefixed with the server name (e.g., `filesystem_read_text_file`).
