# Exhaustive Forensic Agent Taxonomy & Audit

This document delivers a complete forensic audit of all 33 YAML definitions currently residing in [olt/agents/](file:///Users/onurseckinsenoglu/repos/skills/olt/agents), categorizing them against canonical directives in [AGENTS.md](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md) and [olt/policy.json](file:///Users/onurseckinsenoglu/repos/skills/olt/policy.json).

---

## 1. Categorization & Mapping of all 33 Manifests

```text
                               33 YAML DEFINITIONS IN olt/agents/
                                             │
      ┌──────────────────┬───────────────────┴───────────────────┬──────────────────┐
      ▼                  ▼                                       ▼                  ▼
Host Adapters (6)   Core Personas (8)                      Legacy / Dups (8)   Specialized (11)
• antigravity.yaml  • mind.yaml (T0)                       • worker.yaml       • ui-headless-validator.yaml
• claude.yaml       • mind-auditor.yaml (T0)               • critic.yaml       • ui-optical-validator.yaml
• codex.yaml        • skill-auditor.yaml (T0)              • repairer.yaml     • owner.yaml
• cursor.yaml       • orchestrator.yaml (T1)               • mechanic-val.yaml • independent-planner.yaml
• generic.yaml ⚠️   • coordinator.yaml (T2)                • ui-validator.yaml • independent-planner-audit.yaml
• openai.yaml ⚠️    • implementer.yaml (T3)                • ui-visual-rev.    • planner.yaml
                    • validator.yaml (T3)                  • ui-mechanic-val.  • plan-validator.yaml
                    • completeness-critic.yaml (T3)        • ui-debugger.yaml  • policy-discovery.yaml
                                                                               • sub-implementer.yaml
                                                                               • sub-investigator.yaml
                                                                               • sub-validator.yaml
```

---

## 2. Granular Category Breakdown

### Category A: Host Platform Wrappers (6 Files)

These files do not define agent personas. Instead, they define host orchestration parameters, model strings, thinking effort budgets, scheduler crons, and tool bindings:

| File                                                                                           |  Canonical Host?   | Model Mapping (Supervisory / Worker)     | Thinking Level | Status & Invariant Notes                                                                                                         |
| :--------------------------------------------------------------------------------------------- | :----------------: | :--------------------------------------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| [`antigravity.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/antigravity.yaml) |      **Yes**       | `gemini-3.7-flash` / `gemini-3.7-flash`  | High / Medium  | **Canonical Host 1**. 5m scheduler (`*/5 * * * *`). Uses `invoke_subagent` and `send_message`.                                   |
| [`claude.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/claude.yaml)           |      **Yes**       | `claude-5-opus` / `claude-5-sonnet`      | High / Medium  | **Canonical Host 2**. 15m scheduler (`*/15 * * * *`). Uses `Agent` tool and `SendMessage`.                                       |
| [`codex.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/codex.yaml)             |      **Yes**       | `gpt-5.6-sol` / `gpt-5.6-terra`          | High / Medium  | **Canonical Host 3**. 15m scheduler (`*/15 * * * *`). Uses `spawn_agent` and `send_message`.                                     |
| [`cursor.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/cursor.yaml)           |      **Yes**       | `cursor-latest` / `cursor-latest`        | High / Medium  | **Canonical Host 4**. 5m scheduler (`*/5 * * * *`). Uses `Task` tool and `terminal`.                                             |
| [`generic.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/generic.yaml)         | **No (Violation)** | `generic-supervisory` / `generic-worker` | High / Medium  | **Violation of AGENTS.md §31** ("Generic fallback models, heuristic fallbacks, and speculative aliases are strictly forbidden"). |
| [`openai.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/openai.yaml)           | **No (Duplicate)** | `gpt-5.6-sol` / `gpt-5.6-terra`          | High / Medium  | **Redundant duplicate of `codex.yaml`**. Mixes OpenAI multi-agent harness with Codex. Retains obsolete ChatGPT aliases.          |

### Category B: Core Active Personas (8 Files)

These 8 YAMLs constitute the active operational spine of the repository:

| File                                                                                                           | Tier | Role Name             | Subagents? |   Write Tools?   | Key Responsibility & Alignment                                                                                            |
| :------------------------------------------------------------------------------------------------------------- | :--: | :-------------------- | :--------: | :--------------: | :------------------------------------------------------------------------------------------------------------------------ |
| [`mind.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mind.yaml)                               |  0   | `mind`                |    True    | **True (Drift)** | Autonomous Product Owner & Strategist, 3-Step Self-Evolution flow. Erroneously holds `enable_write_tools: true`.          |
| [`mind-auditor.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mind-auditor.yaml)               |  0   | `mind-auditor`        |   False    |      False       | Out-of-band liveness & anti-stagnation companion (120s idle trap elimination, natural Socratic critique).                 |
| [`skill-auditor.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/skill-auditor.yaml)             |  0   | `skill-auditor`       |   False    |      False       | Out-of-band fleet auditor (1m tracking, deep behavioral forensics `meta-audit`, autonomous queue injection `--inject`).   |
| [`orchestrator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml)               |  1   | `orchestrator`        |    True    | **True (Drift)** | Multi-round capsule chaining, convergence governance, defect fan-in synthesis. Erroneously holds write tools.             |
| [`coordinator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml)                 |  2   | `coordinator`         |    True    | **True (Drift)** | Dynamic wave dispatch, 1-shot exact-anchor briefings (`task:brief`), hard resets. Overloaded with git plumbing.           |
| [`implementer.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml)                 |  3   | `implementer`         |   False    |       True       | Leased task implementation within disjoint write scope; Turn 1 exact edits; file-scoped unit testing (`bun test <file>`). |
| [`validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/validator.yaml)                     |  3   | `validator`           |   False    |      False       | Cognitive Socratic reviewer. Strictly locked out of command execution (0 `run:exec`, `can_execute_shell: false`).         |
| [`completeness-critic.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/completeness-critic.yaml) |  3   | `completeness-critic` |   False    |      False       | Whole-run prompt compliance judge against original prompt bytes and Canonical 8-Level Plan Architecture.                  |

### Category C: Legacy, Overlapping, and Retired Roles (8 Files)

These 8 YAMLs cause cognitive ambiguity, violate zero-backwards-compatibility, and must be permanently purged:

| File                                                                                                               | Tier | Declared Role           | Target Canonical Role          | Rationale for Immediate Retirement                                                                                             |
| :----------------------------------------------------------------------------------------------------------------- | :--: | :---------------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| [`worker.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/worker.yaml)                               |  3   | `implementer`           | `implementer.yaml`             | 100% duplicate of `implementer.yaml` (identical tools/commands, only lacks `queue:pop`). Violates §36.                         |
| [`critic.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/critic.yaml)                               |  3   | `completeness-critic`   | `completeness-critic.yaml`     | Duplicate of `completeness-critic.yaml`. Same role name, same commands. Violates §36.                                          |
| [`repairer.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/repairer.yaml)                           |  3   | `repairer`              | `implementer.yaml` (in-lease)  | **Permanently retired by AGENTS.md §26**. Repairs are executed in-lease via `task:reject --in-lease`. Lingering dead manifest. |
| [`mechanic-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mechanic-validator.yaml)       |  3   | `mechanic-validator`    | Deterministic CLI `task:check` | **Permanently retired by AGENTS.md §26**. Typechecks and AST audits are anchored in `task:check`. LLM subagent is obsolete.    |
| [`ui-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-validator.yaml)                   |  3   | `ui-validator`          | `ui-optical-validator.yaml`    | Duplicate optical cognitive validator. Redundant with `ui-optical-validator.yaml`.                                             |
| [`ui-visual-reviewer.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-visual-reviewer.yaml)       |  3   | `ui-visual-reviewer`    | `ui-optical-validator.yaml`    | Duplicate visual reviewer with identical 16 commands. Redundant with `ui-optical-validator.yaml`.                              |
| [`ui-mechanic-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-mechanic-validator.yaml) |  3   | `ui-mechanic-validator` | `ui-headless-validator.yaml`   | Overlaps with `ui-headless-validator` and Playwright test suites. Has write tools enabled, which violates validator contracts! |
| [`ui-debugger.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-debugger.yaml)                     |  3   | `ui-debugger`           | `implementer.yaml` / CLI       | Narrow diagnostics role with 20 commands. Obsolete; debugging is handled by Implementers using `scratch/`.                     |

### Category D: Domain-Specific, Planning, and Branch Child Roles (11 Files)

These 11 YAMLs fulfill specialized, lifecycle-specific functions:

| File                                                                                                                       |    Tier     | Role Name                   | Subagents? | Write Tools? | Architectural Function                                                                                                                                  |
| :------------------------------------------------------------------------------------------------------------------------- | :---------: | :-------------------------- | :--------: | :----------: | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ui-headless-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-headless-validator.yaml)         |      3      | `ui-headless-validator`     |   False    |    False     | **Canonical UI Mechanic Validator**: Automated Playwright runs, DOM hitbox floors ($\ge 44\text{pt}$), 4-viewport capture into `evidence/screenshots/`. |
| [`ui-optical-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-optical-validator.yaml)           |      3      | `ui-optical-validator`      |   False    |    False     | **Canonical UI Cognitive Validator**: Mandatory headful screenshot review (`view_file`), 8 Optical Dimensions, APCA contrast, theme harmony.            |
| [`owner.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/owner.yaml)                                         | independent | `owner`                     |    True    |     True     | Genesis Authority & Human Operator proxy. Authorizes initial bootstrapping, mind admission, and fatal recovery.                                         |
| [`independent-planner.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/independent-planner.yaml)             | independent | `independent-planner`       |   False    |    False     | Pre-run conceptual visionary. Formulates pure-English blueprints and 8-vector architectures decoupled from code.                                        |
| [`independent-planner-audit.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/independent-planner-audit.yaml) | independent | `independent-planner-audit` |   False    |    False     | Pure-English devil's advocate auditing conceptual elegance and architectural robustness before code planning.                                           |
| [`planner.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/planner.yaml)                                     |      3      | `planner`                   |   False    |    False     | In-run operational task decomposition, compiling prompt bytes into DAG tasks and gate definitions.                                                      |
| [`plan-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/plan-validator.yaml)                       |      3      | `plan-validator`            |   False    |    False     | In-run compiled DAG topology validator, verifying disjoint write scopes, dependency acyclicity, and test gate parity.                                   |
| [`policy-discovery.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/policy-discovery.yaml)                   |      0      | `policy-discovery`          |   False    |     True     | Cold-start toolchain discovery. _(Note: Should be converted to pure deterministic CLI `policy:init`)_.                                                  |
| [`sub-implementer.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/sub-implementer.yaml)                     |      3      | `sub-implementer`           |   False    |     True     | Branch child spawned by Implementer for narrow sub-scope tasks confined to parent's write scope.                                                        |
| [`sub-investigator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/sub-investigator.yaml)                   |      3      | `sub-investigator`          |   False    |    False     | Branch child spawned by Implementer for read-only root-cause diagnosis without write permissions.                                                       |
| [`sub-validator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/sub-validator.yaml)                         |      3      | `sub-validator`             |   False    |    False     | Branch child spawned by Validator to generate and capture durable command evidence without rendering verdicts.                                          |

---

## 3. Comprehensive Manifest Audit Matrix (All 33 Files)

|  #  | Filename                         | Tier  | Declared Role               |  Write Tools   | Subagent Spawns                           | Command Count | Target Action                                   |
| :-: | :------------------------------- | :---: | :-------------------------- | :------------: | :---------------------------------------- | :-----------: | :---------------------------------------------- |
|  1  | `antigravity.yaml`               |   -   | Platform Host               |       -        | `invoke_subagent`                         |       0       | **Retain** (Canonical Host)                     |
|  2  | `claude.yaml`                    |   -   | Platform Host               |       -        | `Agent`                                   |       0       | **Retain** (Canonical Host)                     |
|  3  | `codex.yaml`                     |   -   | Platform Host               |       -        | `spawn_agent`                             |       0       | **Retain** (Canonical Host)                     |
|  4  | `completeness-critic.yaml`       |   3   | `completeness-critic`       |     False      | None                                      |      17       | **Retain** (Canonical Golden Role)              |
|  5  | `coordinator.yaml`               |   2   | `coordinator`               | **True (Fix)** | Implementer, Validator, Critic, Publisher |      42       | **Harden** (Revoke write & git tools)           |
|  6  | `critic.yaml`                    |   3   | `completeness-critic`       |     False      | None                                      |      17       | **Delete** (Duplicate of `completeness-critic`) |
|  7  | `cursor.yaml`                    |   -   | Platform Host               |       -        | `Task`                                    |       0       | **Retain** (Canonical Host)                     |
|  8  | `generic.yaml`                   |   -   | Platform Host               |       -        | Subprocess                                |       0       | **Delete** (Violates §31 Generic Ban)           |
|  9  | `implementer.yaml`               |   3   | `implementer`               |      True      | Sub-implementer, Sub-investigator         |      22       | **Retain** (Canonical Golden Role)              |
| 10  | `independent-planner-audit.yaml` | indep | `independent-planner-audit` |     False      | None                                      |       3       | **Retain** (Genesis Socratic Audit)             |
| 11  | `independent-planner.yaml`       | indep | `independent-planner`       |     False      | None                                      |       3       | **Retain** (Genesis Conceptual Planner)         |
| 12  | `mechanic-validator.yaml`        |   3   | `mechanic-validator`        |     False      | Sub-validator                             |      20       | **Delete** (Retired by §26 -> `task:check`)     |
| 13  | `mind-auditor.yaml`              |   0   | `mind-auditor`              |     False      | None                                      |       7       | **Retain** (Canonical Companion Auditor)        |
| 14  | `mind.yaml`                      |   0   | `mind`                      | **True (Fix)** | Orchestrator                              |      37       | **Harden** (Revoke write tools)                 |
| 15  | `openai.yaml`                    |   -   | Platform Host               |       -        | `spawn_agent`                             |       0       | **Delete** (Duplicate of `codex.yaml`)          |
| 16  | `orchestrator.yaml`              |   1   | `orchestrator`              | **True (Fix)** | Coordinator                               |      30       | **Harden** (Revoke write tools)                 |
| 17  | `owner.yaml`                     | indep | `owner`                     |      True      | Mind, Orchestrator, Coordinator           |      10       | **Retain** (Genesis Authority)                  |
| 18  | `plan-validator.yaml`            |   3   | `plan-validator`            |     False      | None                                      |      11       | **Retain** (Compiled DAG Auditor)               |
| 19  | `planner.yaml`                   |   3   | `planner`                   |     False      | None                                      |      14       | **Retain** (In-Run Task Decomposer)             |
| 20  | `policy-discovery.yaml`          |   0   | `policy-discovery`          |      True      | None                                      |      14       | **Retire to CLI** (`policy:init`)               |
| 21  | `repairer.yaml`                  |   3   | `repairer`                  |      True      | None                                      |      18       | **Delete** (Retired by §26 -> in-lease)         |
| 22  | `skill-auditor.yaml`             |   0   | `skill-auditor`             |     False      | None                                      |      11       | **Retain** (Canonical Fleet Auditor)            |
| 23  | `sub-implementer.yaml`           |   3   | `sub-implementer`           |      True      | None                                      |      16       | **Retain** (Branch Child)                       |
| 24  | `sub-investigator.yaml`          |   3   | `sub-investigator`          |     False      | None                                      |      12       | **Retain** (Branch Child)                       |
| 25  | `sub-validator.yaml`             |   3   | `sub-validator`             |     False      | None                                      |      12       | **Retain** (Branch Child)                       |
| 26  | `ui-debugger.yaml`               |   3   | `ui-debugger`               |     False      | None                                      |      20       | **Delete** (Overlapping & Obsolete)             |
| 27  | `ui-headless-validator.yaml`     |   3   | `ui-headless-validator`     |     False      | None                                      |      20       | **Retain** (Canonical UI Mechanic)              |
| 28  | `ui-mechanic-validator.yaml`     |   3   | `ui-mechanic-validator`     |      True      | Sub-validator                             |      20       | **Delete** (Redundant & Violates RBAC)          |
| 29  | `ui-optical-validator.yaml`      |   3   | `ui-optical-validator`      |     False      | Sub-validator                             |      16       | **Retain** (Canonical UI Cognitive)             |
| 30  | `ui-validator.yaml`              |   3   | `ui-validator`              |     False      | Sub-validator                             |      16       | **Delete** (Duplicate of `ui-optical-val`)      |
| 31  | `ui-visual-reviewer.yaml`        |   3   | `ui-visual-reviewer`        |     False      | Sub-validator                             |      16       | **Delete** (Duplicate of `ui-optical-val`)      |
| 32  | `validator.yaml`                 |   3   | `validator`                 |     False      | Sub-validator                             |      16       | **Retain** (Canonical Golden Role)              |
| 33  | `worker.yaml`                    |   3   | `implementer`               |      True      | Sub-implementer, Sub-investigator         |      22       | **Delete** (Duplicate of `implementer`)         |

---

## 4. Key Findings & Drift Diagnoses

1. **Manifest File Directory Confusion**: Host platform wrappers (`antigravity.yaml`, etc.) reside in the same directory (`olt/agents/`) as agent personas (`mind.yaml`, etc.), confusing role reflection engines and RBAC parsers.
2. **Permission Contradictions**: Supervisors have `enable_write_tools: true` in their YAML manifests, directly conflicting with their textual `must_not` clauses.
3. **Ghost Roles in Fleet Matrix**: Several retired manifests still have lingering references in [fleet/archetypes.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/agents/fleet/archetypes.ts) (`autonomous-repairer`, `general-task-worker`, etc.), preventing complete code pruning.
