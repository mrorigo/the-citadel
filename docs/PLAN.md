# The Foundry - Implementation Plan

**Version:** 1.0  
**Last Updated:** 2026-01-24

---

## Overview

This document outlines the phased implementation plan for The Foundry, a deterministic agent orchestration system built on:
- **TypeScript + Bun** runtime
- **Vercel AI SDK** for LLM integration
- **Beads** for Git-backed state management

---

## Phase 1: Foundation (Week 1-2)

**Goal:** Establish project skeleton and core infrastructure.

### 1.1 Project Initialization

- [ ] Initialize Bun project with TypeScript
- [ ] Configure `tsconfig.json` with strict mode
- [ ] Set up Biome for linting/formatting
- [ ] Create directory structure per TECHNICAL.md
- [ ] Add core dependencies (`ai`, `@ai-sdk/openai`, `zod`, `commander`)

```bash
bun init
bun add ai @ai-sdk/openai zod commander
bun add -d typescript @types/bun @biomejs/biome
```

### 1.2 Configuration System

- [ ] Implement `src/config/index.ts` with `defineConfig()`
- [ ] Create Zod schemas for configuration validation
- [ ] Support environment variable loading
- [ ] Add per-agent model configuration support

**Deliverable:** `foundry.config.ts` loads and validates configuration.

### 1.3 LLM Provider Abstraction

- [ ] Create `src/core/llm.ts` provider factory
- [ ] Implement Ollama (OpenAI-compatible) provider setup
- [ ] Add provider selection logic based on config
- [ ] Write unit tests for provider initialization

**Deliverable:** Can instantiate LLM clients for any configured provider.

---

## Phase 2: Beads Integration (Week 2-3)

**Goal:** Full integration with Beads for state management.

### 2.1 Beads Client

- [ ] Create `src/core/beads.ts` wrapper module
- [ ] Implement CLI wrapper functions (`bd ready`, `bd show`, etc.)
- [ ] Direct JSONL parsing as fallback
- [ ] Define TypeScript interfaces for Bead schema

```typescript
interface BeadsClient {
  ready(): Promise<Bead[]>;
  show(id: string): Promise<Bead>;
  create(title: string, options: CreateOptions): Promise<Bead>;
  update(id: string, changes: Partial<Bead>): Promise<Bead>;
  close(id: string): Promise<void>;
}
```

### 2.2 State Machine Enforcement

- [ ] Define valid status transitions (`open` → `in_progress` → `verify` → `done`)
- [ ] Implement transition validation in Beads client
- [ ] Add acceptance test field enforcement
- [ ] Write integration tests against real `.beads/` directory

**Deliverable:** Beads client that enforces Foundry's strict state machine rules.

---

## Phase 3: Queue System (Week 3-4)

**Goal:** Implement the "Hook" system for worker instantiation.

### 3.1 Work Queue

- [ ] Create `src/core/queue.ts` queue abstraction
- [ ] Implement in-memory queue (MVP)
- [ ] Add queue persistence (SQLite via Bun)
- [ ] Implement priority ordering (P0 > P1 > P2 > P3)

### 3.2 Hook Mechanism

- [ ] Create `src/core/hooks.ts` for agent assignment
- [ ] Implement "claim" logic (atomic ticket assignment)
- [ ] Add heartbeat tracking for active workers
- [ ] Implement ticket release on timeout

**Deliverable:** Tickets can be queued, claimed, and released with proper locking.

---

## Phase 4: Core Agents (Week 4-6)

**Goal:** Implement the four core agent roles.

### 4.1 Base Agent

- [ ] Create `src/agents/base.ts` abstract agent class
- [ ] Implement common agent lifecycle (init, execute, cleanup)
- [ ] Add structured output handling with Zod
- [ ] Implement cost/token tracking

```typescript
abstract class BaseAgent {
  abstract readonly role: AgentRole;
  abstract execute(context: AgentContext): Promise<AgentResult>;
}
```

### 4.2 The Router

- [ ] Create `src/services/router.ts`
- [ ] Implement intent → ticket decomposition
- [ ] Add Beads creation for decomposed tasks
- [ ] Create system prompt in `src/agents/prompts/router.md`

**Input:** High-level spec/requirement  
**Output:** Tree of Beads with dependencies

### 4.3 The Worker

- [ ] Create `src/services/worker.ts`
- [ ] Implement ticket → code diff generation
- [ ] Add sandbox execution environment
- [ ] Stateless design (context from Bead only)
- [ ] Create system prompt in `src/agents/prompts/worker.md`

**Input:** Single Bead (ticket)  
**Output:** Git diff/patch

### 4.4 The Supervisor

- [ ] Create `src/services/supervisor.ts`
- [ ] Implement health monitoring loop
- [ ] Add timeout detection and worker termination
- [ ] Queue stall detection and alerting
- [ ] Create system prompt in `src/agents/prompts/supervisor.md`

**Input:** Queue state, worker heartbeats  
**Output:** Control actions (kill, restart, alert)

### 4.5 The Gatekeeper

- [ ] Create `src/services/gatekeeper.ts`
- [ ] Implement serial merge queue
- [ ] Add conflict detection
- [ ] Integrate with CI (test execution)
- [ ] Reject + respawn logic for conflicts
- [ ] Create system prompt in `src/agents/prompts/gatekeeper.md`

**Input:** Completed diffs from Workers  
**Output:** Merged commits or rejection with rebase instructions

---

## Phase 5: DAG Execution Engine (Week 6-7)

**Goal:** Implement deterministic workflow execution.

### 5.1 Formula Parser

- [ ] Create `src/core/dag.ts` DAG engine
- [ ] Implement TOML formula parser
- [ ] Define molecule schema (task chains)
- [ ] Validate DAG structure (no cycles)

```toml
# formulas/plan-implement-test.toml
[formula]
name = "plan-implement-test"

[[steps]]
name = "plan"
type = "router"

[[steps]]
name = "implement"
type = "worker"
depends_on = ["plan"]

[[steps]]
name = "test"
type = "worker"
depends_on = ["implement"]
```

### 5.2 Execution Controller

- [ ] Create `src/core/executor.ts`
- [ ] Implement DAG traversal with dependency resolution
- [ ] Add pause/resume at any node
- [ ] Persist execution state to Beads
- [ ] Handle step failures (pause, not restart)

**Deliverable:** Workflows execute step-by-step with durable state.

---

## Phase 6: CLI Interface (Week 7-8)

**Goal:** User-facing command-line interface.

### 6.1 Core Commands

- [ ] Create `src/index.ts` CLI entry point
- [ ] `foundry init` — Initialize in current repo
- [ ] `foundry spec <file>` — Submit specification
- [ ] `foundry status` — Show DAG/queue status
- [ ] `foundry run` — Start execution loop
- [ ] `foundry stop` — Graceful shutdown

### 6.2 TUI Dashboard (Stretch)

- [ ] Real-time queue visualization
- [ ] DAG progress display
- [ ] Cost tracking display

---

## Phase 7: Testing & Hardening (Week 8-9)

**Goal:** Comprehensive test coverage and stability.

### 7.1 Unit Tests

- [ ] Config loading
- [ ] Beads client
- [ ] Queue operations
- [ ] DAG parsing
- [ ] Agent base class

### 7.2 Integration Tests

- [ ] End-to-end workflow execution
- [ ] Multi-agent coordination
- [ ] Failure recovery scenarios
- [ ] State persistence across restarts

### 7.3 E2E Tests

- [ ] Full spec → merged code flow
- [ ] Conflict handling and rebase
- [ ] Timeout and recovery

---

## Phase 8: Documentation & Polish (Week 9-10)

**Goal:** Production-ready documentation.

- [ ] API documentation
- [ ] User guide
- [ ] Formula authoring guide
- [ ] Troubleshooting guide
- [ ] Example formulas library

---

## Milestone Summary

| Phase | Milestone                    | Target  |
| ----- | ---------------------------- | ------- |
| 1     | Project builds, config loads | Week 2  |
| 2     | Beads CRUD working           | Week 3  |
| 3     | Queue + Hooks functional     | Week 4  |
| 4     | All 4 agents operational     | Week 6  |
| 5     | DAG execution working        | Week 7  |
| 6     | CLI usable                   | Week 8  |
| 7     | 80%+ test coverage           | Week 9  |
| 8     | Docs complete                | Week 10 |

---

## Risk Mitigation

| Risk                     | Mitigation                                    |
| ------------------------ | --------------------------------------------- |
| Beads CLI changes        | Abstract behind interface, pin version        |
| LLM rate limits          | Implement backoff, queue throttling           |
| Merge conflicts at scale | Serial merge queue, atomic operations         |
| Cost overruns            | Hard limits per ticket, Supervisor monitoring |

---

## Next Steps

1. **Immediate:** Initialize Bun project and configure development environment
2. **This week:** Complete Phase 1 (Foundation)
3. **Review:** Validate architecture with small proof-of-concept before Phase 4
