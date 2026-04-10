# Proposal: Supporting Task-Oriented Directory Trees in The Citadel

## Overview

The "Task-Oriented Directory Trees" methodology advocates for using `git worktrees` to aggregate multiple repositories under a single parent directory tied to a specific task (and git branch). This parent directory serves as a shared context for AI agents, housing orchestration files like `AGENTS.md` and `PLAN.md`, allowing an agent to safely execute cross-repository tasks with a holistic view.

This proposal outlines three distinct angles for integrating and supporting this methodology within **The Citadel**, a Deterministic Agent Orchestration System. The angles range from lightweight conventions to deep, highly-opinionated integrations.

---

## Angle 1: Lightweight Conventions & CLI Scaffolding (Shallow Depth)

**Concept:** The Citadel engine itself remains unchanged. Instead, we introduce specific CLI utilities and templates to formalize the creation of these workspaces, reducing the boilerplate of setting them up.

**Mechanics:**
- Introduce a new command: `citadel workspace init <task-name> [repo-urls/paths...]`
- This command:
  1. Creates the parent workspace directory `~/projects/worktrees/<task-name>`.
  2. Creates git worktrees for each specified repository inside the parent directory, all pointing to a new branch for the task.
  3. Scaffolds a default `AGENTS.md` and a stub `PLAN.md` (or initializes a Citadel `.citadel/` context) in the workspace root.
  4. Automatically copies required environment files (e.g., `.envrc`).

**Pros:**
- Extremely low risk to The Citadel's core engine.
- Users can easily opt-in or opt-out without being constrained.
- Leverages existing tools and shell workflows seamlessly.

**Cons:**
- Relies heavily on the developer to invoke the command correctly.
- The Citadel is unaware of the multi-repo nature of the workspace; it just sees a directory.

---

## Angle 2: First-Class Context Aggregation (Medium Depth)

**Concept:** The Citadel explicitly understands the "Composite Workspace" structure. When running within a task-oriented worktree parent, The Citadel's engine automatically aggregates contexts and handles cross-repo awareness.

**Mechanics:**
- **Context Synthesis:** When a worker is spawned in the parent directory, it automatically scans for nested `.git` repositories (or `.git` files signaling worktrees). It aggregates the `AGENTS.md` from both the parent and the underlying child repositories to formulate the system prompt.
- **Pearl Linking:** A Citadel Pearl (task representation) is explicitly linked to the workspace. The Pearl metadata tracks which sub-repositories are active for the task.
- **Cross-Repo Sandboxing:** Using the existing YAML frontmatter constraints for `AGENTS.md`, the Conductor automatically sets up `read_only` or `forbidden` rules to prevent the agent from accidentally modifying files outside the active worktrees in the parent directory.
- **Automated Commit Tracking:** Implement a built-in Hook/Molecule step that, upon Pearl resolution, commits work across all child repositories on the unified branch, preparing them for Merge Requests.

**Pros:**
- Makes the Agent's context much richer and more structured automatically.
- Aligns perfectly with Citadel's goal to be a deterministic Knowledge Factory.
- Enforces consistency in how agents perceive the worktree limits.

**Cons:**
- Requires modification to the core agent context preparation logic.
- Implies The Citadel now needs a concept of a "sub-project" or "workspace root".

---

## Angle 3: Fluid Meta-SCM Orchestration (Deep Opinionation)

**Concept:** The Citadel fully abstracts the worktree pattern. The developer never runs `git worktree add`. Instead, the act of assigning a Pearl to an Agent dynamically spawns the required worktree sandbox on the fly.

**Mechanics:**
- **Dynamic Task Sandboxes:** When a Pearl enters the `In Progress` state and requires cross-repo context, the Citadel Conductor automatically provisions a volatile worktree sandbox exclusively for that execution.
- **Dependency Resolution:** The Pearl contains knowledge of its required contexts (e.g., "Requires repo: app, infra"). The engine fetches or configures worktrees for these repositories on a task-specific branch.
- **Intercepted Tooling:** The agent's filesystem and git tools are explicitly "chrooted" or bound to this dynamic workspace. The agent does not know it's in a worktree; it just sees a filesystem.
- **Lifecycle Management:** Once the agent completes the work and the Pearl hits the `Verify` stage, the Citadel orchestrates cross-repo tests. Upon transitioning to `Done`, Citadel automatically generates the Merge Requests for all involved repositories and optionally tears down the worktree directory to reclaim disk space.

**Pros:**
- Truly hands-off, agentic orchestration. The human acts purely as an approver.
- Maximizes safety: Agents are completely isolated per-task.
- Perfect encapsulation of the task state within The Citadel's domain.

**Cons:**
- Extremely opinionated; completely overrides standard developer git workflows.
- Significant complexity in the Citadel core to manage dynamic git worktrees reliably, especially if executions fail or crash.
- Highly dependent on robust cleanup mechanisms to avoid orphaned worktrees filling up disk space.
