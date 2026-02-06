# Feature Proposal: Dynamic Prompt Injection via Formulas

**Status**: Draft
**Target**: The Citadel Core (`the-citadel`)

## 💡 The Problem
Currently, the `WorkerAgent` and `RouterAgent` system prompts are relativey static, defined in `src/agents/*.ts`. While we have `AGENTS.md` for project-level rules, we lack a way to inject task-specific instructions based on the **Workflow (Formula)** being executed.

For example, when running an `autonomous_epic` formula, we want the Worker to know it **must** create a git branch. Hardcoding this into the core `WorkerAgent.ts` makes the engine too specific to one workflow.

## 🚀 Proposed Solution: Formula-Level Prompts

Allow Formulas to define `system_prompts` that are injected into the agent context only when that formula is active.

### TOML Schema Addition
```toml
# .citadel/formulas/autonomous_epic.toml
formula = "autonomous_epic"

[prompts]
worker = """
# Git & Branch Isolation
- You MUST check out a dedicated branch (e.g., `git checkout -b epic/feature-name`) before making any changes.
- Pushing to remote is required for task completion.
"""
```

### Implementation Logic
1.  **Conductor/Router**: When instantiating a Formula into a Molecule, the `prompts` section should be stored in the root Epic or propagated as a label/context.
2.  **CoreAgent**: In the `run()` loop, the agent should check if the current Bead belongs to a Molecule with custom prompts.
3.  **Prompt Merging**: These custom prompts should be appended to the `defaultPrompt` after the `AGENTS.md` rules but before the agent-specific guidelines.

## ✅ Benefits
- **Zero Core Bloat**: Keeps the Citadel engine generic and reusable across non-coding domains (Research, Content, etc.).
- **Stronger Enforcement**: Specific workflows can mandate specific tool usage (e.g., a "Secure Fix" formula can mandate using a security scanner tool).
- **Flexibility**: Users can experiment with different agent personae or sets of "Golden Rules" per workflow without changing code.
