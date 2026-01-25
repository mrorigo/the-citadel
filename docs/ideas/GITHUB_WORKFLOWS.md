# Citadel x GitHub Workflows: Integration Patterns

Merging **The Citadel** (deterministic agent orchestration) with **GitHub Workflows** (CI/CD) creates a powerful self-correcting or autonomous software factory.

## Pattern 1: The "Auto-Fix" Loop (Reactive)
Trigger Citadel agents when a standard CI job fails.

**Workflow:**
1.  Standard CI runs (`npm test`).
2.  **Failure**: The job fails.
3.  **Action**: GitHub Workflow triggers a Citadel Formula (`fix_test_failure`).
4.  **Citadel**:
    -   Agent analyzes logs.
    -   Agent edits code.
    -   Agent pushes specific fix commit.
5.  **Loop**: CI runs again to verify.

```yaml
# .github/workflows/test.yml
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm test
      - name: Summon Citadel on Failure
        if: failure()
        run: |
           bun install -g @citadel/cli
           citadel create "Fix CI Failure" --formula fix_broken_test --vars run_id=${{ github.run_id }}
```

## Pattern 2: Issue-Driven Development (Event-Driven)
Use GitHub Issues as the primary interface for triggering complex agent workflows.

**Workflow:**
1.  Human creates Issue: "Add Dark Mode to Landing Page".
2.  Human applies label: `citadel:feature`.
3.  **GitHub Action** detects label.
4.  **Action**: Triggers Citadel Formula (`feature_implementation`).
    -   Passes Issue Body as variables.
5.  **Citadel**:
    -   Router plans the work.
    -   Workers implement.
    -   Workers open PR with "Closes #123".

## Pattern 3: The "Nightly Watchman" (Scheduled)
Run proactive agentic workflows on a schedule.

**Use Cases:**
-   **Dependency Audits**: "Check all deps, summarize valid upgrades, create PR."
-   **Security Patrol**: "Scan recent commits for secret leaks or bad patterns."
-   **Performance Optimization**: "Analyze bundle size trends and recommend cuts."

```yaml
on:
  schedule:
    - cron: '0 2 * * *' # 2am daily
jobs:
  nightly_patrol:
    steps:
      - run: citadel create "Nightly Security Scan" --formula security_audit
```

## Pattern 4: The "Reviewer Bot" (PR Automation)
Agents act as a first-pass reviewer before humans look at the code.

**Workflow:**
1.  PR Opened.
2.  **Citadel Triggered**: `code_review` formula.
3.  **Agents**:
    -   Read diff.
    -   Check against `AGENTS.md` rules (style, patterns).
    -   Post comments on PR with suggestions.
    -   **Bonus**: Can push simple fixes (typos, formatting) directly.

## Implementation Requirements

To make this seamless, we need:
1.  **Citadel Action**: A dedicated `mrorigo/citadel-action` to handle setup and auth.
2.  **State Persistence**: Since GitHub Runners are ephemeral, `.beads` (SQLite) state needs to be:
    -   Committed back to the repo (e.g., in a special branch).
    -   OR Uploaded as a Workflow Artifact.
    -   OR Stored in an external S3/Database (if using remote backend).
