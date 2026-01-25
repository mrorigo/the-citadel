# Building The Citadel: A 48-Hour Journey from "Gas Town" to a Knowledge Factory

**January 25, 2026**

Two days ago, this project didn't exist. It was just a response to a provocation: Steve Yegge's "Gas Town" manifesto. He painted a picture of a "Mad Max" future where agents ran wild, burning tokens and acting unpredictably. He called for order.

We built it.

This is the story of how **The Citadel** evolved from a rough concept into a deterministic, auditable Knowledge Factory in just 48 hours.

## Day 1: The Foundation (January 24)

### Morning: Order from Chaos
The first commit landed on January 24th. The mission was clear: replace "vibes" with invariants. We started by rejecting the idea of chat-based agents. We needed a ledger.
We integrated **Beads** immediately. Instead of ephemeral context windows, every task became a persistent, git-backed artifact. We built the core state machine: `Open -> In Progress -> Verify -> Done`. No hallucinations, just state transitions.

### Afternoon: The Foundry Arrives
By midday, simple task checklists weren't enough. We recognized that real work follows patterns—Standard Operating Procedures (SOPs). We implemented **The Foundry**, a workflow engine that compiles static TOML `Formulas` into dynamic execution graphs (`Molecules`). This was the turning point: we stopped prompting agents and started *programming* them.

### Evening: Project Awareness
Agents are useless if they don't know the rules. We added `AGENTS.md` support, allowing the system to recursively "learn" project-specific guidelines (style guides, testing rules) just by entering a directory. The system was becoming self-aware of its environment.

## Day 2: The Factory Floor (January 25)

### Morning: The Bridge
A factory needs a control room. We built **The Bridge**, an Ink-based TUI (Terminal User Interface). Watching the agents work in real-time, claiming tasks and updating the ledger, was the first "it's alive" moment. We also refactored the agent loops into a unified `CoreAgent` architecture, enforcing strict typing and removing the last remnants of "sloppy" code.

### Midday: Resilience & Dynamic Bonding
We faced a hard truth: plans fail. We implemented **Resilient Recovery** (`on_failure`), allowing the graph to self-heal by rolling back to previous steps when meaningful work failed.
Then came **Dynamic Bonding**. We gave workers the power to "subdivide" work recursively. A single "refactor" task could now explode into five parallel sub-tasks, all strictly tracked.

### Afternoon: The Connection (MCP)
Agents shouldn't just talk; they should *do*. We integrated the **Model Context Protocol (MCP)**, giving agents direct, standardized access to the filesystem and external APIs. This moved us from "simulated work" to actual file manipulation and data processing.

### Evening: The Pivot
As the pieces clicked into place, we realized we hadn't just built a coding tool. We had built a generic engine for **Knowledge Work**. We reframed the documentation, adding examples for Research, Content Operations, and Business Analysis. The internal logic held up perfectly—whether compiling code or compiling a market report, the process is the same.

## Where We Stand

In 48 hours, we went from zero to a fully functional, event-driven, graph-based orchestration engine.
-   **30+** Commits
-   **5** Major Architectural Phases
-   **1** Unified Vision: **Determinism > Probability**.

The Citadel is no longer just a reaction to Gas Town. It is a functioning operational model. The chaos has been tamed. The Factory is open.

*"Do not become addicted to context."*
