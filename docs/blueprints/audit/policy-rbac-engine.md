# Authority & Policy Lead Audit Blueprint: RBAC Engine

## 1. Exact Findings Count

**Total Things to Look For:** 8

## 2. Call Graph & State Transition Trace

- `verifyCommandAuthorization(actor, command, policy)` -> (Entry Point) Central RBAC gate.
  - -> `hasUnshieldedSubshellOrChaining(commandStr, argv)`
  - -> `inferCanExecuteShell(role)`
  - -> `isUntargetedTestCommand(commandStr, argv, policy)`
    - -> `isTargetTestArgument(token)`
  - -> `compileEffectiveForbiddenPatterns(role, policy)`

## 3. Native Host Tool Interaction

- Acts as the primary enforcement layer for `run:exec` and the harness shell.
- Enforces the Cognitive Validator Hard-Lock (0 commands allowed for validators).

## 4. Edge Cases, Failure Vectors & LLM Friction Points

1. **L133-L134**: The `subshellBinaries` check only looks at exact binary names like `bash` or `sh`. An agent executing `/bin/bash` or `/usr/bin/env bash` completely bypasses the subshell lock.
2. **L150-L153**: Evaluator detection (`node -e`, `python -c`) has the same absolute path bypass vulnerability (e.g., `/usr/local/bin/node -e`).
3. **L177**: Command chaining detection (`&&`, `||`, `;`, `|`) relies on naive argument arrays. Quote boundaries might obfuscate chaining from the engine if the runner splits args differently.
4. **L202**: `isTargetTestArgument` handles `./...` and `.` but misses standard wildcards like `*` and `**/*`, potentially marking a broad wildcard run as "targeted".
5. **L274**: `isUntargetedTestCommand` relies heavily on predefined flags in `KNOWN_TEST_RUNNERS`. Unrecognized target flags (like `--filter` in certain runners) cause false positives, blocking valid test runs.
6. **L348-L358 & L441-L451**: `compileEffectiveForbiddenPatterns` and `verifyCommandAuthorization` duplicate the role regex strings (`validator`, `sub-investigator`, etc.). This causes drifting logic if one is updated but not the other.
7. **L351**: The `normalizedRole.startsWith("validator-")` regex is too greedy and could capture user-defined hybrid roles that aren't strict cognitive validators.
8. **L429-L434**: `can_execute_shell` fallback logic is messy. It tries to duck-type the `actor` object instead of using a strict discriminated union interface.

## 5. TypeScript Refactoring Blueprints & Simplification Proposals

- **Path-Agnostic Matching**: Use `basename(argv[0])` for all subshell and evaluator checks to prevent absolute path bypasses.
- **Unified Role Definitions**: Extract the role strings (e.g., `isCognitiveValidator`) into a shared utility function used by both pattern compilation and authorization.
- **Shell-Quote Parsing**: Implement a lightweight AST or quote-aware tokenizer for `commandStr` instead of relying solely on `argv` splits to reliably catch hidden command chaining.

---

### Additional Findings Note

Additional findings mapped during analysis:

- `permission-health.ts`: 3 findings (brittle NLP checks, incomplete spawns validation).
- `naming.ts`: 4 findings (regex duplication, fallback divergence).
- `agent-triad.ts`: 5 findings (O(N) IO scans, silent phantom agent synthesis).
