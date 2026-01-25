# The Citadel: Engineering a Deterministic Hive Mind

**A Deep Dive into the 48-Hour Architecture of the MEOW Stack**

*January 25, 2026*

Three days ago, "Gas Town" was a provocation. It was a messy, inspiring vision of agents acting as "sloppy fish" in a barrel, relying on vibes, "seances" (resuming dead sessions), and sheer volume to get work done.

We looked at that chaos and saw a challenge. Could we build the Gas Town vision—a swarm of autonomous workers—but replace the "vibes" with **computer science**? Could we treat agent interactions not as chat logs, but as **distributed graph database transactions**?

The answer is **The Citadel**. And we built it in 48 hours.

This post peels back the layers of the architecture, showing the code patterns and design decisions that turned a "Mad Max" fantasy into a rigorous **Knowledge Factory**.

---

## Gas Town vs. The Citadel: A Concept Map

We adopted the core Gas Town metaphors but hardened the implementation.

| Gas Town Concept     | The Citadel Implementation | Why?                                                                                     |
| :------------------- | :------------------------- | :--------------------------------------------------------------------------------------- |
| **GUPP** (Hook)      | **Event Loop** (Queue)     | Politeness ("You MUST run it") fails. Event loops guarantees execution.                  |
| **Seance** (/resume) | **Git-Backed State**       | Sessions are ephemeral. State must survive process death without "talking to ancestors". |
| **Polecats**         | **Worker Agents**          | "Slinging work" is sloppy. We assign work via strict database transactions.              |
| **Refinery**         | **Evaluator / Gatekeeper** | Merging is hard. We use a dedicated QA agent to verify work before closing it.           |
| **Cooking**          | **The Foundry**            | We "compile" TOML templates into directed acyclic graphs (DAGs).                         |

---

## The Core Invariant: State > Compute

The fundamental problem with most agent orchestrators is that they treat the **Agent** as the primary entity. You talk to "The Coder" or "The Architect".

In The Citadel, the primary entity is **The Work**. The agent is just a temporary compute resource instantiated to advance the state of the work.

We enforce this with **Beads**, a local-first, git-backed issue tracker.

### The Ledger (Beads)

Every atomic unit of work in The Citadel is a "Bead". It's not just a JSON object; it's a node in a dependency graph.

**Structure of a Bead:**
```typescript
interface Bead {
  id: string;          // "bd-a7f92"
  status: BeadStatus;  // open | in_progress | verify | done
  priority: number;
  blockers: string[];  // IDs of other beads that must be done first
  acceptance_test?: string; // The criteria for 'verify' -> 'done'
}
```

The system is strictly event-driven. Agents don't poll; they subscribe.

---

## Phase 1: The Foundry (Workflow Engine)

Gas Town relied on prompting agents to "figure it out". The Citadel relies on **Formulas**. We realized that 90% of knowledge work is repeating a Standard Operating Procedure (SOP).

We built **The Foundry**, a compiler that turns static TOML templates into dynamic execution graphs called **Molecules**.

### The Formula (Source Code)
```toml
# .citadel/formulas/feature.toml
formula = "feature"

[[steps]]
id = "impl"
title = "Implement {{name}}"

[[steps]]
id = "test"
title = "Write Tests"
needs = ["impl"]  # <--- Dependency Injection
```

### The Molecule (Compiled Binary)
When the Router Agent "cooks" this formula, it doesn't just copy it. It resolves variables and builds a Directed Acyclic Graph (DAG) in the Beads database.

Logic carried out by the **WorkflowEngine**:
1.  **Parse TOML**: Validate structure.
2.  **Hydrate Variables**: `{{name}}` -> "Dark Mode".
3.  **Wire Dependencies**: The `impl` bead is created. The `test` bead is created with `blockers: [impl.id]`.
4.  **Persist**: The entire graph represents the "Molecule".

This means **Resilience** is built-in. If the server crashes, the molecule exists in Git. When the system restarts, the state is preserved. "Test" is still blocked by "Impl".

---

## Phase 2: Dynamic Bonding (The "Rule of Five")

This is the "killer feature" that emerged on Day 2. We realized that static plans aren't enough. An agent needs to be able to **expand** the graph at runtime.

We call this **Dynamic Bonding**.

### The Pattern
A Worker Agent picks up a bead: *"Analyze Competitors"*.
It realizes this is too big. Instead of doing a bad job, it:
1.  **Reads** the `AGENTS.md` context.
2.  **Identifies** 5 sub-tasks (one for each competitor).
3.  **Spawns** 5 new beads as children of the current bead.
4.  **Suspends** itself.

**Code Logic (Simplified):**
```typescript
// Worker Loop
async function processBead(bead: Bead) {
  const plan = await llm.generatePlan(bead.description);

  if (plan.needsSubdivision) {
    const children = plan.subtasks.map(t => beads.create(t));
    await beads.addDependency(bead.id, children.ids);
    log(`[Bonding] Decomposed ${bead.id} into ${children.length} atoms.`);
    return; // Agent releases the bead back to the pool
  }

  // ... execute task
}
```

This effectively creates the "Rule of Five"—redundant, parallel verification—as a first-class graph operation.

---

## Phase 3: The Unified Agent Loop

Early iterations had separate loops for "Mayors", "Deacons", and "Refineries". This was unmaintainable. We refactored everything into a strict **CoreAgent** architecture.

### The Loop
```typescript
class CoreAgent {
  async loop() {
    while (running) {
      // 1. Sense
      const context = await this.readContext(); // Beads, Files, Git

      // 2. Decide
      const action = await this.model.decide(context);

      // 3. Act (Tool Call)
      const result = await this.execute(action);

      // 4. Update Ledger
      await this.syncState(result);
    }
  }
}
```

This standardization allowed us to plug in **MCP (Model Context Protocol)** effortlessly. Now, instead of hardcoding "Write File" tools, we just mount the `filesystem` MCP server. The agent capabilities exploded overnight.

---

## Phase 4: Resilient Recovery

Things break. LLMs hallucinate. APIs fail.
We implemented **Resilient Recovery** directly in the formula schema using `on_failure`.

```toml
[[steps]]
id = "analyze"
needs = ["gather"]
on_failure = "recover_analysis" # <--- The Loop

[[steps]]
id = "recover_analysis"
title = "Fix Data"
# This step only runs if 'analyze' fails
```

If the `analyze` step fails, the graph engine automatically triggers the `recover_analysis` bead. The system self-corrects by running a specific remediation path. No human intervention required.

---

## The Result: A Knowledge Factory

In 48 hours, we moved from "vibecoding" to a deterministic factory.

-   **Input**: High-level intent ("Build X", "Research Y").
-   **Process**:
    -   Router compiles Formula -> Molecule.
    -   Workers claim atoms.
    -   Workers bond (subdivide) atoms.
    -   Evaluators verify atoms.
-   **Output**: Verified, committed artifacts.

The Citadel proves that you don't need a massive team to build a complex orchestration engine. You just need the right abstractions: **State over Compute**, **Graphs over Chats**, and **Formulas over Prompts**.

The Factory is open. The Line is moving.
