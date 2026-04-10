# The Citadel User Guide

Welcome to **The Citadel**, a deterministic orchestration engine for **Knowledge Work**. This system transforms chaotic agent interactions into a rigorous, verifiable process using the **MEOW Stack** (Molecular Expression of Work). It is designed to handle any complex objective—from software engineering and research analysis to content creation and data synthesis.

## What can you build?

The Citadel is agnostic to the domain of work. It shines whenever you need to maintain high quality and consistency across a series of tasks:
- **Software Engineering**: Plan, Implement, Test, and Document features.
- **Research & Analysis**: Gather data, summarize findings, and generate reports.
- **Content Operations**: Draft, Review, Edit, and Publish articles.

## Core Concepts

### 1. Pearls (The Atoms)
**Pearls** are the fundamental unit of work and state. Every task, issue, or decision is captured as a Pearl in a JSONL-based storage format.
- **Intent**: What needs to be done.
- **State**: Strictly tracked (`Open` -> `InProgress` -> `verify` -> `Closed`). (Note: `verify` is an internal state mapped from InProgress + label).
- **Context**: Structured input data (JSON) required for the task.
- **History**: An immutable log of all agent actions and comments.

👉 **reference: [mrorigo/pearls](https://github.com/mrorigo/pearls)**

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
- Dependencies are automatically wired using `prl link`.

#### Convoys (The Shipments)
A **Convoy** is a long-lived context (Meta-Epic) used to group unrelated Molecules together, such as "Q1 Deliverables" or "Release v1.2". Agents can assign new Molecules directly to a specific Convoy.

### 3. Agents (The Workforce)
- **RouterAgent**: The foreman. Analyzes requests, instantiates Formulas, and assigns tasks.
- **WorkerAgent**: The executor. Picks up `Open` Pearls, executes tasks (research, writing, coding, analysis) and can **recursively breakdown work** (Dynamic Bonding).
- **EvaluatorAgent**: The editor/verifier. Verifies `verify` Pearls against acceptance criteria (accuracy, style, functionality) before closing them. **Requires explicit `acceptance_test` details for every approval.**

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
- `.pearls/`: Local database in JSONL format.

### 2. Starting the System
The **Conductor** manages the agent loop.

```bash
citadel start
```

### 3. Running Workflows
You don't talk to agents directly; you assign them work via Pearls. To trigger a workflow, simply create a request that the Router understands.

**Natural Language Trigger:**
```bash
prl create "Run the system migration formula for the Auth module"
```

_or_

**Business Operations Trigger:**
```bash
prl create "Prepare Q3 Business Review for Sales Team"
# Router -> formula: qbr_prep, vars: quarter=Q3, team=Sales
```

**What happens next?**
1.  The **Router** picks up this request.
2.  It identifies the `system_migration` formula.
3.  It extracts the variable `target_system=Auth`.
4.  It compiles the Formula into a **Molecule** (a graph of Pearls).
5.  **Workers** immediately start claiming the `Open` steps.

### 4. Explicit Trigger (CLI)
For deterministic execution without relying on the Router to parse intent, use the CLI directly:

```bash
citadel create "Deploy Production" --formula deploy --vars env=prod
```

_or_

```bash
citadel create "AI Trends Whitepaper" --formula whitepaper --vars topic="Agentic Workflows"
```

### 5. Dynamic Bonding
Workers are not limited to single tasks. If a Worker picks up a large objective, it can recursively spawn child pearls using the `delegate_task` tool.

The system automatically manages the parent-child relationships based on the execution context. This allows for infinite recursive breakdown of work without losing state tracking.

**Example A: Refactoring (Software)**
1.  Worker claims "Refactor API".
2.  Explores code, finds 3 distinct services.
3.  Spawns 3 child pearls: "Refactor Auth", "Refactor Billing", "Refactor Users".
4.  Delegates pearls to other workers.

**Example B: Market Analysis (Research)**
1.  Worker claims "Competitor Analysis 2024".
2.  Identifies 5 key competitors.
3.  Spawns 5 child pearls (one per competitor) to gather deep data in parallel.
4.  Synthesizes the results once all children complete.

### 6. Agent Tooling & Context
The Citadel provides a "Context-Aware" runtime for all agents.

**Automatic Context Injection:**
When an agent executes a tool (like `submit_work` or `report_progress`), the system automatically injects the current `pearlId` and execution environment. Operations are always strictly scoped to the active Pearl, preventing cross-task interference.

### 7. Project Awareness & Custom Instructions
You can "teach" agents about your specific project by placing rules in your repository. The Citadel uses a tiered **Instruction Discovery Service** to build agent prompts dynamically.

#### The Instruction Hierarchy (Priority order)
1.  **Global Rules**: Loaded from `AGENTS.md` in the project root.
2.  **Builtin Defaults**: Hardcoded core safety and persistence rules for each role.
3.  **Role Overrides**: Files in `.citadel/instructions/role-${role}.md` (e.g., `role-worker.md`).
4.  **MCP Resources (Automatic)**: Automatically injected context from MCP servers (e.g., CodeFlow memory).
5.  **Formula Prompts**: Task-specific instructions defined in a workflow's TOML.
6.  **Tag-based Instructions**: Triggered by pearl labels (e.g., `tag:git` loads `tag-git.md`).
7.  **Context (Dynamic)**: Instructions passed directly in the pearl's JSON context.

#### Automatic Resource Injection
The Citadel supports automatic injection of MCP resources into the agent context. This allows agents to leverage rich context sources like CodeFlow's Cortex memory system (`memory://top`) or other MCP-exposed knowledge bases automatically.

Resources are aggregated from three levels:
1.  **Agent Level**: Configured in `citadel.config.ts`.
2.  **Formula Level**: Declared in `.toml` formula files via `mcp_resources`.
3.  **Pearl Level**: Specified dynamically in the pearl's JSON context.

**Example Formula Property:**
```toml
[mcp_resources]
code_flow = ["memory://project-conventions"]
```

#### Role-Specific Overrides
To customize a specific agent role project-wide, create a file in `.citadel/instructions/`:
```markdown
# .citadel/instructions/role-worker.md
- Always use 'npm test' to verify changes.
- Do not modify files in 'vendor/'.
```

#### Tag-based Specialization
If you have specific tools or domains (like Git, Research, or SQL), you can create tag-based instruction files. Any pearl with a `tag:NAME` label will automatically pull in `.citadel/instructions/tag-NAME.md`.

**Example 1: Specialized Git Instructions**
```markdown
# .citadel/instructions/tag-git.md
- Use short, descriptive commit messages.
- Always create a new branch for feature work.
```

When a Worker picks up a task labeled `tag:git`, it will receive these additional specialized instructions automatically.

**Example 2: Planning & Acceptance Criteria (`tag:planning`)**
For tasks that involve creating a plan, you can enforce strict acceptance criteria requirements. The system includes a default `tag-planning.md` instruction that is triggered by `tag:planning`.

```markdown
# .citadel/instructions/tag-planning.md
## Acceptance Criteria Requirement
When submitting your plan (via `submit_work`), you **MUST** include a `verification_plan` or `acceptance_criteria` section.
- This defines EXACTLY how the Gatekeeper will verify your work.
- **Failure to include this will result in immediate rejection.**
```

Workers handling `tag:planning` tasks are thus "primed" to provide the structured output the Gatekeeper demands.

### 8. Audit Logging & Observability
The Citadel ensures transparency by automatically logging critical agent actions directly to the Pearl's history.

**What gets logged?**
- **Routing Decisions**: When the Router assigns a task, it logs the reasoning and target queue.
- **Work Submissions**: When a Worker submits a task, the summary and structured output are logged.
- **Verification Results**: When a Gatekeeper approves or rejects work, the decision and feedback are logged.
- **Token Usage**: Every agent run includes a collapsed "Agent Usage Stats" section detailing token consumption.

**Example Audit Log:**
```markdown
**Routed to worker**

Task has status 'open', routing to worker queue for implementation.
Reasoning: The user requested a new feature implementation.

---

**Agent Usage Stats (router)**

- **Input Tokens**: 1584
- **Output Tokens**: 103
- **Total Tokens**: 1687
```

### 9. Structured Data Flow
The Citadel supports passing rich data between steps, enabling complex chaining and branching.

**Input (Context):**
Pass structured data to any task using the `context` field or Pearls metadata.

**Output (Structured Results):**
Workers can return structured JSON outputs instead of just text summaries. These outputs are stored in the queue and can be used by subsequent steps or for automated verification.

**Self-Correction & Improved Tool Feedback:**
The Citadel features an "Agent Encouragement" mechanism. If an agent calls a tool with invalid arguments (e.g., missing a required field like `acceptance_test`), the system returns a detailed **Validation Error** containing specific Zod feedback. This allows the agent to understand exactly why a call failed and "self-correct" by retrying with corrected parameters immediately within the same run.

**Dynamic Piping:**
Chain steps together by referencing outputs from previous steps.

```toml
[[steps]]
id = "scout"
title = "Scout Location"
[steps.output_schema]
type = "object"
required = ["coordinates"]
properties = { coordinates = { type = "string" } }

[[steps]]
id = "deploy"
title = "Deploy Unit"
needs = ["scout"]
context = { target = "{{steps.scout.output.coordinates}}" }
```

---

## Advanced: Creating a New Formula

### 10. Writing Formulas

1.  Create a file in `.citadel/formulas/my_workflow.toml`.
2.  Define `vars` for any inputs you need.
3.  Define `steps` for the tasks.
4.  Use `needs = ["step_id"]` to define execution order.

The Router will automatically discover the new formula on its next cycle.

### 11. Smart Molecules
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

---

## Configuration (`citadel.config.ts`)

The Citadel is configured via a `citadel.config.ts` file in your project root. Use the `defineConfig` helper for type-safe configuration.

### 1. Providers
Configure credentials and base URLs for LLM providers.

```typescript
providers: {
    openai: { apiKey: 'sk-...' },
    anthropic: { apiKey: 'sk-ant-...' },
    ollama: {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama', // Required for OpenAI compatibility layer
    }
}
```

### 2. Agent Roles
Define which model each agent role should use and which MCP tools they can access.

*   **`router`**: Analyzes requests and instantiates formulas.
*   **`worker`**: Executes tasks and handles dynamic bonding.
*   **`gatekeeper`**: Verifies completed work (implemented by `EvaluatorAgent`).
*   **`supervisor`**: (Optional) For high-level oversight.

```typescript
agents: {
    router: { provider: 'ollama', model: 'gpt-oss:120b' },
    worker: { 
        provider: 'openai', 
        model: 'gpt-4o',
        mcpTools: ['filesystem:*', 'github:*'] 
    },
    gatekeeper: { 
        provider: 'anthropic', 
        model: 'claude-3-5-sonnet',
        mcpTools: ['filesystem:read_text_file'] // Restricted access
    }
}
```

### 3. Execution & Scaling Pools
Configure how workers and gatekeepers are scaled based on workload.

#### Worker Pool (`worker`)
Settings for agents processing standard tasks.

*   **`timeout`**: Max seconds per task (default: 300).
*   **`maxRetries`**: Max attempts per ticket (default: 3).
*   **`costLimit`**: Max USD or weight per day (default: 1.00).
*   **`min_workers`**: Minimum active instances (default: 1).
*   **`max_workers`**: Maximum dynamic scaling limit (default: 5).
*   **`load_factor`**: Ratio of tasks to workers. `1.0` means 1 worker per task; `0.5` means 1 worker per 2 tasks.

#### Gatekeeper Pool (`gatekeeper`)
Settings for agents verifying tasks.

*   **`min_workers`**, **`max_workers`**, **`load_factor`**: Same logic as worker pool.
*   **`auto_close_epics`**: Automatically close Epic pearls when all subtasks are completed (default: false).

```typescript
worker: {
    timeout: 600,
    min_workers: 2,
    max_workers: 10,
    load_factor: 1.0
},
gatekeeper: {
    min_workers: 1,
    max_workers: 3,
    auto_close_epics: true
}
```

### 4. MCP Servers
Connect external tools via the Model Context Protocol. Supports **Stdio** (local) and **HTTP/SSE** (remote).

```typescript
mcpServers: {
    filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allow'],
        env: { SOME_VAR: 'value' }
    },
    weather: {
        url: 'https://api.weather-mcp.com/sse',
        headers: { 'Authorization': 'Bearer ...' }
    }
}
```

### 5. Pearls Integration
Configure the underlying state engine.

*   **`path`**: Directory for the Pearls data (default: `.pearls`).
*   **`binary`**: Path to the `prl` CLI (default: `prl`).
*   **`autoSync`**: Automatically sync state with Git (default: true).

```typescript
    path: '.pearls',
    binary: '/usr/local/bin/prl',
    autoSync: true
}
```

> **Note on Storage Mode**: The Citadel uses `prl` to manage work items in `issues.jsonl`. This ensures stability across all environments and high-load state transitions.


### 6. Context Management
Control the amount of information passed to agents to manage costs and prevent context overflow.

- **`maxHistoryMessages`**: Maximum number of conversation turns to keep in memory (default: 20). Pruning is smart and preserves the System Prompt and tool-result pairs.
- **`maxToolResponseSize`**: Default maximum characters for a single tool output (default: 50,000). 
- **`offloadThresholds`**: Per-server limits for offloading (e.g., `{ "filesystem": 100000 }`). Setting a threshold to `0` or a very large number effectively disables offloading for that server.
- **`maxMessageSize`**: Safety limit for any single message (default: 100,000).

```typescript
context: {
    maxHistoryMessages: 30,
    maxToolResponseSize: 50000,
    offloadThresholds: {
        "web_search": 10000, // Aggressive offloading for web results
        "filesystem": 0      // Never offload filesystem results
    },
    maxMessageSize: 200000
}
```

#### Tool Result Offloading (Offload-and-Inspect)
When a tool result exceeds its configured threshold, The Citadel automatically offloads the full content to disk and provides the agent with a structured placeholder:

```text
--- TOOL RESULT OFFLOADED ---
ID: abc-123-def
Server: filesystem
Tool: read_text_file
Size: 154,230 characters

The output of this tool was too large for the current context. A short excerpt is provided below:
---
[Excerpt of first 1000 characters...]
---

ACTION REQUIRED: To reason over the full content, use the 'inspect_result' tool with resultId 'abc-123-def'.
```

#### The `inspect_result` Tool
Agents can use the `inspect_result` tool to query offloaded content without pulling the raw data into their main context. This invokes a **non-autonomous sub-agent** optimized for:
- **Text Extraction**: "Find the database connection string in this log."
- **Summarization**: "Summarize the key findings from this research paper."
- **Analysis**: "Identify any error patterns in the last 100 lines."

**Constraints**: The sub-agent has no tools, no internet access, and no autonomy beyond answering a single query about the provided content. This ensures the main agent remains in control of the high-level plan.

---

### 7. Bridge Environment
*   **`env`**: `'development'` or `'production'`.
*   **`bridge.maxLogs`**: Number of log lines maintained in TUI memory (default: 1000).
*   **Persistent Storage**: Offloaded tool results are stored in `.citadel/tool-results/<pearl-id>/` and are kept indefinitely for audit purposes.

---
