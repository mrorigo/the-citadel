Based on the constraints (no modification to the `bd` binary) and the goal (a generic, principled workflow engine), here is the **Engineering Change Request (ECR) v1.1** for The Citadel.

This architecture strictly separates **The Citadel** (The Application Logic) from **Beads** (The Database). We implement the "MEOW Stack" concepts (Formulas, Molecules, Convoys) purely through orchestration logic and standard `bd` commands.

***

# Engineering Change Request: Citadel v1.1 ("The Foundry Update")

**Status:** Draft
**Component:** Citadel Router Service & Worker Runtime
**Constraint:** Strict adherence to standard `steveyegge/beads` CLI.

## 1. Executive Summary
We are upgrading The Citadel from a "Task Factory" (single-bead creation) to a **Workflow Engine**. To achieve this without forking the underlying `beads` repository, we will implement the **MEOW Stack** (Molecular Expression of Work) purely in the **Router's application layer**.

The Router will act as a "Compiler," translating static TOML templates (Formulas) into standard `bd create` and `bd dep add` commands. This allows us to support complex, generic workflows (Molecules) and high-level tracking (Convoys) using existing infrastructure.

---

## 2. Feature: Generic Formula Support (TOML)
We will implement a standard library of workflows stored as TOML files. These files are not read by `bd`, but by the **Citadel Router**.

**Requirement:**
Add a `.citadel/formulas/` directory to the repository to store deterministic workflow templates.

**The Generic Schema:**
We will use a strictly typed schema that supports variable injection and dependency wiring.

```toml
# .citadel/formulas/generic_workflow.toml
formula = "system_migration"
description = "Generic template for migrating subsystems"

# 1. Variables (Injected at runtime)
[vars.target_system]
description = "The name of the system being migrated (e.g., Auth, Billing)"
required = true

# 2. Steps (The Atoms)
[[steps]]
id = "audit"
title = "Audit {{target_system}}"
description = "Run analysis scripts on {{target_system}} codebase."

[[steps]]
id = "impl"
title = "Implement {{target_system}} Migration"
description = "Refactor code to use new interface."
needs = ["audit"]  # Dependency: Blocks until 'audit' is closed

[[steps]]
id = "verify"
title = "Verify {{target_system}}"
description = "Run regression tests."
needs = ["impl"]   # Dependency: Blocks until 'impl' is closed
```

---

## 3. Feature: The "Cook" Logic (Router Upgrade)
We cannot add a `bd cook` command. Therefore, we will implement the cooking logic inside the **Router Agent's runtime**.

**The Algorithm:**
When a user requests: `citadel run system_migration target_system=Auth`, the Router executes the following loop using standard CLI tools:

1.  **Read & Validate:** Load the TOML. Ensure `target_system` is provided.
2.  **Create Container (The Molecule):**
    *   *Command:* `bd create "Run system_migration (Auth)" --type epic`
    *   *Capture:* Store the resulting ID (e.g., `bd-100`).
3.  **Instantiate Steps:**
    *   Iterate through `[[steps]]`.
    *   *Command:* `bd create "{title}" --description "{description}" --parent bd-100`
    *   *Map:* Store the mapping of `TOML_ID` $\to$ `REAL_BEAD_ID`.
4.  **Wire Dependencies (The DAG):**
    *   For every step with a `needs` array:
    *   *Command:* `bd dep add {REAL_CHILD_ID} {REAL_PARENT_ID}`

**Outcome:** We achieve a "Molecule" (a directed acyclic graph of beads) without the database knowing it is anything other than standard tasks.

---

## 4. Feature: Convoys (Meta-Tracking)
We cannot add `bd convoy create`. We will instead define a **Convoy** as a specific *Type* of Bead managed by conventions.

**Definition:**
A Convoy is a root-level Epic used strictly for grouping unrelated streams of work (e.g., "Q1 Objectives").

**Implementation:**
*   **Creation:** The Router creates Convoys using the generic `type` flag (supported by standard JSONL schema in Beads).
    *   *Command:* `bd create "Q1 Cleanup Convoy" --type convoy`
*   **Tracking:** To view Convoys, we will not use a new command. We will filter standard output.
    *   *Command:* `bd show --type convoy` (or standard `grep` on the JSONL if `bd show` filters are limited).
*   **Assignment:** When "slinging" a Molecule, the Router will parent the Molecule's root Epic to the Convoy Bead.
    *   *Result:* `Convoy (bd-1)` $\to$ `Molecule Epic (bd-2)` $\to$ `Task (bd-3)`.

---

## 5. Feature: Dynamic Bonding (Runtime Expansion)
Complex workflows often require an agent to spawn more work mid-task (e.g., "I found 5 files to fix, I need 5 sub-tasks"). This is the "Rule of Five" or "Dynamic Bonding."

**The Worker Capability:**
We do not need new `bd` commands. We simply grant **Worker Agents** the permission to recursively call `bd create` and `bd dep add`.

**The Workflow:**
1.  **Worker** picks up `Task A`.
2.  **Worker** analyzes the code and realizes it needs to split the work.
3.  **Worker** executes a script (or manual CLI commands):
    *   `bd create "Subtask 1" --parent {Task_A_ID}`
    *   `bd create "Subtask 2" --parent {Task_A_ID}`
    *   `bd dep add {Task_A_ID} {Subtask_1_ID}` (Wait logic: Task A cannot close until Subtask 1 closes).
4.  **Evaluator** Update: The Evaluator (QA agent) must check `bd ready` logic. If `Task A` has open children/dependencies, it refuses to merge/close it.

---

## Summary of Changes

| Concept               | Gas Town (Custom Engine) | The Citadel (Generic/Standard)                   |
| :-------------------- | :----------------------- | :----------------------------------------------- |
| **Workflow Schema**   | Custom TOML Parser       | Generic TOML read by Router Logic                |
| **Instantiation**     | `bd cook` / `bd pour`    | Router loop executing `bd create` + `bd dep add` |
| **Workflow Object**   | "Molecule" Object        | Standard **Epic** Bead (`type=epic`)             |
| **Shipment Tracking** | `bd convoy create`       | Standard Bead with `type=convoy`                 |
| **Runtime Expansion** | "Protomolecule" Macros   | Worker recursively running `bd create`           |

**Approval:**
This request satisfies the requirement for a principled, generic workflow engine while maintaining 100% compatibility with the upstream `beads` binary.