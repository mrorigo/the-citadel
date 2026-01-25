# Strategic Roadmap: The Next 5 Features

This document outlines the high-value features prioritized for the next phase of development for **The Citadel**. These features focus on Observability, Control, and Intelligence.

## 1. The Bridge (TUI Dashboard)
**Problem:** Managing complex dependency graphs (Molecules) via CLI (`bd show`, `bd ready`) becomes neurologically taxing as concurrency scales.
**Solution:** A Terminal User Interface (TUI) acting as a real-time Mission Control.
- **Visual Graph:** Render the DAG of active Molecules.
- **Live Logs:** Stream Worker thoughts and tool outputs in split panes.
- **Intervention:** Allow the user to pause, cancel, or modify Beads directly from the UI.
- **Stack:** `ink` (React for CLI) or `blessed`.

## 2. Smart Molecules (Conditional Logic)
**Problem:** Current Formulas are static linear/DAG templates. Real-world operations require decision branching (e.g., "If tests fail, run rollback, else report success").
**Solution:** Enhance the `FormulaSchema` and `WorkflowEngine` to support:
- **Conditionals:** `if` fields in steps evaluating context variables.
- **Loops:** `foreach` over a list of files or inputs.
- **Failure Handlers:** `on_failure` routes to specialized recovery beads.

## 3. The Tribunal (Human Gateways)
**Problem:** The move from `in_progress` to `verify` is the only check. Dangerous operations (e.g., "Delete Production DB") require explicit *pre-execution* approval.
**Solution:** Accurate "Human-in-the-Loop" primitives using standard `bd` mechanics.
- **Gateway Beads:** A specific bead assigned to the *User* (not an Agent).
- **Blocking Mechanism:** Critical tasks depend on this Gateway Bead (`bd dep add`).
- **Approval:** The System simply waits. The User runs `bd close <gateway_id>` to grant approval. The standard dependency graph handles the unblocking.

## 4. The Archives (Shared Memory)
**Problem:** Workers are amnesiac. They solve the same error twice if it occurs in different sessions.
**Solution:** A semantic Knowledge Base for the swarm.
- **Ingestion:** Automatically index `docs/*.md`, successful `verify` resolutions, and project context.
- **Retrieval:** Give Workers a `consult_archives` tool to find relevant snippets before starting a task.
- **Tech:** Simple local vector store (e.g., `sqlite-vss` or just embeddings stored in beads).

## 5. Expeditionary Forces (Sandboxed/Remote Workers)
**Problem:** Workers currently run directly on the host shell (`execAsync`). This is high risk for complex coding agents.
**Solution:** Decouple the execution environment.
- **Docker Sandbox:** Workers interact with a disposable container environment.
- **Remote Legion:** Dispatch tasks to remote machines via SSH or API, allowing The Citadel to orchestrate a distributed cluster.
