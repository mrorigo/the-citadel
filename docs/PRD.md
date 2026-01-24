Based on the chaos of Gas Town and the architectural principles derived in our conversation, here is an extensive Product Requirements Document (PRD) for **The Citadel**—a principled, deterministic agent orchestration system.

***

# Product Requirements Document: The Citadel
**Version:** 1.0 (The "Clean" Stack)
**Objective:** To transition agentic development from "vibe-coded" chaos to a deterministic, observable, and engineered manufacturing pipeline.

## 1. Executive Summary
The Citadel is an orchestration engine that decouples **State** (What needs to be done) from **Compute** (Who does it). Unlike "Gas Town," which relies on anthropomorphic role-playing and "random guessing," The Citadel treats agents as ephemeral, interchangeable compute units operating on a rigorous Directed Acyclic Graph (DAG) of tasks. The goal is to maximize throughput while minimizing the "slop" of hallucinations and merge conflicts.

## 2. Core Architectural Principles
*   **State > Compute:** Agent memory is volatile; the system of record must be durable. All context is hydrated from a persistent log, not "seances" with dead sessions.
*   **Nondeterministic Idempotence:** The execution path (agent thought process) varies, but the outcome (verifiable code artifact) must be idempotent. If a worker fails, another picks up the ticket immediately.
*   **Spec-Driven Development:** Humans provide the "Schema" (Architecture/Spec); Agents provide the "Implementation" (Code). Agents are never allowed to design the system architecture.
*   **Continuous Integration as Law:** No code enters the main branch without passing automated gates. "Creative re-imagining" is replaced by strict validation.

---

## 3. The Data Plane: Durable State ("The Ledger")
The system relies on a "Beads-like" architecture where work is atomic, trackable, and stored in version control.

### 3.1. The Atomic Unit (The Ticket)
*   **Requirement:** Work must be broken down into atomic units (JSON objects) stored in Git.
*   **Structure:** Each unit must contain a unique ID, status, assignee, and—crucially—a **deterministic acceptance test**.
*   **Rationale:** This creates a permanent paper trail. Even if the orchestration engine crashes, the state is preserved in the repo.

### 3.2. The Workflow Engine (Molecules/DAGs)
*   **Requirement:** Workflows must be defined as "Molecules"—chains of atomic tasks (e.g., Plan → Implement → Test).
*   **Constraint:** Agents cannot invent workflows. They must execute within a pre-defined DAG.
*   **Implementation:** Use TOML-based "Formulas" to define these workflows (templates) which are instantiated into active tasks.
*   **Durability:** If a step fails, the workflow pauses at that node. It does not restart from the beginning; it resumes from the last durable state (the last checked-off bead).

---

## 4. The Compute Plane: Agent Services (The Roles)
Agents are specialized micro-services, not generalist chat assistants. They are "cattle, not pets".

| Service Name       | Analogous Gas Town Role | Responsibilities                                                                       | Constraints                                                 |
| :----------------- | :---------------------- | :------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **The Router**     | The Mayor               | Ingests high-level human intent; decomposes it into atomic tickets; assigns to queues. | Read-only on code; Write-access on Tickets.                 |
| **The Worker**     | The Polecat             | Consumes a single ticket from the queue; produces a code artifact (Diff).              | Ephemeral. Spawns, executes, dies. No memory between tasks. |
| **The Supervisor** | Witness/Deacon          | Monitors queue health; restarts stalled Workers; enforces timeout policies.            | Does not write code. Only manages process lifecycle.        |
| **The Gatekeeper** | Refinery                | Manages the Merge Queue; resolves merge conflicts; runs CI/CD checks.                  | The only agent authorized to push to `main`.                |

---

## 5. Functional Requirements

### 5.1. The Queue System (Propulsion)
Instead of "nudging" agents to wake up (The Gas Town "GUPP" method), The Citadel uses active queue consumption.
*   **Requirement:** Implement a "Hook" system where every agent instance is tied to a specific work queue.
*   **Mechanism:** When a ticket is placed on a Hook, a Worker container is automatically instantiated.
*   **Fail-Safe:** If a Worker does not report a "Heartbeat" (via the Supervisor/Deacon), the container is killed and the ticket is returned to the queue.

### 5.2. The "Refinery" Pipeline (Merge Logic)
To prevent the chaos of 30 agents overwriting each other, we implement a strict **Stacked Diff** system.
*   **Requirement:** Agents must work on "Stacked Diffs" (small, dependent changes) rather than long-lived branches.
*   **Conflict Resolution:** The Gatekeeper (Refinery) processes merges serially. If a conflict arises, it does not "vibe" a solution. It rejects the ticket and respawns a Worker with the specific instruction: "Rebase onto new Head and fix conflict".
*   **Automated Gates:** Every submission triggers a sandbox environment. If `tests != pass`, the merge is rejected automatically.

### 5.3. The "Idea Compiler" Interface
The human interface must shift from "Chat" to "Specification."
*   **Requirement:** A CLI or UI that accepts "Specs" (high-level requirements) rather than conversational prompts.
*   **Function:** This input is fed to the Router (Mayor), which "compiles" the idea into a tree of Beads (Tickets).
*   **Human-in-the-Loop:** Critical design decisions must generate a "Blocking Bead" that requires human approval before the swarm continues.

---

## 6. Non-Functional Requirements & Constraints

### 6.1. Observability
*   **Dashboarding:** A TUI (Text User Interface) or Web UI that visualizes the DAG status, not just a chat log. Users must see which "Convoys" (feature sets) are stuck.
*   **Cost Controls:** Hard limits on token usage per ticket. If a Worker exceeds $X without closing a ticket, it is terminated by the Supervisor.

### 6.2. Context Management
*   **Context Rot Prevention:** Workers are destroyed after every task. Context is never carried over; it must be re-read from the persistent Bead (JSON) and the codebase.

---

## 7. Implementation Roadmap

### Phase 1: The Skeleton (Beads & Hooks)
*   Implement the Git-backed issue tracker (Beads).
*   Build the `gt sling` mechanism to assign JSON objects to agent queues.

### Phase 2: The Factory (Workers & Refinery)
*   Deploy stateless Worker containers that can read a Bead and execute a Diff.
*   Implement the Gatekeeper (Refinery) to serialize merges.

### Phase 3: The Guardrails (Supervision)
*   Deploy the Supervisor (Witness) to monitor "GUPP" (Propulsion) and ensure queues never stall.
*   Implement strict CI gates: Agents cannot merge without passing tests.

By adhering to this PRD, we move from the "Mad Max" simulation of Gas Town—where agents are erratic characters—to a **Citadel** where agents are deterministic processors of a durable state.