AGENTS.md is a Markdown “rules file” that lives in the repo and tells coding agents how to work on that project; your agent should automatically discover, interpret, and respect it when editing code. [github](https://github.com/openai/agents.md)

## Mental model and scope

AGENTS.md is intentionally simple: it is just Markdown with human-written instructions, no required schema, and no reserved headings. The standard is a convention, not a spec with strict fields, so your agent must treat it as advisory natural-language guidance. Typical content includes: [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

- Dev environment setup commands and build steps. [builder](https://www.builder.io/c/docs/agents-md)
- Test commands and expectations for passing the suite before changes are “done.” [agents](https://agents.md)
- Code style and architecture preferences, such as TypeScript strict mode, use of functional patterns, or logging rules. [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
- PR / commit requirements and contribution guidelines tailored for agents. [github](https://github.com/openai/agents.md)
- Project- or security-specific gotchas, such as CI workflows, deployment notes, or large data handling. [builder](https://www.builder.io/c/docs/agents-md)

Your implementation goal: whenever the agent works inside a repository, it should (1) locate the relevant AGENTS.md, (2) distill its instructions into operational rules, and (3) apply those rules to planning, code edits, testing, and reporting.

## File discovery and precedence

Your agent must know where to look and how to resolve multiple AGENTS.md files, especially in monorepos. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

1. **Search locations**  
   - Always check the repo root for `/AGENTS.md` after you detect a project workspace. [agents](https://agents.md)
   - In monorepos or multi-package setups, also look for nested `AGENTS.md` files in subdirectories (e.g., `packages/app/AGENTS.md`, `services/api/AGENTS.md`). [github](https://github.com/openai/agents.md)

2. **Closest-file-wins rule**  
   - When operating on a specific path, resolve the applicable instructions by walking up parent directories until you either hit an `AGENTS.md` or the repo root. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
   - If you find multiple candidates, prefer the closest one to the file being edited; treat the root-level AGENTS.md as a fallback baseline. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)

3. **Multiple scopes example**  
   - Root AGENTS.md: repo-wide policies (e.g., “Use pnpm”, “Run pnpm test before committing”). [agents](https://agents.md)
   - `packages/frontend/AGENTS.md`: frontend-specific commands and style (e.g., Vite, React, tsx conventions). [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
   - When editing `packages/frontend/src/App.tsx`, the agent should obey the frontend file’s instructions first and only fall back to root rules where there is no conflict. [github](https://github.com/openai/agents.md)

4. **Conflicts**  
   - If two AGENTS.md files conflict, prefer the closest file to the edited code. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
   - Explicit user instructions in the chat always override AGENTS.md, but the agent should surface that it is deviating (e.g., mentioning that the user asked to bypass tests that AGENTS.md normally requires). [github](https://github.com/openai/agents.md)

## Parsing instructions into behavior

AGENTS.md is free-form Markdown, so parsing must be robust and language-model-friendly rather than schema-driven. [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)

1. **Heading-aware segmentation**  
   - Parse the Markdown into sections keyed by heading (e.g., “Dev environment tips,” “Testing instructions,” “PR instructions,” “Code style”). [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)
   - Normalize headings to a canonical set in your internal representation when possible (e.g., map “Dev environment tips” or “Setup commands” into a “setup” category). [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)

2. **Common section types to recognize**  
   - Setup / environment: install commands, local dev server commands, workspace navigation shortcuts. [builder](https://www.builder.io/c/docs/agents-md)
   - Build / test: “Run `pnpm turbo run test --filter <project_name>`” or “CI plan is in `.github/workflows`.” [builder](https://www.builder.io/c/docs/agents-md)
   - Style / architecture: language modes, formatting rules, design patterns to prefer or avoid. [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
   - PR / commit instructions: title formats, required checks, review expectations. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
   - Misc agent guidance: “If blocked: state why and propose next step,” done criteria, logging requirements. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

3. **Extract actionable commands**  
   - Identify shell commands in fenced code blocks and list items that look like CLI usage, e.g., `pnpm install`, `pnpm run dev`, `pnpm lint --filter <project_name>`, `pnpm vitest run -t "<test name>"`. [builder](https://www.builder.io/c/docs/agents-md)
   - Tag commands with intent: “install deps,” “run tests,” “run lint,” “start dev server,” etc., so your planning layer can pick them automatically. [github](https://github.com/openai/agents.md)

4. **Extract policies and expectations**  
   - Detect rules phrased as “Always…”, “Never…”, “Done = …”, or “Before merging, …”, and store them as constraints (e.g., “Done = compiles clean, tests pass, no TODOs” from a common AGENTS.md snippet). [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
   - Recognize environment-specific hints (e.g., “Use pnpm, not npm”; “Check package.json name fields”; “Use functional patterns where possible”). [news.ycombinator](https://news.ycombinator.com/item?id=44957443)

5. **Internal representation**  
   - Convert each AGENTS.md into an internal config-like structure: `{ setupCommands: [...], testCommands: [...], lintCommands: [...], styleRules: [...], prRules: [...], miscGuidance: [...] }` with a source path and precedence level. [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)
   - Keep the original raw text available so the model can re-interpret or re-summarize it when forming natural-language plans. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

## Applying AGENTS.md during tasks

Your agent should not just read AGENTS.md once; it should actively use it to shape its behavior over the entire lifecycle of a coding task. [agents](https://agents.md)

### Planning and explanation

- When a new coding task starts in a repo, the agent should briefly incorporate AGENTS.md rules into its internal task plan:  
  - Confirm which AGENTS.md applies to the target path and load its instructions. [agents](https://agents.md)
  - Align its workflow with defined sequences: e.g., “After changes, run `pnpm lint` and `pnpm test`.” [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
- When presenting plans to the user, the agent can reference these conventions in natural language, e.g., “I’ll follow the project’s AGENTS.md by running `pnpm turbo run test --filter ui` before finalizing the changes.” [builder](https://www.builder.io/c/docs/agents-md)

### Code generation and edits

- Enforce code style and structural preferences listed in AGENTS.md when generating or modifying code. [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)
  - Examples: TypeScript strict assumptions, specific logging macros, or architectural patterns like prefer components over resource maps. [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
- Avoid changes that contradict explicit rules, such as adding `console.log` when logging is supposed to use `info!/debug!/warn!/error!`. [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
- Respect “Done” definitions, such as “Done = compiles clean, tests pass, verified in-app, no TODOs/hacks.” [news.ycombinator](https://news.ycombinator.com/item?id=44957443)

### Running commands and checks

- If AGENTS.md lists test or lint commands, the agent should attempt to run the relevant ones when it has a tool that can execute shell commands, especially before declaring the task complete. [github](https://github.com/openai/agents.md)
- Pick the narrowest relevant command when possible (e.g., use `pnpm turbo run test --filter <project_name>` rather than `pnpm test` at the root if the instructions emphasize that). [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
- If a command fails, the agent should treat that as a signal to debug and fix the issue before finishing, unless the user explicitly instructs otherwise. [builder](https://www.builder.io/c/docs/agents-md)

### Reporting and PR guidance

- When preparing PR descriptions or commit messages, follow the listed conventions such as title formats or content expectations. [github](https://github.com/openai/agents.md)
- If AGENTS.md specifies that tests and lint must pass before merge, explicitly state whether those steps were run and with what result. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)

### Handling being blocked

- Some AGENTS.md examples explicitly ask the agent to “If blocked: state why and propose the next viable step.” [news.ycombinator](https://news.ycombinator.com/item?id=44957443)
- Your agent should implement this: when environment constraints, missing tools, or unclear instructions prevent progress, report the reason and suggest a concrete next action (e.g., “Install pnpm,” “Check CI logs,” or “Clarify which package to modify”). [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

## Edge cases and robustness

To make support reliable and safe, your agent should handle non-ideal situations gracefully. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)

1. **No AGENTS.md present**  
   - Fall back to generic behavior (e.g., standard best practices for the language and tooling) and do not assume any special commands. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)
   - Optionally suggest that the user add an AGENTS.md for more predictable behavior.  

2. **Incomplete or minimal AGENTS.md**  
   - Use whatever instructions exist (even if only test commands or style hints), and supplement missing context from other docs such as README and package.json. [agents](https://agents.md)

3. **Confusing or contradictory instructions**  
   - Apply the closest-file-wins rule for conflicts across scopes. [github](https://github.com/openai/agents.md)
   - If internal contradictions exist within a single file, favor explicit and more recent-looking instructions (e.g., headings like “Updated instructions” or “Deprecated”). [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)
   - If ambiguity remains and matters for safety or correctness, ask the user for clarification rather than guessing.  

4. **Multiple languages / stacks**  
   - In polyglot repos, obey local AGENTS.md style and commands; one subproject may use `pnpm`, another `poetry`, etc. [builder](https://www.builder.io/c/docs/agents-md)
   - Ensure your internal model does not bleed conventions from one sub-tree into another unless the root AGENTS.md explicitly defines global rules. [agents](https://agents.md)

5. **Updates over time**  
   - Treat AGENTS.md as living documentation; re-read or re-parse when the file changes during a long session. [youtube](https://www.youtube.com/watch?v=R4nZs6jSffI)
   - If the agent itself modifies AGENTS.md (for example, to add missing test instructions upon user request), it must be careful not to break existing guidance and should respect the project’s tone and structure. [ainativecompass.substack](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd)

## Implementation checklist for your agent

Use this as a concrete step list when adding AGENTS.md support to an AI coding agent. [agents](https://agents.md)

- **Repository integration**  
  - Detect repo root and project structure (e.g., via VCS, workspace files).  
  - Walk the tree to catalog all `AGENTS.md` files with their paths.  

- **Resolution strategy**  
  - Implement closest-file-wins resolution for any target path.  
  - Fall back to root AGENTS.md, then to default behavior when none exists.  

- **Markdown parsing layer**  
  - Parse AGENTS.md into sections keyed by headings.  
  - Extract shell-like commands from code fences and bullet points.  
  - Identify clear rules/constraints from imperative language (“Always…”, “Never…”, “Done = …”).  

- **Internal configuration**  
  - Normalize instructions into an internal structure with fields for setup, build, test, lint, style, PR rules, and miscellaneous guidance.  
  - Store origin and precedence metadata for each instruction.  

- **Planner and executor integration**  
  - At task start, load the applicable AGENTS.md config and feed a concise summary into the model prompt/context.  
  - Bias your plan to include required commands (lint, test) before completion.  
  - Use style rules to guide code generation decisions.  

- **Runtime behavior**  
  - Run specified commands when tools allow; interpret failures as work to fix, not as final. [builder](https://www.builder.io/c/docs/agents-md)
  - Conform to commit/PR rules in any generated descriptions or titles.  
  - When blocked or forced to deviate from AGENTS.md (by user or environment), explain that deviation and its implications.  

- **Testing your AGENTS.md support**  
  - Add sample repos with different AGENTS.md variants: simple single-file, nested monorepo, conflicting instructions, and missing sections. [agentsmd](https://agentsmd.io/examples)
  - Verify that your agent:  
    - Picks the right AGENTS.md for a given path.  
    - Runs the right commands in the right order.  
    - Produces code and plans aligned with listed style rules.  

If you follow these behaviors, your agent will respect AGENTS.md as a first-class, cross-tool convention for guiding coding agents, while remaining robust to the format’s intentionally flexible, human-readable nature. [thoughtworks](https://www.thoughtworks.com/en-us/radar/techniques/agents-md)