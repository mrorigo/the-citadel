# Technical Requirements: The Foundry

**Version:** 1.0  
**Last Updated:** 2026-01-24

---

## 1. Runtime & Language

| Requirement  | Specification                    |
| ------------ | -------------------------------- |
| **Language** | TypeScript (strict mode enabled) |
| **Runtime**  | [Bun](https://bun.sh/) v1.0+     |
| **Target**   | ES2022+                          |

### Why Bun?
- **Performance:** Native TypeScript execution without transpilation overhead
- **Built-in tooling:** Bundler, test runner, package manager unified
- **Speed:** Significantly faster startup and execution compared to Node.js
- **SQLite native:** Built-in SQLite support (useful for Beads local cache)

---

## 2. LLM Integration

| Requirement   | Specification                                          |
| ------------- | ------------------------------------------------------ |
| **Framework** | [Vercel AI SDK](https://sdk.vercel.ai/)                |
| **Version**   | `ai` v4.x+                                             |
| **Providers** | Ollama (dev), OpenAI, Anthropic, Google (configurable) |

### Local Development (Ollama)

For development and local testing, we use a local Ollama instance with OpenAI-compatible API:

| Setting      | Value                       |
| ------------ | --------------------------- |
| **Base URL** | `http://localhost:11434/v1` |
| **API Key**  | `ollama`                    |
| **Models**   | See available models below  |

**Available Local Models:**
- `gpt-oss:120b-cloud` — Large reasoning model (cloud-backed)
- `lfm2.5-thinking:latest` — Thinking/reasoning (731 MB)
- `qwen3:14b` — General purpose (9.3 GB)
- `llama3.2:3b` — Fast general purpose (2.0 GB)
- `gemma3:4b` — Compact reasoning (3.3 GB)

### Per-Agent Model Configuration

Different agents can use different models optimized for their role:

| Agent          | Recommended Model            | Rationale                                       |
| -------------- | ---------------------------- | ----------------------------------------------- |
| **Router**     | `gpt-oss:120b-cloud`         | Complex decomposition requires strong reasoning |
| **Worker**     | `qwen3:14b` or `llama3.2:3b` | Code generation, balance speed/quality          |
| **Supervisor** | `llama3.2:3b`                | Simple health checks, fast response             |
| **Gatekeeper** | `gpt-oss:120b-cloud`         | Critical merge decisions need accuracy          |

### Vercel AI SDK Features Used
- **Unified API:** Single interface for multiple LLM providers
- **OpenAI Compatibility:** Works with any OpenAI-compatible endpoint (Ollama, vLLM, etc.)
- **Streaming:** Native support for streaming responses
- **Tool Calling:** Structured tool/function calling support
- **Structured Output:** JSON schema validation for agent outputs
- **Token Management:** Built-in token counting and limits

```typescript
import { generateText, streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// Local Ollama (OpenAI-compatible)
const ollama = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

// Production OpenAI
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
```

---

## 3. Core Dependencies

### Primary Stack

| Package             | Purpose            | Version |
| ------------------- | ------------------ | ------- |
| `ai`                | Vercel AI SDK core | ^4.0    |
| `@ai-sdk/openai`    | OpenAI provider    | ^1.0    |
| `@ai-sdk/anthropic` | Anthropic provider | ^1.0    |
| `zod`               | Schema validation  | ^3.23   |
| `commander`         | CLI framework      | ^12.0   |

### Development Dependencies

| Package      | Purpose              |
| ------------ | -------------------- |
| `typescript` | Type checking        |
| `@types/bun` | Bun type definitions |
| `biome`      | Linting & formatting |

---

## 4. Integration with Beads

The Foundry consumes and produces Beads (tickets) stored in `.beads/issues.jsonl`.

### Beads CLI Interface
```bash
# Reading tasks
bd ready --json           # Get ready tasks (no blockers)
bd show <id> --json       # Get task details
bd list --status open     # List open tasks

# Writing tasks
bd create "Title" -p 0    # Create P0 task
bd update <id> --status in_progress
bd close <id>             # Mark complete
```

### Programmatic Access
We will wrap the `bd` CLI or parse the JSONL directly:

```typescript
interface Bead {
  id: string;              // e.g., "bd-a1b2"
  title: string;
  status: 'open' | 'in_progress' | 'verify' | 'done';
  priority: 0 | 1 | 2 | 3;
  assignee?: string;
  blockers?: string[];     // IDs of blocking beads
  acceptance_test?: string;
  created_at: string;
  updated_at: string;
}
```

---

## 5. Project Structure

```
the-foundry/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── services/
│   │   ├── router.ts      # The Router (intent → tickets)
│   │   ├── worker.ts      # The Worker (ticket → diff)
│   │   ├── supervisor.ts  # The Supervisor (health monitoring)
│   │   └── gatekeeper.ts  # The Gatekeeper (merge management)
│   ├── core/
│   │   ├── beads.ts       # Beads integration layer
│   │   ├── dag.ts         # DAG/Molecule execution engine
│   │   └── queue.ts       # Work queue system (Hooks)
│   ├── agents/
│   │   ├── base.ts        # Base agent abstraction
│   │   └── prompts/       # System prompts per role
│   └── types/
│       └── index.ts       # Shared type definitions
├── formulas/              # TOML workflow definitions
│   └── plan-implement-test.toml
├── docs/
├── tests/
├── package.json
├── tsconfig.json
├── biome.json
└── bunfig.toml
```

---

## 6. Configuration

### Environment Variables
```bash
# Local Development (Ollama)
FOUNDRY_OLLAMA_BASE_URL=http://localhost:11434/v1
FOUNDRY_OLLAMA_API_KEY=ollama

# Production (set one or more)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Global defaults
FOUNDRY_ENV=development       # development | production
FOUNDRY_MAX_TOKENS=4096       # Per-request limit
FOUNDRY_COST_LIMIT=1.00       # USD per ticket
FOUNDRY_TIMEOUT=300           # Seconds before worker termination
```

### Configuration File (`foundry.config.ts`)
```typescript
import { defineConfig } from './src/config';

export default defineConfig({
  env: process.env.FOUNDRY_ENV || 'development',
  
  // Provider configurations
  providers: {
    ollama: {
      baseURL: process.env.FOUNDRY_OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.FOUNDRY_OLLAMA_API_KEY || 'ollama',
    },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },

  // Per-agent model configuration
  agents: {
    router: {
      provider: 'ollama',
      model: 'gpt-oss:120b-cloud',
    },
    worker: {
      provider: 'ollama',
      model: 'qwen3:14b',
    },
    supervisor: {
      provider: 'ollama',
      model: 'llama3.2:3b',
    },
    gatekeeper: {
      provider: 'ollama',
      model: 'gpt-oss:120b-cloud',
    },
  },

  // Worker settings
  worker: {
    timeout: 300,
    maxRetries: 3,
    costLimit: 1.00,
  },

  // Beads integration
  beads: {
    path: '.beads',
    autoSync: true,
  },
});
```

---

## 7. Key Constraints

### From PRD Requirements
1. **Stateless Workers:** No memory between tasks; context from Beads only
2. **Deterministic DAGs:** Agents execute within pre-defined workflows
3. **Serial Merges:** Gatekeeper processes merges one at a time
4. **Acceptance Tests:** Every ticket must have a verifiable test
5. **Cost Controls:** Hard token/cost limits per ticket

### Technical Constraints
1. **No `node_modules` patches:** Use Bun-native packages where possible
2. **Strict TypeScript:** `strict: true`, no `any` without justification
3. **Pure Functions:** Agent logic should be side-effect free where possible
4. **JSON Output:** All agent outputs must be parseable JSON (via Zod)

---

## 8. Testing Strategy

| Type        | Tool       | Location             |
| ----------- | ---------- | -------------------- |
| Unit        | `bun test` | `tests/unit/`        |
| Integration | `bun test` | `tests/integration/` |
| E2E         | `bun test` | `tests/e2e/`         |

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage
```

---

## 9. Development Workflow

```bash
# Install dependencies
bun install

# Development (with watch)
bun run dev

# Type checking
bun run typecheck

# Linting
bun run lint

# Build
bun run build

# Run CLI
bun run src/index.ts <command>
```

---

## 10. Future Considerations

- **WebSocket support:** Real-time status updates to TUI/Web UI
- **Plugin system:** Allow custom agent roles and workflows
- **Distributed workers:** Scale beyond single machine
- **Metrics/Observability:** OpenTelemetry integration for tracing
