# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Setup Commands

Run these to get started:
- `bun install`

## Test Commands

Run these to verify correctness:
- `bun test tests/`

## Lint Commands

Run these to verify checks:
- `bunx biome lint .`

## Build Commands

Run these to verify types:
- `bun run tsc --noEmit`

## Development Rules

### Critical Rules
- **STRICT TYPING**: 
    - NEVER use `any`
    - NEVER use `// biome-ignore` to hide type errors
    - Always define proper interfaces
    - If you are stuck on a type error, FIX IT by understanding the type data, do not bypass it.
- **FAILURE HANDLING**:
    - Gatekeepers: Use `fail_work` for terminal failures that require recovery steps.
    - Workers: Respect the `recovery` label on beads.
- **MCP TOOLS**: Agents have access to external tools from MCP servers. Use them similarly to native tools.
- Work is NOT complete until all checks pass.

### Agent-Specific Instructions

#### Gatekeeper (EvaluatorAgent)
- Use `approve_work` when acceptance criteria are met.
- Use `reject_work` for fixable issues (sends task back to in-progress).
- Use `fail_work` for **terminal failures**. This marks the task as `done` but applies a `failed` label, triggering any defined `on_failure` recovery steps in the workflow.

### Quick Reference (Beads)

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

### Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session
