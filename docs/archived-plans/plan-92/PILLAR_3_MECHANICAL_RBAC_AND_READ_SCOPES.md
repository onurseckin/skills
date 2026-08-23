# Pillar 3: Hard-Coded Mechanical RBAC, Hybrid Deny-List & Universal Host-Agnostic Interlocks

**Directive Reference**: `p92`  
**Status**: 🔒 **LOCKED & READY FOR IMPLEMENTATION**  
**Location**: `docs/planning/plan-92/PILLAR_3_MECHANICAL_RBAC_AND_READ_SCOPES.md`

---

## 1. Problem Statement: Brittle Prompt Instructions & Host Fragmentation

1. **LLM Prompt Fragility**: Relying on markdown instructions (e.g. _"Do not run tests"_, _"Do not edit files"_) is vulnerable to context drift and hallucination.
2. **Brittle Allow-Lists**: Hard-coded allow-lists break standard developer workflows by blocking harmless diagnostic commands (`ls`, `grep`, `find`, `wc`, `cat`).
3. **Multi-Host Portability**: The system must run identically across **Antigravity CLI, Claude Code, Cursor, Codex, and raw POSIX terminals**.
4. **Token-Burning File Wandering**: Unbounded agents reading 50+ files burn massive token budgets before modifying 1 file.

---

## 2. Core Architecture: Hybrid Deny-List & Universal Host-Agnostic Interlocks

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                   UNIVERSAL HOST-AGNOSTIC ENFORCEMENT & HYBRID DENY-LIST ENGINE                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ STEP 1: Repository Capability Discovery (`olt/policy.json`) ]                                 │
│  • LLM discovers and writes `olt/policy.json` (runtime, test commands, typecheck, linters).      │
│  • Contains NO security clutter—purely functional repository capabilities.                       │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 2: The Hybrid Static + Dynamic Deny-List Compiler (`rbac-engine.ts`) ]                  │
│  • Compiles effective forbidden regexes for the active actor:                                    │
│    `EffectiveDenyList = StaticGlobalBaseline ∪ DynamicInjectedPolicyRules`                      │
│                                                                                                  │
│       Actor Role                 Forbidden Patterns (TypeScript RegExp)                          │
│       ─────────────────────────  ─────────────────────────────────────────────────────────────── │
│       Cognitive `validator`      `[/.*/]` (Matches EVERYTHING: 0 shell execution!)               │
│       `implementer`              `[/^git\s+(commit|push|reset)/, /^bun\s+harness.*task:review/]`│
│                                  ✚ Dynamic Policy Injections:                                    │
│                                    `[/^npm\s+test(\s+)?$/, /^pytest(\s+)?$/, /^cargo\s+test$/]`  │
│       Supervisors                `[/^git\s+(commit|push)/, /write_to_file/, /replace_file/]`     │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 3: The 4-Tier Universal Host-Agnostic Defense Pipeline ]                                 │
│  • Tier 1 (Host Hooks)         ==> Native `PreToolUse` in Antigravity & `.claude/hooks`.         │
│  • Tier 2 (PATH Shell Shim)    ==> Universal `.capsules/bin/` wrapper intercepting raw bash.     │
│  • Tier 3 (Auto-Mailbox)       ==> Regex watchdog injects 3-line error (0 parent tokens burned!).│
│  • Tier 4 (Receipt Gate)       ==> `task:submit` strictly requires signed harness receipts.      │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 4: Smart Neighborhood Read Scope & Dynamic Expansion ]                                   │
│  • Default Read Scope: Target file + direct directory neighborhood + shared types.               │
│  • Dynamic Expansion: `bun harness.ts scope:expand --actor <id> --read <new_file_path>`.         │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Target Implementation Files in Skill Monorepo

| Target File Path                                                    | Planned Modifications & Responsibilities                                          |
| :------------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| `orchestrating-long-tasks/scripts/src/policy/repo-policy.ts`        | Parser, validator, and schema validator for `olt/policy.json`.                    |
| `orchestrating-long-tasks/scripts/src/policy/rbac-engine.ts`        | Hybrid static + dynamic deny-list compiler (`compileEffectiveForbiddenPatterns`). |
| `orchestrating-long-tasks/scripts/src/cli/commands/shell.ts`        | Mandatory `bun harness.ts shell --actor <id> -- <cmd>` execution gate.            |
| `orchestrating-long-tasks/scripts/src/runtime/agent-metadata.ts`    | Generates immutable `agent-<id>.json` capabilities masks on subagent spawn.       |
| `orchestrating-long-tasks/scripts/src/runtime/read-scope-guard.ts`  | Anti-wandering file ACL & `bun harness.ts scope:expand` handler.                  |
| `orchestrating-long-tasks/scripts/src/watchdog/transcript-regex.ts` | Script-driven regex watchdog for automated zero-parent-token intervention.        |
| `tests/unit/policy/rbac-engine.test.ts`                             | Comprehensive unit tests for hybrid static + dynamic deny-list compiler.          |
| `tests/unit/cli/shell-interlock.test.ts`                            | Unit tests verifying instant blocking of un-targeted whole-suite runs.            |

---

## 4. Structured Error Taxonomy for Course-Correction

```text
[PERMISSION_DENIED] Role 'validator' has 'can_execute_shell: false'.
Cognitive Validators are strictly prohibited from running commands.
Focus exclusively on Socratic diff review and logic critique.

[INVALID_SCOPE] Un-targeted whole-repo test run detected: 'npm test'.
Implementers are forbidden from running full test suites.
You must pass a targeted file argument matching: 'npm test -- {file}'.

[UNSHIELDED_COMMAND_BLUNDER] Direct shell command execution blocked.
All commands must be executed via: 'bun harness.ts shell --actor <agent_id> -- <command>'.

[READ_SCOPE_EXCEEDED] File '/unrelated/path.ts' is outside your declared neighborhood.
Focus on your assigned target files or declare access via:
'bun harness.ts scope:expand --actor <id> --read <path>'.
```
