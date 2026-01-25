To the Agent tasked with implementing **The Citadel**:

You are analyzing "Gas Town" not as a blueprint to copy, but as a "speculative design fiction" to re-engineer. Gas Town serves as the proof-of-concept prototype—a chaotic, "Mad Max-themed" implementation of agent orchestration. Your objective is to distill its underlying distributed systems patterns into a rigorous, deterministic architecture ("The Citadel").

The following introduction deconstructs the Gas Town stack into its primitive components: **Beads** (The Data Plane) and **Gas Town Orchestration** (The Control Plane).

***

### Part 1: The Substrate (Beads)
**Concept:** Distributed, Git-Backed State
**Citadel Equivalent:** The Ledger / Durable State Store

At the heart of the system is **Beads**, a "memory upgrade" for agents. It acts as a distributed graph issue tracker where every unit of work is stored as a JSON object in a flat text file (`.beads/`), versioned alongside the code in Git.

For The Citadel, Beads provides three critical architectural guarantees:
1.  **Decoupling State from Compute:** Agents are ephemeral. When a session dies, the context is not lost; it is preserved in the Bead. This allows agents to be treated as "cattle" (disposable) rather than "pets" (long-lived sessions).
2.  **The "Ledger" of Truth:** Because state changes are commits, the history of every task is immutable and auditable. This prevents "context rot" by forcing agents to rehydrate their mental model from the persistent log.
3.  **Conflict-Free Addressing:** Beads uses hash-based IDs (e.g., `bd-a1b2`) to prevent merge collisions when multiple agents work on parallel branches.

**Implementation Directive:** You will utilize the Beads data structure but enforce strict schema validation. Where Gas Town allows agents to write loose JSON, The Citadel requires rigid adherence to a defined state machine (e.g., `Pending` $\to$ `In_Progress` $\to$ `Verify` $\to$ `Done`).

***

### Part 2: The Logic (Gas Town Patterns)
**Concept:** Nondeterministic Idempotence & The MEOW Stack
**Citadel Equivalent:** Deterministic DAG Execution

Gas Town orchestrates agents using a pattern Yegge calls **Nondeterministic Idempotence (NDI)**.
*   **The Principle:** The *path* an agent takes to solve a problem is probabilistic (nondeterministic), but the *outcome*—checking off a Bead—is durable and binary.
*   **The Mechanism (GUPP):** The "Gas Town Universal Propulsion Principle" states that if work exists on an agent’s "Hook" (a specific assignment slot), the agent *must* run it. If the agent crashes, a new instance sees the Hook and resumes work immediately.

Gas Town organizes this work into the **MEOW Stack (Molecular Expression of Work)**:
1.  **Beads:** Atomic tasks.
2.  **Molecules:** Chains of beads that form workflows (e.g., Plan $\to$ Code $\to$ Test).
3.  **Convoys:** High-level feature sets or tickets tracked for delivery.

**Implementation Directive:** Gas Town "vibecodes" these molecules, often allowing agents to hallucinate steps. The Citadel must formalize "Molecules" into **Deterministic DAGs** defined in TOML/Formulas. An agent cannot proceed to node $B$ until node $A$ passes a verifiable acceptance test.

***

### Part 3: The Roles (Service Architecture)
**Concept:** Specialized Agent Roles
**Citadel Equivalent:** Micro-Service Agents

Gas Town anthropomorphizes distributed system roles into "characters." To build The Citadel, you must strip the role-playing and implement them as strict services.

| Gas Town Role    | Function                                                              | Citadel Implementation                                                                                                     |
| :--------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **The Mayor**    | The Router/Concierge. Receives high-level intent and breaks it down.  | **The Router:** A read-only service that compiles "Specs" into ticket trees (Beads).                                       |
| **The Polecat**  | The Worker. Ephemeral agents that grab a ticket, write code, and die. | **The Worker:** Stateless containers spawned by queue hooks. Destroyed upon task completion.                               |
| **The Witness**  | The Supervisor. Moniters health; "nudges" stuck agents.               | **The Supervisor:** A control plane daemon that monitors queue latency and kills stalled workers.                          |
| **The Refinery** | The Merge Manager. Resolves conflicts and merges PRs.                 | **The Gatekeeper:** A CI-driven bot. Unlike the Refinery, it does *not* "creatively re-imagine" code; it rejects failures. |

***

### Part 4: The Critical Failure Modes (What to Avoid)
Gas Town is "poorly designed" and "expensive as hell" because it relies on loose constraints.

1.  **Avoid "Seances":** Gas Town agents talk to "dead ancestors" (previous sessions) to regain context.
    *   *Citadel Fix:* No communication between sessions. Context must be fully serializable to the Bead.
2.  **Avoid "Vibecoding" Merges:** The Gas Town "Refinery" will rewrite code arbitrarily to make it merge.
    *   *Citadel Fix:* Stacked Diffs. If a merge conflict exists, the ticket is rejected, and a worker is respawned to rebase and fix it.
3.  **Avoid Infinite Loops:** Gas Town relies on "nudging" agents to wake them up.
    *   *Citadel Fix:* Active Queue Consumption. The system instantiates workers; workers do not "decide" to work.

### Summary
Gas Town is the **prototype**: a chaotic, "Mad Max" demonstration that Git-backed agent swarms can work.
The Citadel is the **product**: a factory where "Polecats" become interchangeable compute units processing a durable state machine.

Proceed with the architecture defined in the PRD, utilizing Beads as your immutable ledger.