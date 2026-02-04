# Formula Reference Manual

Formulas are the blueprints for **Molecules** (workflow graphs) in The Citadel. They are written in **TOML**.

Formulas allow you to define repeatable processes, from simple sequences to dynamic graphs with loops and conditional logic.

## 1. Basic Structure

A formula file must live in `.citadel/formulas/` and end in `.toml`.

```toml
formula = "deploy_app"          # Unique identifier (used in CLI)
description = "Deploys the app" # Human readable description

# 1. Variables (Input Arguments)
[vars.env]
description = "Target environment (dev/prod)"
required = true
default = "dev"

# 2. Steps (Tasks)
[[steps]]
id = "build"
title = "Build Application"
description = "Run build script for {{env}}"

[[steps]]
id = "deploy"
title = "Deploy to {{env}}"
description = "Upload artifacts"
needs = ["build"]  # Dependency: 'deploy' waits for 'build'
```

## 2. Variables & Templating

Variables defined in `[vars]` can be injected into any string field using `{{var_name}}` syntax.

- **Definition**:
  ```toml
  [vars.region]
  default = "us-east-1"
  ```
- **Usage**:
  ```toml
  title = "Deploy to {{region}}"
  ```

## 3. Smart Features

Smart Molecules support dynamic logic that evaluates at **Creation Time**.

### Conditionals (`if`)

Skip a step unless a condition is met.

Supported operators: `==`, `!=`. Items are treated as strings.

```toml
[[steps]]
id = "safety_check"
title = "Production Safety Check"
if = "{{env}} == 'prod'"   # Only creates this bead if env is 'prod'
```

### Loops (`for`)

Generate multiple beads from a single step definition by iterating over a list.

- **`items`**: Variable containing the list (CSV string or JSON array).
- **`as`**: Variable name for the current item in the loop context.

```toml
# Input var: services="auth, payment, email"

[[steps]]
id = "deploy_svc"
title = "Deploy Service: {{svc}}"
for = { items = "{{services}}", as = "svc" }
```

**Result**: Creates 3 beads: "Deploy Service: auth", "Deploy Service: payment", etc.

### Failure Handlers (`on_failure`)

Define a recovery step that should run if the main step fails.

```toml
[[steps]]
id = "main_task"
title = "Migrate Database"
on_failure = "rollback_db"

[[steps]]
id = "rollback_db"
title = "Rollback Database"
description = "Run if migration fails"
```

**Resilience Logic**:
- The **Conductor** monitors recovery steps (beads with the `recovery` label).
- If the main step finishes successfully (status `done`), the recovery step is **skipped** automatically.
- If the main step finishes with a terminal failure (Gatekeeper uses `fail_work` to add the `failed` label), the recovery step is **executed**.
- Recovery steps are tagged with `recovers:<main_bead_id>` for traceability.

## 4. Dynamic Data Piping

Pass structured data between steps to create intelligent, chained workflows.

### Output Schema (`output_schema`)
Define the expected JSON structure of a step's output. Workers use this to validate their work.

```toml
[[steps]]
id = "analyze"
title = "Analyze Sentiment"
  [steps.output_schema]
  type = "object"
  properties = { sentiment = { type = "string" }, score = { type = "number" } }
  required = ["sentiment", "score"]
```

### Complex Schema Example
You can model complex nested structures, arrays, and enums.

```toml
[[steps]]
id = "analyze_repo"
title = "Analyze Repository"

  [steps.output_schema]
  type = "object"
  required = ["summary", "issues"]

  # Nested Object
  [steps.output_schema.properties.summary]
  type = "object"
  required = ["risk_score", "language"]
  properties = { risk_score = { type = "number" }, language = { type = "string" } }

  # Array of Objects
  [steps.output_schema.properties.issues]
  type = "array"
  items = { type = "object", required = ["file", "severity"], properties = { file = { type = "string" }, severity = { type = "string", enum = ["low", "medium", "critical"] } } }
```

### Context Injection (`context`)
Pass strict inputs to a step. This context is available to the Worker Agent.

```toml
[[steps]]
id = "report"
title = "Write Report"
context = { topic = "AI Trends", depth = "deep" }
```

### Piping (`{{steps...}}`)
Reference outputs from previous steps in the `context` of downstream steps.

```toml
[[steps]]
id = "decision"
title = "Make Decision"
needs = ["analyze"] # Must rely on the source step
context = { score = "{{steps.analyze.output.score}}" }
```

## 5. Formula Prompts (`prompts`)

You can inject specialized instructions directly into the agents involved in a specific workflow. This is useful for providing guardrails or SOPs that only apply to this formula.

```toml
formula = "system_migration"
description = "Migrates auth system"

[prompts]
worker = "You MUST use 'git' for every change. Do NOT use the filesystem directly for final state."
router = "Ensure all tasks are routed to the 'high-priority' queue."

[[steps]]
id = "migrate"
title = "Run Migration"
# ...
```

When an agent processes a bead belonging to this formula, the `InstructionService` automatically fetches and appends these prompts to the system message.

## 6. Dependencies

Use the `needs` array to define the Directed Acyclic Graph (DAG).

```toml
needs = ["step_id_1", "step_id_2"]
```

- If `step_id_1` was a **Loop**, the current step will depend on **ALL** iterations of that loop (fan-in).
- If `step_id_1` was **Skipped** (due to `if`), the dependency is ignored.

## 7. Usage

Create a new Molecule from a formula:

```bash
citadel create "My Deployment" --formula deploy_app --vars env=prod
```

## 8. Practical Examples

### Example A: Monorepo Deployment (Loops)
Deploy multiple microservices in parallel, then run integration tests.

```toml
formula = "deploy_monorepo"
description = "Deploy specified services and test"

[vars.services]
description = "Comma-separated list of services (e.g. 'auth,payment,ui')"
required = true

[[steps]]
id = "deploy"
title = "Deploy {{service}}"
for = { items = "{{services}}", as = "service" }

[[steps]]
id = "integration_test"
title = "Run Integration Tests"
needs = ["deploy"] # Waits for ALL services to deploy
```

### Example B: Feature Flag Rollout (Conditionals)
Perform a rollout only if the environment is production.

```toml
formula = "feature_rollout"
description = "Toggle feature flag"

[vars.env]
default = "dev"
[vars.flag]
required = true

[[steps]]
id = "enable_flag"
title = "Enable {{flag}} in {{env}}"

[[steps]]
id = "verify_metrics"
title = "Verify Health Metrics"
if = "{{env}} == 'prod'" # Only strictly verify in prod
needs = ["enable_flag"]

[[steps]]
id = "notify_team"
title = "Slack Notification"
if = "{{env}} == 'prod'"
needs = ["verify_metrics"]
```

### Example C: Risky Database Migration (Failure Handling)
If migration fails, automatically trigger a rollback task.

```toml
formula = "db_migration"
description = "Apply schema changes with safety net"

[[steps]]
id = "snapshot"
title = "Take DB Snapshot"

[[steps]]
id = "migrate"
title = "Run Migration Script"
needs = ["snapshot"]
on_failure = "rollback"

[[steps]]
id = "rollback"
title = "Restore from Snapshot"
description = "EMERGENCY: Restoring DB state"
# Implicitly depends on 'migrate' due to on_failure wiring
```

