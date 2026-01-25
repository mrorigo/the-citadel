This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.
The content has been processed where security check has been disabled.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  - File path as an attribute
  - Full contents of the file
</file_format>

<usage_guidelines>
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.
</usage_guidelines>

<notes>
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: wiki
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Security check has been disabled - content may contain sensitive information
- Files are sorted by Git change count (files with more changes are at the bottom)
</notes>

</file_summary>

<directory_structure>
wiki/
  _Sidebar.md
  CLI-Reference.md
  Configuration.md
  Getting-Started.md
  Home.md
  Language-Support.md
  MCP-Setup.md
  MCP-Tools-Reference.md
  Pattern-Categories.md
  Troubleshooting.md
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="wiki/_Sidebar.md">
## Getting Started
- [Home](Home)
- [Getting Started](Getting-Started)
- [MCP Setup](MCP-Setup)

## Reference
- [CLI Reference](CLI-Reference)
- [MCP Tools Reference](MCP-Tools-Reference)
- [Pattern Categories](Pattern-Categories)

## Guides
- [Language Support](Language-Support)
- [Configuration](Configuration)
- [Troubleshooting](Troubleshooting)

## Links
- [GitHub](https://github.com/dadbodgeoff/drift)
- [npm](https://www.npmjs.com/package/driftdetect)
- [Issues](https://github.com/dadbodgeoff/drift/issues)
</file>

<file path="wiki/CLI-Reference.md">
# CLI Reference

Complete reference for all 28 Drift CLI commands.

## Core Commands

### `drift init`

Initialize Drift in a project.

```bash
drift init [options]

Options:
  --from-scaffold    Initialize from scaffold config
  --yes, -y          Skip confirmation prompts
```

### `drift scan`

Scan codebase for patterns.

```bash
drift scan [path] [options]

Options:
  --manifest         Generate manifest file
  --incremental      Only scan changed files
  --contracts        Detect API contracts
  --boundaries       Scan data access boundaries
  --project <name>   Target specific project
  --timeout <ms>     Scan timeout in milliseconds
```

### `drift check`

Check for violations against approved patterns.

```bash
drift check [options]

Options:
  --staged           Only check staged files
  --ci               CI mode (exit code on violations)
  --format <type>    Output format: text, json, github, gitlab
  --fail-on <level>  Fail on: error, warning, info
```

### `drift status`

Show current drift status.

```bash
drift status [options]

Options:
  --detailed         Show detailed breakdown
  --format <type>    Output format: text, json
```

### `drift approve`

Approve discovered patterns.

```bash
drift approve <pattern-id> [options]

Options:
  --category <cat>   Approve all in category
  --yes, -y          Skip confirmation
```

### `drift ignore`

Ignore patterns.

```bash
drift ignore <pattern-id> [options]

Options:
  --yes, -y          Skip confirmation
```

### `drift report`

Generate reports.

```bash
drift report [options]

Options:
  --format <type>    Format: html, json, markdown
  --output <path>    Output file path
  --categories       Filter by categories
```

---

## Discovery Commands

### `drift where`

Find pattern locations.

```bash
drift where <pattern-id> [options]

Options:
  --category <cat>   Filter by category
  --status <status>  Filter by status
  --json             JSON output
```

### `drift files`

Show patterns in specific files.

```bash
drift files <path> [options]

Options:
  --category <cat>   Filter by category
  --json             JSON output
```

### `drift export`

Export manifest.

```bash
drift export [options]

Options:
  --format <type>    Format: json, ai-context, summary, markdown
  --max-tokens <n>   Token limit for ai-context format
  --snippets         Include code snippets
```

---

## Monitoring Commands

### `drift watch`

Real-time file watching.

```bash
drift watch [options]

Options:
  --context          Show context for changes
  --debounce <ms>    Debounce delay
  --persist          Persist changes to disk
```

### `drift dashboard`

Launch web dashboard.

```bash
drift dashboard [options]

Options:
  --port <port>      Server port (default: 3000)
  --no-browser       Don't open browser
```

### `drift trends`

View pattern trends over time.

```bash
drift trends [options]

Options:
  --period <period>  Time period: 7d, 30d, 90d
  --verbose          Show detailed changes
```

---

## Analysis Commands

### `drift boundaries`

Data access boundary analysis.

```bash
drift boundaries <subcommand>

Subcommands:
  overview           Show boundary overview
  tables             List tables and access patterns
  file <path>        Show boundaries for a file
  sensitive          List sensitive data access
  check              Check boundary violations
  init-rules         Initialize boundary rules
```

### `drift callgraph`

Call graph analysis.

```bash
drift callgraph <subcommand>

Subcommands:
  build              Build call graph
  status             Show call graph status
  reach <location>   What data can this code reach?
  inverse <target>   Who can access this data?
  function <name>    Show function details
```

### `drift test-topology`

Test coverage analysis.

```bash
drift test-topology <subcommand>

Subcommands:
  build              Build test topology
  status             Show test coverage status
  uncovered          Find uncovered code
  mocks              Analyze mock usage
  affected <files>   Minimum tests for changed files
```

### `drift coupling`

Module coupling analysis.

```bash
drift coupling <subcommand>

Subcommands:
  build              Build coupling graph
  status             Show coupling metrics
  cycles             Find dependency cycles
  hotspots           High-coupling modules
  analyze <module>   Analyze specific module
  refactor-impact    Impact of refactoring
  unused-exports     Find dead exports
```

### `drift error-handling`

Error handling analysis.

```bash
drift error-handling <subcommand>

Subcommands:
  build              Build error handling map
  status             Show error handling status
  gaps               Find error handling gaps
  boundaries         Show error boundaries
  unhandled          Find unhandled errors
  analyze <func>     Analyze specific function
```

### `drift wrappers`

Framework wrapper detection.

```bash
drift wrappers [options]

Options:
  --min-confidence <n>   Minimum confidence (0-1)
  --category <cat>       Filter by category
  --include-tests        Include test files
```

### `drift constants`

Analyze constants, enums, and exported values.

```bash
drift constants [subcommand] [options]

Subcommands:
  (default)          Show constants overview
  list               List all constants
  get <name>         Show constant details
  secrets            Show potential hardcoded secrets
  inconsistent       Show constants with inconsistent values
  dead               Show potentially unused constants
  export <output>    Export constants to file

Options:
  --format <type>    Output format: text, json, csv
  --category <cat>   Filter by category
  --language <lang>  Filter by language
  --file <path>      Filter by file path
  --search <query>   Search by name
  --exported         Show only exported constants
  --severity <level> Min severity for secrets
  --limit <n>        Limit results
```

**Examples:**

```bash
# Show overview
drift constants

# List API constants
drift constants list --category api

# Find hardcoded secrets
drift constants secrets --severity high

# Export to JSON
drift constants export constants.json
```

### `drift dna`

Styling DNA analysis.

```bash
drift dna <subcommand>

Subcommands:
  scan               Scan for styling patterns
  status             Show DNA profile
  gene <name>        Show specific gene
  mutations          Find style inconsistencies
  playbook           Generate style playbook
  export             Export DNA profile
```

---

## Management Commands

### `drift projects`

Manage multiple projects.

```bash
drift projects <subcommand>

Subcommands:
  list               List registered projects
  switch <name>      Switch active project
  add <path>         Register a project
  remove <name>      Unregister a project
  info <name>        Show project details
  cleanup            Remove stale projects
```

### `drift skills`

Manage Agent Skills.

```bash
drift skills <subcommand>

Subcommands:
  list               List available skills
  install <name>     Install a skill
  info <name>        Show skill details
  search <query>     Search for skills
```

### `drift parser`

Show parser status.

```bash
drift parser [options]

Options:
  --test             Test parser functionality
  --format <type>    Output format
```

### `drift migrate-storage`

Migrate to unified storage format.

```bash
drift migrate-storage [options]

Options:
  --status           Show migration status only
```

---

## Global Options

These options work with all commands:

```bash
--help, -h         Show help
--version, -v      Show version
--verbose          Verbose output
--quiet, -q        Suppress output
--no-color         Disable colors
```
</file>

<file path="wiki/Configuration.md">
# Configuration

Customize Drift for your project.

## Configuration File

Drift stores configuration in `.drift/config.json`:

```json
{
  "version": "1.0",
  "project": {
    "name": "my-project",
    "language": "typescript"
  },
  "scan": {
    "include": ["src/**/*"],
    "exclude": ["**/*.test.ts", "**/__tests__/**"],
    "timeout": 300000
  },
  "patterns": {
    "minConfidence": 0.7,
    "autoApprove": false
  },
  "callgraph": {
    "maxDepth": 10,
    "includeTests": false
  }
}
```

---

## Configuration Options

### Project Settings

| Option             | Type   | Default     | Description        |
| ------------------ | ------ | ----------- | ------------------ |
| `project.name`     | string | folder name | Project identifier |
| `project.language` | string | auto-detect | Primary language   |

### Scan Settings

| Option             | Type    | Default    | Description                 |
| ------------------ | ------- | ---------- | --------------------------- |
| `scan.include`     | array   | `["**/*"]` | Glob patterns to include    |
| `scan.exclude`     | array   | `[]`       | Glob patterns to exclude    |
| `scan.timeout`     | number  | `300000`   | Scan timeout in ms          |
| `scan.incremental` | boolean | `true`     | Enable incremental scanning |
| `scan.parallel`    | number  | CPU cores  | Parallel workers            |

### Pattern Settings

| Option                   | Type    | Default | Description                           |
| ------------------------ | ------- | ------- | ------------------------------------- |
| `patterns.minConfidence` | number  | `0.5`   | Minimum confidence to report          |
| `patterns.autoApprove`   | boolean | `false` | Auto-approve high-confidence patterns |
| `patterns.categories`    | array   | all     | Categories to detect                  |

### Call Graph Settings

| Option                         | Type    | Default | Description          |
| ------------------------------ | ------- | ------- | -------------------- |
| `callgraph.maxDepth`           | number  | `10`    | Max traversal depth  |
| `callgraph.includeTests`       | boolean | `false` | Include test files   |
| `callgraph.includeNodeModules` | boolean | `false` | Include dependencies |

### Boundary Settings

| Option                       | Type    | Default  | Description                      |
| ---------------------------- | ------- | -------- | -------------------------------- |
| `boundaries.enabled`         | boolean | `true`   | Enable boundary scanning         |
| `boundaries.sensitiveFields` | array   | built-in | Additional sensitive field names |
| `boundaries.rules`           | object  | `{}`     | Custom boundary rules            |

---

## .driftignore

Exclude files from scanning (same syntax as `.gitignore`):

```gitignore
# Dependencies
node_modules/
vendor/
.venv/

# Build output
dist/
build/
out/

# Test files (optional)
*.test.ts
*.spec.ts
__tests__/

# Generated files
*.generated.ts
*.d.ts

# IDE
.idea/
.vscode/

# Git
.git/
```

---

## Environment Variables

| Variable          | Description                         |
| ----------------- | ----------------------------------- |
| `DRIFT_CONFIG`    | Path to config file                 |
| `DRIFT_CACHE_DIR` | Cache directory                     |
| `DRIFT_LOG_LEVEL` | Log level: debug, info, warn, error |
| `DRIFT_NO_COLOR`  | Disable colored output              |
| `DRIFT_PARALLEL`  | Number of parallel workers          |

---

## Per-Project Configuration

### Multiple Projects

Register multiple projects:

```bash
drift projects add ~/code/backend --name backend
drift projects add ~/code/frontend --name frontend
```

Each project has its own `.drift/` directory and configuration.

### Switching Projects

```bash
drift projects switch backend
drift status  # Shows backend status
```

---

## CI Configuration

### GitHub Actions

```yaml
- name: Drift Check
  run: |
    npm install -g driftdetect
    drift init --yes
    drift scan
    drift check --ci --fail-on warning --format github
```

### GitLab CI

```yaml
drift:
  script:
    - npm install -g driftdetect
    - drift init --yes
    - drift scan
    - drift check --ci --fail-on warning --format gitlab
```

### Pre-commit Hook

```bash
# .husky/pre-commit
drift check --staged --fail-on error
```

---

## MCP Server Configuration

### Rate Limiting

```json
{
  "mcp": {
    "rateLimit": {
      "global": 100,
      "expensive": 10
    }
  }
}
```

### Caching

```json
{
  "mcp": {
    "cache": {
      "enabled": true,
      "ttl": 300000,
      "maxSize": 100
    }
  }
}
```

---

## Sensitive Data Configuration

### Custom Sensitive Fields

```json
{
  "boundaries": {
    "sensitiveFields": [
      "ssn",
      "social_security",
      "tax_id",
      "bank_account"
    ]
  }
}
```

### Sensitivity Categories

```json
{
  "boundaries": {
    "categories": {
      "pii": ["email", "phone", "address"],
      "financial": ["credit_card", "bank_account"],
      "health": ["diagnosis", "prescription"],
      "credentials": ["password", "api_key", "token"]
    }
  }
}
```

---

## Resetting Configuration

```bash
# Reset to defaults
rm -rf .drift
drift init

# Keep patterns, reset config
rm .drift/config.json
drift init --keep-patterns
```
</file>

<file path="wiki/Getting-Started.md">
# Getting Started

Get Drift running in under 2 minutes.

## Installation

```bash
npm install -g driftdetect
```

Or use npx without installing:

```bash
npx driftdetect init
```

## Quick Start

```bash
# Navigate to your project
cd your-project

# Initialize Drift (creates .drift/ directory)
drift init

# Scan your codebase
drift scan

# See what Drift learned
drift status
```

## What Happens During Scan

1. **File Discovery** — Drift finds all source files (respects `.driftignore`)
2. **Pattern Detection** — 150+ detectors analyze your code
3. **Call Graph Building** — Maps function calls and data access
4. **Pattern Storage** — Results saved to `.drift/` directory

## First Scan Output

After scanning, `drift status` shows:

```
Drift Status
============

Patterns: 47 discovered, 0 approved, 0 ignored
Categories: api (12), auth (8), errors (15), data-access (12)
Health Score: 72/100

Run 'drift approve <pattern-id>' to approve patterns
Run 'drift dashboard' to explore in the web UI
```

## Next Steps

1. **Explore patterns**: `drift dashboard` opens a web UI
2. **Approve patterns**: `drift approve <id>` marks patterns as canonical
3. **Connect to AI**: See [MCP Setup](MCP-Setup) to connect to Claude/Cursor
4. **CI integration**: `drift check --ci` fails on violations

## Project Structure

After initialization, Drift creates:

```
your-project/
├── .drift/
│   ├── config.json      # Project configuration
│   ├── patterns/        # Detected patterns by category
│   ├── callgraph/       # Call graph data
│   ├── boundaries/      # Data access boundaries
│   └── views/           # Pre-computed views
└── .driftignore         # Files to exclude from scanning
```

## Ignoring Files

Edit `.driftignore` (same syntax as `.gitignore`):

```
node_modules/
dist/
build/
*.test.ts
*.spec.ts
__tests__/
```

## Troubleshooting First Scan

**Scan takes too long?**
- Check `.driftignore` excludes `node_modules/`, `dist/`
- Try scanning a subdirectory: `drift scan src/`
- Use timeout: `drift scan --timeout 600`

**No patterns found?**
- Ensure you're scanning source files, not just config
- Check language is supported (TS, Python, Java, C#, PHP)
- Run `drift parser --test` to verify parsers work

**Permission errors?**
- Drift needs write access to create `.drift/` directory
- Run in a directory you own
</file>

<file path="wiki/Home.md">
# Drift Documentation

Welcome to the Drift wiki! Drift is the most comprehensive MCP server for codebase intelligence — 27 CLI commands, 23 MCP tools, 6 languages.

## Quick Links

- [Getting Started](Getting-Started) — Install and run your first scan
- [MCP Setup](MCP-Setup) — Connect Drift to Claude, Cursor, or other AI agents
- [CLI Reference](CLI-Reference) — All 27 commands documented
- [MCP Tools Reference](MCP-Tools-Reference) — All 23 MCP tools documented
- [Pattern Categories](Pattern-Categories) — The 14 pattern categories Drift detects
- [Language Support](Language-Support) — Supported languages and frameworks
- [Configuration](Configuration) — Customize Drift for your project
- [Troubleshooting](Troubleshooting) — Common issues and solutions

## What is Drift?

Drift scans your codebase, learns YOUR patterns, and gives AI agents deep understanding of your conventions. Instead of AI generating generic code, it generates code that fits your codebase.

### Key Features

| Feature                 | Description                                |
| ----------------------- | ------------------------------------------ |
| **Pattern Detection**   | Learns from your code, not hardcoded rules |
| **Call Graph Analysis** | "What data can this code access?"          |
| **Security Boundaries** | Track PII, credentials, financial data     |
| **Test Topology**       | Minimum test set for changes               |
| **Module Coupling**     | Dependency cycles and hotspots             |
| **Error Handling**      | Find gaps in error handling                |

### Supported Languages

- TypeScript/JavaScript (React, Next.js, Express, Prisma, TypeORM)
- Python (Django, FastAPI, Flask, SQLAlchemy)
- Java (Spring Boot, JPA/Hibernate)
- C# (ASP.NET Core, Entity Framework)
- PHP (Laravel, Eloquent)

## Getting Help

- [GitHub Issues](https://github.com/dadbodgeoff/drift/issues) — Report bugs
- [GitHub Discussions](https://github.com/dadbodgeoff/drift/discussions) — Ask questions
</file>

<file path="wiki/Language-Support.md">
# Language Support

Drift supports 6 programming languages with full feature parity.

## Supported Languages

| Language   | Tree-Sitter | Call Graph | Data Access | Regex Fallback |
| ---------- | ----------- | ---------- | ----------- | -------------- |
| TypeScript | ✅           | ✅          | ✅           | ✅              |
| JavaScript | ✅           | ✅          | ✅           | ✅              |
| Python     | ✅           | ✅          | ✅           | ✅              |
| Java       | ✅           | ✅          | ✅           | ✅              |
| C#         | ✅           | ✅          | ✅           | ✅              |
| PHP        | ✅           | ✅          | ✅           | ✅              |

---

## TypeScript / JavaScript

### Frameworks
- React
- Next.js
- Express
- Node.js
- NestJS

### ORMs & Data Access
- Prisma
- TypeORM
- Sequelize
- Drizzle
- Knex
- Mongoose
- Supabase

### File Extensions
`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`

### Features
- Full AST parsing via Tree-sitter
- Decorator extraction (`@Controller`, `@Injectable`, etc.)
- Import/export resolution
- React component detection
- Hook pattern detection
- Express middleware chains

---

## Python

### Frameworks
- Django
- FastAPI
- Flask

### ORMs & Data Access
- Django ORM
- SQLAlchemy
- Tortoise ORM

### File Extensions
`.py`

### Features
- Full AST parsing via Tree-sitter
- Decorator extraction (`@app.route`, `@login_required`)
- Class-based view detection
- Django model detection
- FastAPI dependency injection
- Type hint extraction

---

## Java

### Frameworks
- Spring Boot
- Spring MVC

### ORMs & Data Access
- JPA / Hibernate
- Spring Data

### File Extensions
`.java`

### Features
- Full AST parsing via Tree-sitter
- Annotation extraction (`@RestController`, `@Service`, `@Repository`)
- Spring bean detection
- JPA entity detection
- Dependency injection patterns
- Interface implementation tracking

---

## C#

### Frameworks
- ASP.NET Core
- ASP.NET MVC

### ORMs & Data Access
- Entity Framework Core
- Entity Framework
- Dapper

### File Extensions
`.cs`

### Features
- Full AST parsing via Tree-sitter
- Attribute extraction (`[ApiController]`, `[HttpGet]`, `[Authorize]`)
- Controller detection
- DbContext usage tracking
- Dependency injection patterns
- LINQ query detection

---

## PHP

### Frameworks
- Laravel

### ORMs & Data Access
- Eloquent

### File Extensions
`.php`

### Features
- Full AST parsing via Tree-sitter
- Attribute/annotation extraction
- Laravel controller detection
- Eloquent model detection
- Middleware detection
- Route detection

---

## How Parsing Works

### Tree-sitter (Primary)

Drift uses Tree-sitter for accurate AST parsing:

1. **Parse** — Source code → AST
2. **Extract** — Functions, classes, decorators, imports
3. **Resolve** — Call targets, data access points
4. **Build** — Call graph, pattern index

Tree-sitter provides:
- Fast incremental parsing
- Error recovery (partial parsing on syntax errors)
- Language-agnostic queries

### Regex Fallback

When Tree-sitter fails (rare), Drift falls back to regex extraction:

- Catches common patterns
- Lower accuracy but better than nothing
- Useful for edge cases

---

## Adding Language Support

Drift's architecture supports adding new languages:

1. **Tree-sitter grammar** — Install the grammar package
2. **Extractor** — Implement function/call extraction
3. **Data access detector** — Implement ORM pattern detection
4. **Test regex** — Add test file detection patterns

See `packages/core/src/call-graph/extractors/` for examples.

---

## Checking Parser Status

```bash
# Show parser status
drift parser

# Test parser functionality
drift parser --test
```

Output:
```
Parser Status
=============

TypeScript: ✅ Ready (tree-sitter-typescript)
JavaScript: ✅ Ready (tree-sitter-javascript)
Python:     ✅ Ready (tree-sitter-python)
Java:       ✅ Ready (tree-sitter-java)
C#:         ✅ Ready (tree-sitter-c-sharp)
PHP:        ✅ Ready (tree-sitter-php)
```

---

## Mixed-Language Projects

Drift handles polyglot codebases:

```bash
# Scan everything
drift scan

# Scan specific language
drift scan --include "**/*.py"
```

The call graph connects across languages when possible (e.g., TypeScript frontend calling Python API).
</file>

<file path="wiki/MCP-Setup.md">
# MCP Setup

Connect Drift to AI agents via Model Context Protocol (MCP).

## What is MCP?

MCP (Model Context Protocol) is a standard for connecting AI agents to external tools. Drift's MCP server gives AI agents like Claude, Cursor, and Windsurf deep understanding of your codebase.

## Quick Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["-y", "driftdetect-mcp"]
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["-y", "driftdetect-mcp"]
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["-y", "driftdetect-mcp"]
    }
  }
}
```

## Initialize Your Project

Before the MCP server can help, scan your project:

```bash
cd your-project
drift init
drift scan
```

## Verify Connection

Ask your AI agent:

> "What patterns does Drift see in this codebase?"

If connected, it will call `drift_status` and show your pattern summary.

## How It Works

1. AI agent receives your prompt
2. Agent calls Drift MCP tools to understand your codebase
3. Drift returns patterns, examples, and conventions
4. Agent generates code that matches YOUR style

## Example Conversation

**You**: "Add a new API endpoint for user preferences"

**AI (via Drift)**:
> Based on your codebase patterns:
> - Routes use `@Controller` decorator with `/api/v1` prefix
> - Error responses follow `{ error: string, code: number }` format
> - User endpoints require `@RequireAuth()` middleware
> - Similar endpoints: `src/controllers/user.controller.ts`
>
> Here's the implementation following your conventions...

## Available MCP Tools

Drift provides 23 MCP tools organized in layers:

| Layer         | Tools                                                                                                            | Purpose                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Orchestration | `drift_context`                                                                                                  | Intent-aware context (start here) |
| Discovery     | `drift_status`, `drift_capabilities`, `drift_projects`                                                           | Quick overview                    |
| Exploration   | `drift_patterns_list`, `drift_security_summary`, `drift_contracts_list`, `drift_trends`                          | Browse patterns                   |
| Detail        | `drift_pattern_get`, `drift_code_examples`, `drift_file_patterns`, `drift_impact_analysis`, `drift_reachability` | Deep dives                        |
| Analysis      | `drift_test_topology`, `drift_coupling`, `drift_error_handling`                                                  | Code health                       |
| Generation    | `drift_suggest_changes`, `drift_validate_change`, `drift_explain`                                                | AI assistance                     |

See [MCP Tools Reference](MCP-Tools-Reference) for full documentation.

## Multi-Project Support

Work across multiple codebases:

```bash
# Register projects
drift projects add ~/code/backend
drift projects add ~/code/frontend

# Switch active project
drift projects switch backend
```

The MCP server can query any registered project using the `project` parameter.

## Troubleshooting

**MCP server not connecting?**
- Restart your AI client after config changes
- Check the config file path is correct for your OS
- Verify `npx driftdetect-mcp` runs without errors

**"Scan required" errors?**
- Run `drift scan` in your project first
- The MCP server needs `.drift/` data to work

**Slow responses?**
- First call may be slow (loading data)
- Subsequent calls use caching
- Large codebases may need `drift scan --incremental`
</file>

<file path="wiki/MCP-Tools-Reference.md">
# MCP Tools Reference

Complete reference for all 24 Drift MCP tools.

## Tool Layers

Drift organizes tools in layers for efficient token usage:

1. **Orchestration** — Start here for most tasks
2. **Discovery** — Quick overview of codebase
3. **Exploration** — Browse patterns and security
4. **Detail** — Deep dives into specific patterns
5. **Analysis** — Code health metrics
6. **Generation** — AI-assisted changes

---

## Layer 1: Orchestration

### `drift_context`

**The recommended starting point.** Returns curated context based on your intent.

```json
{
  "intent": "add_feature",
  "focus": "user authentication",
  "question": "How do I add a new auth endpoint?",
  "project": "backend"
}
```

**Parameters:**
| Parameter  | Type   | Required | Description                                                                           |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------- |
| `intent`   | enum   | Yes      | `add_feature`, `fix_bug`, `refactor`, `security_audit`, `understand_code`, `add_test` |
| `focus`    | string | Yes      | Area or feature you're working with                                                   |
| `question` | string | No       | Specific question to answer                                                           |
| `project`  | string | No       | Target project name                                                                   |

**Returns:** Relevant patterns, examples, files to modify, warnings, and guidance.

---

## Layer 2: Discovery

### `drift_status`

Get codebase health snapshot. Always fast, always lightweight.

```json
{}
```

No parameters required.

**Returns:** Pattern counts, health score, critical issues.

### `drift_capabilities`

List all Drift capabilities.

```json
{}
```

**Returns:** Guide to available tools organized by purpose.

### `drift_projects`

Manage registered projects.

```json
{
  "action": "list",
  "project": "backend",
  "path": "/path/to/project"
}
```

**Parameters:**
| Parameter | Type   | Required | Description                                    |
| --------- | ------ | -------- | ---------------------------------------------- |
| `action`  | enum   | No       | `list`, `info`, `switch`, `recent`, `register` |
| `project` | string | No       | Project name (for info/switch)                 |
| `path`    | string | No       | Project path (for register)                    |

---

## Layer 3: Exploration

### `drift_patterns_list`

List patterns with summaries.

```json
{
  "categories": ["api", "auth"],
  "status": "approved",
  "minConfidence": 0.8,
  "search": "controller",
  "limit": 20
}
```

**Parameters:**
| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `categories`    | array  | No       | Filter by categories                       |
| `status`        | enum   | No       | `all`, `approved`, `discovered`, `ignored` |
| `minConfidence` | number | No       | Minimum confidence 0.0-1.0                 |
| `search`        | string | No       | Search pattern names                       |
| `limit`         | number | No       | Max results (default: 20)                  |
| `cursor`        | string | No       | Pagination cursor                          |

### `drift_security_summary`

Security posture overview.

```json
{
  "focus": "critical",
  "limit": 10
}
```

**Parameters:**
| Parameter | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| `focus`   | enum   | No       | `all`, `critical`, `data-access`, `auth` |
| `limit`   | number | No       | Max items per section                    |

### `drift_contracts_list`

API contracts between frontend and backend.

```json
{
  "status": "mismatch",
  "limit": 20
}
```

**Parameters:**
| Parameter | Type   | Required | Description                                 |
| --------- | ------ | -------- | ------------------------------------------- |
| `status`  | enum   | No       | `all`, `verified`, `mismatch`, `discovered` |
| `limit`   | number | No       | Max results                                 |
| `cursor`  | string | No       | Pagination cursor                           |

### `drift_trends`

Pattern trend analysis.

```json
{
  "period": "30d",
  "category": "security",
  "severity": "critical"
}
```

**Parameters:**
| Parameter  | Type   | Required | Description                  |
| ---------- | ------ | -------- | ---------------------------- |
| `period`   | enum   | No       | `7d`, `30d`, `90d`           |
| `category` | string | No       | Filter by category           |
| `severity` | enum   | No       | `all`, `critical`, `warning` |

---

## Layer 4: Detail

### `drift_pattern_get`

Complete details for a specific pattern.

```json
{
  "id": "api-rest-controller-pattern",
  "includeLocations": true,
  "includeOutliers": true,
  "maxLocations": 20
}
```

**Parameters:**
| Parameter          | Type    | Required | Description             |
| ------------------ | ------- | -------- | ----------------------- |
| `id`               | string  | Yes      | Pattern ID              |
| `includeLocations` | boolean | No       | Include all locations   |
| `includeOutliers`  | boolean | No       | Include outlier details |
| `maxLocations`     | number  | No       | Max locations to return |

### `drift_code_examples`

Real code examples for patterns.

```json
{
  "categories": ["api", "errors"],
  "pattern": "error-handling-try-catch",
  "maxExamples": 3,
  "contextLines": 10
}
```

**Parameters:**
| Parameter      | Type   | Required | Description                    |
| -------------- | ------ | -------- | ------------------------------ |
| `categories`   | array  | No       | Categories to get examples for |
| `pattern`      | string | No       | Specific pattern name or ID    |
| `maxExamples`  | number | No       | Max examples per pattern       |
| `contextLines` | number | No       | Lines of context               |

### `drift_files_list`

List files with patterns.

```json
{
  "path": "src/api/**/*.ts",
  "category": "api",
  "limit": 20
}
```

**Parameters:**
| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `path`     | string | No       | Glob pattern       |
| `category` | string | No       | Filter by category |
| `limit`    | number | No       | Max files          |
| `cursor`   | string | No       | Pagination cursor  |

### `drift_file_patterns`

All patterns in a specific file.

```json
{
  "file": "src/api/users.controller.ts",
  "category": "api"
}
```

**Parameters:**
| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `file`     | string | Yes      | File path          |
| `category` | string | No       | Filter by category |

### `drift_impact_analysis`

Analyze impact of changing a file or function.

```json
{
  "target": "src/auth/login.ts",
  "maxDepth": 10,
  "limit": 10
}
```

**Parameters:**
| Parameter  | Type   | Required | Description                |
| ---------- | ------ | -------- | -------------------------- |
| `target`   | string | Yes      | File path or function name |
| `maxDepth` | number | No       | Max call depth             |
| `limit`    | number | No       | Max items per section      |

### `drift_reachability`

Data reachability analysis.

```json
{
  "direction": "forward",
  "location": "src/api/users.ts:42",
  "target": "users.password_hash",
  "maxDepth": 10,
  "sensitiveOnly": true
}
```

**Parameters:**
| Parameter       | Type    | Required | Description                                                         |
| --------------- | ------- | -------- | ------------------------------------------------------------------- |
| `direction`     | enum    | No       | `forward` (what can code access) or `inverse` (who can access data) |
| `location`      | string  | No       | For forward: file:line or function                                  |
| `target`        | string  | No       | For inverse: table or table.field                                   |
| `maxDepth`      | number  | No       | Max traversal depth                                                 |
| `sensitiveOnly` | boolean | No       | Only show sensitive data                                            |

### `drift_dna_profile`

Styling DNA profile.

```json
{
  "gene": "variant-handling"
}
```

**Parameters:**
| Parameter | Type | Required | Description                                                                                                       |
| --------- | ---- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `gene`    | enum | No       | `variant-handling`, `responsive-approach`, `state-styling`, `theming`, `spacing-philosophy`, `animation-approach` |

### `drift_wrappers`

Framework wrapper detection.

```json
{
  "category": "data-fetching",
  "minConfidence": 0.5,
  "minClusterSize": 2,
  "includeTests": false
}
```

**Parameters:**
| Parameter        | Type    | Required | Description                  |
| ---------------- | ------- | -------- | ---------------------------- |
| `category`       | enum    | No       | Wrapper category             |
| `minConfidence`  | number  | No       | Minimum confidence 0-1       |
| `minClusterSize` | number  | No       | Minimum wrappers per cluster |
| `maxDepth`       | number  | No       | Max wrapper depth            |
| `includeTests`   | boolean | No       | Include test files           |

---

## Layer 5: Analysis

### `drift_test_topology`

Test-to-code mapping analysis.

```json
{
  "action": "affected",
  "files": ["src/auth/login.ts", "src/auth/logout.ts"],
  "file": "src/api/users.ts",
  "limit": 20,
  "minRisk": "medium"
}
```

**Parameters:**
| Parameter | Type   | Required | Description                                                       |
| --------- | ------ | -------- | ----------------------------------------------------------------- |
| `action`  | enum   | Yes      | `status`, `coverage`, `uncovered`, `mocks`, `affected`, `quality` |
| `file`    | string | No       | File for coverage/quality                                         |
| `files`   | array  | No       | Changed files for affected                                        |
| `limit`   | number | No       | Max results                                                       |
| `minRisk` | enum   | No       | `low`, `medium`, `high`                                           |

### `drift_coupling`

Module dependency analysis.

```json
{
  "action": "cycles",
  "module": "src/auth",
  "limit": 15,
  "minCoupling": 3,
  "maxCycleLength": 10,
  "minSeverity": "warning"
}
```

**Parameters:**
| Parameter        | Type   | Required | Description                                                                    |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `action`         | enum   | Yes      | `status`, `cycles`, `hotspots`, `analyze`, `refactor-impact`, `unused-exports` |
| `module`         | string | No       | Module path for analyze/refactor-impact                                        |
| `limit`          | number | No       | Max results                                                                    |
| `minCoupling`    | number | No       | Min coupling threshold                                                         |
| `maxCycleLength` | number | No       | Max cycle length                                                               |
| `minSeverity`    | enum   | No       | `info`, `warning`, `critical`                                                  |

### `drift_error_handling`

Error handling pattern analysis.

```json
{
  "action": "gaps",
  "function": "handleLogin",
  "limit": 20,
  "minSeverity": "medium"
}
```

**Parameters:**
| Parameter     | Type   | Required | Description                                            |
| ------------- | ------ | -------- | ------------------------------------------------------ |
| `action`      | enum   | Yes      | `status`, `gaps`, `boundaries`, `unhandled`, `analyze` |
| `function`    | string | No       | Function for analyze                                   |
| `limit`       | number | No       | Max results                                            |
| `minSeverity` | enum   | No       | `low`, `medium`, `high`, `critical`                    |

### `drift_constants`

Analyze constants, enums, and exported values. Detects hardcoded secrets, inconsistent values, and magic numbers.

```json
{
  "action": "status"
}
```

**Actions:**

| Action         | Description                                    |
| -------------- | ---------------------------------------------- |
| `status`       | Overview of constants by category and language |
| `list`         | List constants with filtering                  |
| `get`          | Get constant details                           |
| `usages`       | Find references to a constant                  |
| `magic`        | Find magic values that should be constants     |
| `dead`         | Find unused constants                          |
| `secrets`      | Detect potential hardcoded secrets             |
| `inconsistent` | Find constants with inconsistent values        |

**Parameters:**
| Parameter  | Type    | Required | Description                                                                                                                          |
| ---------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `action`   | enum    | No       | Action to perform (default: `status`)                                                                                                |
| `category` | enum    | No       | Filter by category: `config`, `api`, `status`, `error`, `feature_flag`, `limit`, `regex`, `path`, `env`, `security`, `uncategorized` |
| `language` | enum    | No       | Filter by language: `typescript`, `javascript`, `python`, `java`, `csharp`, `php`, `go`                                              |
| `file`     | string  | No       | Filter by file path                                                                                                                  |
| `search`   | string  | No       | Search constant names                                                                                                                |
| `exported` | boolean | No       | Filter by exported status                                                                                                            |
| `id`       | string  | No       | Constant ID for get/usages                                                                                                           |
| `name`     | string  | No       | Constant name for get/usages                                                                                                         |
| `severity` | enum    | No       | Min severity for secrets: `info`, `low`, `medium`, `high`, `critical`                                                                |
| `limit`    | number  | No       | Max results (default: 20, max: 50)                                                                                                   |
| `cursor`   | string  | No       | Pagination cursor                                                                                                                    |

**Example - Find hardcoded secrets:**
```json
{
  "action": "secrets",
  "severity": "high"
}
```

**Example - List API constants:**
```json
{
  "action": "list",
  "category": "api",
  "language": "typescript"
}
```

---

## Layer 6: Generation

### `drift_suggest_changes`

AI-guided fix suggestions.

```json
{
  "target": "src/api/users.ts",
  "issue": "outlier",
  "patternId": "api-rest-controller",
  "maxSuggestions": 3
}
```

**Parameters:**
| Parameter        | Type   | Required | Description                                                                               |
| ---------------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `target`         | string | Yes      | File or function to analyze                                                               |
| `issue`          | enum   | No       | `outlier`, `security`, `coupling`, `error-handling`, `test-coverage`, `pattern-violation` |
| `patternId`      | string | No       | Pattern ID for outlier issues                                                             |
| `maxSuggestions` | number | No       | Max suggestions                                                                           |

### `drift_validate_change`

Validate proposed changes against patterns.

```json
{
  "file": "src/api/users.ts",
  "content": "// new code here",
  "diff": "--- a/file\n+++ b/file\n...",
  "strictMode": false
}
```

**Parameters:**
| Parameter    | Type    | Required | Description           |
| ------------ | ------- | -------- | --------------------- |
| `file`       | string  | Yes      | File path             |
| `content`    | string  | No       | Proposed code content |
| `diff`       | string  | No       | Unified diff format   |
| `strictMode` | boolean | No       | Fail on any violation |

### `drift_explain`

Comprehensive code explanation.

```json
{
  "target": "src/auth/middleware.ts",
  "depth": "comprehensive",
  "focus": "security"
}
```

**Parameters:**
| Parameter | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `target`  | string | Yes      | File, function, or symbol                            |
| `depth`   | enum   | No       | `summary`, `detailed`, `comprehensive`               |
| `focus`   | string | No       | `security`, `performance`, `architecture`, `testing` |
</file>

<file path="wiki/Pattern-Categories.md">
# Pattern Categories

Drift detects patterns across 14 categories.

## Categories Overview

| Category        | Description              | Examples                                         |
| --------------- | ------------------------ | ------------------------------------------------ |
| `api`           | API endpoint patterns    | REST controllers, route handlers, middleware     |
| `auth`          | Authentication patterns  | JWT handling, session management, OAuth          |
| `security`      | Security patterns        | Input validation, CSRF protection, rate limiting |
| `errors`        | Error handling patterns  | Try-catch blocks, error boundaries, logging      |
| `logging`       | Logging patterns         | Log levels, structured logging, audit trails     |
| `data-access`   | Database access patterns | ORM usage, queries, transactions                 |
| `config`        | Configuration patterns   | Environment variables, feature flags             |
| `testing`       | Testing patterns         | Test structure, mocking, assertions              |
| `performance`   | Performance patterns     | Caching, lazy loading, optimization              |
| `components`    | UI component patterns    | Component structure, props, state                |
| `styling`       | Styling patterns         | CSS-in-JS, design tokens, themes                 |
| `structural`    | Code structure patterns  | File naming, folder organization                 |
| `types`         | Type definition patterns | Interfaces, type guards, generics                |
| `accessibility` | Accessibility patterns   | ARIA labels, keyboard navigation                 |

---

## api

API endpoint and routing patterns.

**What Drift Detects:**
- REST controller decorators (`@Controller`, `@Get`, `@Post`)
- Route handler signatures
- Request/response typing
- Middleware chains
- API versioning patterns
- Response format conventions

**Example Pattern:**
```typescript
// Drift learns your API pattern:
@Controller('/api/v1/users')
export class UserController {
  @Get('/:id')
  @RequireAuth()
  async getUser(@Param('id') id: string): Promise<UserResponse> {
    // ...
  }
}
```

---

## auth

Authentication and authorization patterns.

**What Drift Detects:**
- JWT token handling
- Session management
- OAuth flows
- Permission checks
- Role-based access control
- Auth middleware usage

**Example Pattern:**
```typescript
// Drift learns your auth pattern:
@RequireAuth()
@RequireRole('admin')
async deleteUser(userId: string) {
  // ...
}
```

---

## security

Security-related patterns.

**What Drift Detects:**
- Input validation
- SQL injection prevention
- XSS protection
- CSRF tokens
- Rate limiting
- Sensitive data handling

**Example Pattern:**
```typescript
// Drift learns your validation pattern:
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const validated = schema.parse(input);
```

---

## errors

Error handling patterns.

**What Drift Detects:**
- Try-catch block structure
- Error class hierarchies
- Error response formats
- Error logging
- Error boundaries (React)
- Async error handling

**Example Pattern:**
```typescript
// Drift learns your error pattern:
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error, context });
  throw new AppError('OPERATION_FAILED', error);
}
```

---

## logging

Logging and observability patterns.

**What Drift Detects:**
- Log level usage
- Structured logging format
- Context inclusion
- Audit logging
- Performance logging
- Error logging

**Example Pattern:**
```typescript
// Drift learns your logging pattern:
logger.info('User action', {
  userId: user.id,
  action: 'login',
  timestamp: new Date().toISOString()
});
```

---

## data-access

Database and data access patterns.

**What Drift Detects:**
- ORM usage (Prisma, TypeORM, etc.)
- Query patterns
- Transaction handling
- Repository patterns
- Data validation
- Soft delete patterns

**Example Pattern:**
```typescript
// Drift learns your data access pattern:
const user = await prisma.user.findUnique({
  where: { id },
  include: { profile: true }
});
```

---

## config

Configuration and environment patterns.

**What Drift Detects:**
- Environment variable access
- Config file structure
- Feature flags
- Secret management
- Default values
- Validation

**Example Pattern:**
```typescript
// Drift learns your config pattern:
const config = {
  port: process.env.PORT || 3000,
  database: {
    url: requireEnv('DATABASE_URL'),
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10')
  }
};
```

---

## testing

Testing patterns.

**What Drift Detects:**
- Test file naming
- Test structure (describe/it)
- Mocking patterns
- Assertion styles
- Setup/teardown
- Test data factories

**Example Pattern:**
```typescript
// Drift learns your test pattern:
describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create user', async () => {
    const user = await userService.create(mockUserData);
    expect(user.id).toBeDefined();
  });
});
```

---

## performance

Performance optimization patterns.

**What Drift Detects:**
- Caching strategies
- Lazy loading
- Memoization
- Batch processing
- Connection pooling
- Query optimization

---

## components

UI component patterns (React, Vue, etc.).

**What Drift Detects:**
- Component structure
- Props patterns
- State management
- Hooks usage
- Event handling
- Composition patterns

---

## styling

CSS and styling patterns.

**What Drift Detects:**
- CSS-in-JS patterns
- Design token usage
- Theme structure
- Responsive patterns
- Animation patterns
- Spacing conventions

---

## structural

Code organization patterns.

**What Drift Detects:**
- File naming conventions
- Folder structure
- Module organization
- Import patterns
- Export patterns
- Index files

---

## types

TypeScript type patterns.

**What Drift Detects:**
- Interface definitions
- Type aliases
- Generic patterns
- Type guards
- Utility types
- Discriminated unions

---

## accessibility

Accessibility patterns.

**What Drift Detects:**
- ARIA attributes
- Keyboard navigation
- Focus management
- Screen reader support
- Color contrast
- Semantic HTML

---

## Filtering by Category

### CLI

```bash
# List patterns in a category
drift where --category api

# Approve all in a category
drift approve --category auth --yes

# Export specific categories
drift export --categories api,auth,errors
```

### MCP

```json
{
  "tool": "drift_patterns_list",
  "parameters": {
    "categories": ["api", "auth", "errors"]
  }
}
```
</file>

<file path="wiki/Troubleshooting.md">
# Troubleshooting

Common issues and solutions.

## Installation Issues

### `npm install` fails

**Symptoms:** Tree-sitter native modules fail to build

**Solutions:**
1. Ensure you have build tools installed:
   - macOS: `xcode-select --install`
   - Ubuntu: `sudo apt-get install build-essential`
   - Windows: Install Visual Studio Build Tools

2. Try with Node.js 18 or 20 (not 22+):
   ```bash
   nvm use 18
   npm install -g driftdetect
   ```

3. Clear npm cache:
   ```bash
   npm cache clean --force
   npm install -g driftdetect
   ```

### `npx driftdetect` hangs

**Solutions:**
1. Use global install instead:
   ```bash
   npm install -g driftdetect
   drift init
   ```

2. Clear npx cache:
   ```bash
   rm -rf ~/.npm/_npx
   npx driftdetect init
   ```

---

## Scanning Issues

### Scan takes too long

**Symptoms:** Scan runs for 10+ minutes

**Solutions:**
1. Check `.driftignore` excludes large directories:
   ```gitignore
   node_modules/
   dist/
   build/
   .git/
   vendor/
   ```

2. Scan a subdirectory:
   ```bash
   drift scan src/
   ```

3. Use timeout:
   ```bash
   drift scan --timeout 600000
   ```

4. Use incremental scanning:
   ```bash
   drift scan --incremental
   ```

### No patterns found

**Symptoms:** `drift status` shows 0 patterns

**Solutions:**
1. Ensure you're scanning source files:
   ```bash
   drift scan src/
   ```

2. Check language is supported:
   ```bash
   drift parser --test
   ```

3. Lower confidence threshold:
   ```json
   // .drift/config.json
   {
     "patterns": {
       "minConfidence": 0.3
     }
   }
   ```

4. Check file extensions are recognized:
   - TypeScript: `.ts`, `.tsx`
   - Python: `.py`
   - Java: `.java`
   - C#: `.cs`
   - PHP: `.php`

### Scan fails with error

**Symptoms:** Scan crashes or exits with error

**Solutions:**
1. Run with verbose output:
   ```bash
   drift scan --verbose
   ```

2. Check for syntax errors in your code (Drift handles most, but some crash parsers)

3. Try scanning specific files:
   ```bash
   drift scan src/api/
   ```

4. Report the issue with the error message:
   https://github.com/dadbodgeoff/drift/issues

---

## MCP Issues

### MCP server not connecting

**Symptoms:** AI agent can't find Drift tools

**Solutions:**
1. Verify config file location:
   - Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Claude Desktop (Windows): `%APPDATA%\Claude\claude_desktop_config.json`

2. Check JSON syntax:
   ```json
   {
     "mcpServers": {
       "drift": {
         "command": "npx",
         "args": ["-y", "driftdetect-mcp"]
       }
     }
   }
   ```

3. Restart the AI client after config changes

4. Test MCP server manually:
   ```bash
   npx driftdetect-mcp
   # Should start without errors
   ```

### "Scan required" errors

**Symptoms:** MCP tools return "scan required" error

**Solutions:**
1. Run initial scan:
   ```bash
   cd your-project
   drift init
   drift scan
   ```

2. Ensure `.drift/` directory exists and has data

3. Check you're in the right directory

### Slow MCP responses

**Symptoms:** AI takes long time to get Drift data

**Solutions:**
1. First call is always slower (loading data)

2. Use `drift_status` first (lightweight)

3. For large codebases, pre-build call graph:
   ```bash
   drift callgraph build
   ```

4. Enable caching (default):
   ```json
   {
     "mcp": {
       "cache": {
         "enabled": true
       }
     }
   }
   ```

---

## Call Graph Issues

### Call graph not building

**Symptoms:** `drift callgraph build` fails or shows 0 functions

**Solutions:**
1. Ensure source files are being scanned:
   ```bash
   drift scan --verbose
   ```

2. Check parser status:
   ```bash
   drift parser --test
   ```

3. Try building for specific directory:
   ```bash
   drift callgraph build src/
   ```

### Reachability returns nothing

**Symptoms:** `drift callgraph reach` returns empty results

**Solutions:**
1. Ensure call graph is built:
   ```bash
   drift callgraph status
   ```

2. Check the location format:
   ```bash
   # File:line format
   drift callgraph reach src/api/users.ts:42
   
   # Function name
   drift callgraph reach handleLogin
   ```

3. Increase max depth:
   ```bash
   drift callgraph reach src/api/users.ts:42 --max-depth 20
   ```

---

## Dashboard Issues

### Dashboard won't start

**Symptoms:** `drift dashboard` fails to open

**Solutions:**
1. Check port availability:
   ```bash
   drift dashboard --port 3001
   ```

2. Try without auto-open:
   ```bash
   drift dashboard --no-browser
   # Then open http://localhost:3000 manually
   ```

3. Check for errors:
   ```bash
   drift dashboard --verbose
   ```

### Dashboard shows no data

**Symptoms:** Dashboard opens but is empty

**Solutions:**
1. Run a scan first:
   ```bash
   drift scan
   drift dashboard
   ```

2. Check `.drift/` directory has data

---

## CI Issues

### `drift check` always passes

**Symptoms:** CI never fails even with violations

**Solutions:**
1. Use `--ci` flag:
   ```bash
   drift check --ci --fail-on warning
   ```

2. Ensure patterns are approved:
   ```bash
   drift approve --category api --yes
   drift check --ci
   ```

### `drift check` always fails

**Symptoms:** CI fails on every run

**Solutions:**
1. Lower fail threshold:
   ```bash
   drift check --ci --fail-on error  # Only fail on errors
   ```

2. Ignore specific patterns:
   ```bash
   drift ignore <pattern-id>
   ```

3. Check what's failing:
   ```bash
   drift check --format json
   ```

---

## Getting Help

### Reporting Issues

Include in your bug report:
1. Drift version: `drift --version`
2. Node.js version: `node --version`
3. Operating system
4. Error message (full output)
5. Steps to reproduce

### Community

- [GitHub Issues](https://github.com/dadbodgeoff/drift/issues)
- [GitHub Discussions](https://github.com/dadbodgeoff/drift/discussions)
</file>

</files>
