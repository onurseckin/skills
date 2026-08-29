# Harness Error Codes & Structured Payloads

[Reference Home](../index.md) > [Error Dictionary](./index.md) > Harness Error Codes & Payloads

---

[⏮️ Previous: Exit Status Hierarchy](16-01-exit-status-hierarchy.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 28 Empirical Blunders](16-03-twenty-eight-empirical-blunders.md)
---

The **Open Loop Task (OLT) Harness** provides structured, machine-readable error reporting. Every non-zero exit condition produces a typed payload that explicitly identifies the failure classification, provides human-readable context, enumerates diagnostic issues, and delivers copy-pasteable remediation commands.

---

## 📜 1. Formal JSON Error Schema (Draft 2020-12)

When invoked with `--format json` or executed in automated subagent mode, all harness errors emitted to `stderr` strictly validate against the following JSON Schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://olt.dev/schemas/v1/harness-error.json",
  "title": "HarnessErrorPayload",
  "description": "Deterministic error payload emitted to stderr on non-zero exit codes.",
  "type": "object",
  "required": ["ok", "error"],
  "additionalProperties": false,
  "properties": {
    "ok": {
      "type": "boolean",
      "const": false,
      "description": "Always false for error payloads."
    },
    "error": {
      "type": "object",
      "required": ["code", "message", "exit_code", "issues", "footer"],
      "additionalProperties": false,
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "AUTHENTICATION_FAILURE",
            "INTEGRITY",
            "INVALID_ARGUMENT",
            "INVALID_STATE",
            "LOCK_TIMEOUT",
            "NOT_FOUND",
            "NOT_IMPLEMENTED",
            "PATH_SAFETY",
            "ROLE_CONFINEMENT_VIOLATION",
            "UNSUPPORTED_HOST",
            "UNSUPPORTED_PLATFORM",
            "INTERNAL"
          ],
          "description": "The canonical machine-readable error code."
        },
        "message": {
          "type": "string",
          "description": "Exhaustive human- and agent-readable explanation of the failure."
        },
        "exit_code": {
          "type": "integer",
          "enum": [3, 4, 70],
          "description": "POSIX process exit code matching the error classification."
        },
        "issues": {
          "type": "array",
          "description": "Structured diagnostics, schema discrepancies, unproven requirements, or path mismatches.",
          "items": {
            "type": ["object", "string", "number"]
          }
        },
        "fix": {
          "type": "string",
          "description": "Actionable, copy-pasteable remediation command or instructions to correct state."
        },
        "repair_argv": {
          "type": "array",
          "description": "Precise CLI command argument vector to automatically repair the failure.",
          "items": { "type": "string" }
        },
        "footer": {
          "type": "string",
          "description": "Canonical documentation pointer (e.g. 'never read the harness source; run `harness.ts explain <CODE>`')."
        }
      }
    }
  }
}
```

---

## 🛡️ 2. The 12 Canonical HarnessError Codes

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HARNESS ERROR CODE TAXONOMY                                    │
├────────────────────────────────┬────────────────────────────────┬────────────────────────────────┤
│  CLI & ARGUMENT ERRORS         │  LIFECYCLE & STATE ERRORS      │  FILESYSTEM & HOST ERRORS      │
│  • INVALID_ARGUMENT (Exit 3)   │  • INVALID_STATE (Exit 3)      │  • PATH_SAFETY (Exit 3)        │
│  • NOT_FOUND (Exit 3)          │  • ROLE_CONFINEMENT (Exit 3)   │  • LOCK_TIMEOUT (Exit 4)       │
│                                │  • AUTHENTICATION (Exit 3)     │  • UNSUPPORTED_PLATFORM (Ex 3) │
│                                │  • INTEGRITY (Exit 3)          │  • UNSUPPORTED_HOST (Exit 3)   │
├────────────────────────────────┴────────────────────────────────┴────────────────────────────────┤
│  ENGINE & RUNTIME ERRORS                                                                         │
│  • NOT_IMPLEMENTED (Exit 70)                                                                     │
│  • INTERNAL (Exit 70)                                                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 1. `INVALID_ARGUMENT` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/cli/options.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/options.ts), [`olt/scripts/src/cli/arguments.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/arguments.ts)
- **Description**: Rejects malformed CLI flags, unrecognized options, missing mandatory arguments, schema violations in passed JSON files, or numerical values violating range bounds.
- **Issues Schema**:
  ```json
  {
    "field": "string (name of flag or option)",
    "reason": "string (violation reason)",
    "value": "any (received invalid value)",
    "allowed_values": ["array of valid values (optional)"],
    "min": "number (optional)",
    "max": "number (optional)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "option '--lease-seconds' value 3 is out of range: must be between 5 and 86400 seconds",
    "exit_code": 3,
    "issues": [
      {
        "field": "--lease-seconds",
        "reason": "value_below_minimum",
        "value": 3,
        "min": 5,
        "max": 86400
      }
    ],
    "fix": "Pass a valid lease duration: 'bun harness.ts task:claim --task task-01 --lease-seconds 300'.",
    "repair_argv": ["task:claim", "--task", "task-01", "--lease-seconds", "300"],
    "footer": "never read the harness source; run `harness.ts help task:claim` or `harness.ts explain INVALID_ARGUMENT`."
  }
}
```

---

### 2. `INVALID_STATE` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/workflow/lease/`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/workflow/lease/), [`olt/scripts/src/workflow/review/`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/workflow/review/)
- **Description**: State machine invariant violation. Thrown when attempting an illegal lifecycle transition, submitting an unleased task, claiming an already active task, or approving review without required adversarial probes or open finding resolutions.
- **Issues Schema**:
  ```json
  {
    "field": "string (state path)",
    "current_status": "string",
    "required_status": "string",
    "task_id": "string (optional)",
    "open_finding_id": "string (optional)",
    "probe_round": "number (optional)",
    "expected_minimum": "number (optional)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "cannot pass task-jwt: 0 adversarial probe(s) recorded, 1 required; run task:probe first",
    "exit_code": 3,
    "issues": [
      {
        "field": "tasks.task-jwt.probe_round",
        "expected_minimum": 1,
        "actual": 0
      }
    ],
    "fix": "File an adversarial probe demand with 'bun harness.ts task:probe --task task-jwt --demand \"<assertion>\"' before passing.",
    "repair_argv": [
      "task:probe",
      "--task",
      "task-jwt",
      "--demand",
      "Verify token expiration with skewed system clock"
    ],
    "footer": "never read the harness source; run `harness.ts help task:probe` or `harness.ts explain INVALID_STATE`."
  }
}
```

---

### 3. `INTEGRITY` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/engine/store/events/`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/store/events/), [`olt/scripts/src/packets/`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/)
- **Description**: Cryptographic Merkle chain divergence, corrupted event log, cyclic plan dependencies ($A \to B \to A$), or file tree hash instability (TOCTOU race condition).
- **Issues Schema**:
  ```json
  {
    "component": "string (events.jsonl | state.json | requirements.json | plan_graph)",
    "expected_hash": "string (SHA-256)",
    "actual_hash": "string (SHA-256)",
    "cycle_path": ["array of task IDs in cyclic dependency (optional)"],
    "file_path": "string (optional)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "INTEGRITY",
    "message": "event journal Merkle chain broken at sequence 42: calculated hash does not match next event previous_hash",
    "exit_code": 3,
    "issues": [
      {
        "component": "events.jsonl",
        "sequence": 42,
        "expected_previous_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "actual_previous_hash": "9f82a17b28c31e948f72a501a349bc125438ef902b189a74c2057398115629da"
      }
    ],
    "fix": "Reconstruct and verify state journal using 'bun harness.ts doctor --run .olt/capsules/auth-v1 --repair'.",
    "repair_argv": ["doctor", "--run", ".olt/capsules/auth-v1", "--repair"],
    "footer": "never read the harness source; run `harness.ts explain INTEGRITY`."
  }
}
```

---

### 4. `PATH_SAFETY` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/engine/runner/core/policy.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/core/policy.ts), [`olt/scripts/src/authority/root-hygiene-guard.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/root-hygiene-guard.ts)
- **Description**: Filesystem confinement boundary breach. Triggered when path arguments escape the run root, touch files outside declared task write scope, traverse symbolic links, or dirty the repository root.
- **Issues Schema**:
  ```json
  {
    "unauthorized_path": "string",
    "declared_write_scope": ["array of glob patterns"],
    "reason": "string (root_escape | symlink_forbidden | outside_write_scope | dirty_root)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "PATH_SAFETY",
    "message": "task task-billing touched files outside its declared write scope: [src/shared/database.ts]. Leased scope is strictly confined to [src/billing/**].",
    "exit_code": 3,
    "issues": [
      {
        "unauthorized_path": "src/shared/database.ts",
        "declared_write_scope": ["src/billing/**"],
        "reason": "outside_write_scope"
      }
    ],
    "fix": "Revert unauthorized file modifications with 'git checkout src/shared/database.ts' or expand scope via 'plan:replan'.",
    "repair_argv": ["git", "checkout", "src/shared/database.ts"],
    "footer": "never read the harness source; run `harness.ts help task:submit` or `harness.ts explain PATH_SAFETY`."
  }
}
```

---

### 5. `ROLE_CONFINEMENT_VIOLATION` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/authority/persona/eval-invariants.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/persona/eval-invariants.ts), [`olt/scripts/src/packets/command-authority.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority.ts)
- **Description**: Role-Based Access Control (RBAC) boundary breach. Thrown when a supervisory Tier attempts worker mutations (e.g. Tier 1 Mind directly editing code or claiming tasks) or a cognitive reviewer attempts command execution.
- **Issues Schema**:
  ```json
  {
    "role": "string",
    "tier": "number (1 | 2 | 3)",
    "attempted_verb": "string",
    "allowed_verbs": ["array of granted verbs"]
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "ROLE_CONFINEMENT_VIOLATION",
    "message": "role 'orchestrator' (Tier 1) is strictly prohibited from invoking 'task:claim'; supervisors cannot directly claim tasks or edit files",
    "exit_code": 3,
    "issues": [
      {
        "role": "orchestrator",
        "tier": 1,
        "attempted_verb": "task:claim",
        "allowed_verbs": ["plan:*", "queue:wave", "critic:*", "doctor", "recover"]
      }
    ],
    "fix": "Spawn a Tier 3 implementer subagent to claim and execute the task.",
    "footer": "never read the harness source; run `harness.ts role:cheat-sheet orchestrator` or `harness.ts explain ROLE_CONFINEMENT_VIOLATION`."
  }
}
```

---

### 6. `AUTHENTICATION_FAILURE` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/authority/session/resolver.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/session/resolver.ts), [`olt/scripts/src/authority/session/grants.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/session/grants.ts)
- **Description**: Bearer token authentication failure. Thrown when an agent attempts to submit, release, or review a task using an invalid, expired, or spoofed session token.
- **Issues Schema**:
  ```json
  {
    "actor": "string",
    "token_provided": "string (redacted digest)",
    "failure_reason": "string (invalid_signature | expired | token_mismatch)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "AUTHENTICATION_FAILURE",
    "message": "bearer token provided does not match active leaseholder 'implementer-auth-01' on task 'task-login'",
    "exit_code": 3,
    "issues": [
      {
        "actor": "implementer-auth-02",
        "failure_reason": "token_mismatch"
      }
    ],
    "fix": "Pass the matching bearer token issued during 'task:claim' or reclaim lease via 'task:release'.",
    "footer": "never read the harness source; run `harness.ts explain AUTHENTICATION_FAILURE`."
  }
}
```

---

### 7. `UNSUPPORTED_HOST` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/platform/host-autodetect.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/platform/host-autodetect.ts)
- **Description**: Host environment signature detection failure. Thrown when OLT cannot identify the host environment among canonical supported profiles (`antigravity`, `claude_code`, `codex`, `cursor`) without generic fallback.
- **Issues Schema**:
  ```json
  {
    "detected_env": "string",
    "supported_hosts": ["antigravity", "claude_code", "codex", "cursor"]
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_HOST",
    "message": "unable to detect host runtime profile; no matching signature for antigravity, claude_code, codex, or cursor",
    "exit_code": 3,
    "issues": [
      {
        "detected_env": "unknown_headless_ci",
        "supported_hosts": ["antigravity", "claude_code", "codex", "cursor"]
      }
    ],
    "fix": "Export host profile explicitly: 'export OLT_HOST_OVERRIDE=antigravity'.",
    "footer": "never read the harness source; run `harness.ts explain UNSUPPORTED_HOST`."
  }
}
```

---

### 8. `UNSUPPORTED_PLATFORM` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/platform/process/run-lock.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/platform/process/run-lock.ts)
- **Description**: Operating system or runtime architecture incompatibility. Thrown when executing on an OS lacking required POSIX kernel primitives (`flock`, process groups, `renameat2`) or missing dynamic libc bindings.
- **Issues Schema**:
  ```json
  {
    "platform": "string (e.g. win32)",
    "architecture": "string",
    "missing_primitives": ["flock", "process_groups"]
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_PLATFORM",
    "message": "operating system 'win32' is not supported; OLT requires Darwin (macOS) or Linux with POSIX kernel advisory flock",
    "exit_code": 3,
    "issues": [
      {
        "platform": "win32",
        "architecture": "x64",
        "missing_primitives": ["POSIX flock", "libc fdatasync"]
      }
    ],
    "fix": "Execute within WSL2 (Windows Subsystem for Linux) or a Linux container environment.",
    "footer": "never read the harness source; run `harness.ts explain UNSUPPORTED_PLATFORM`."
  }
}
```

---

### 9. `LOCK_TIMEOUT` (Exit Code 4)

- **Source Reference**: [`olt/scripts/src/platform/process/run-lock.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/platform/process/run-lock.ts#L30-L75)
- **Description**: Kernel advisory lock contention timeout. Thrown when a process fails to acquire exclusive ownership of `.olt/capsules/<slug>/state.json` within the $5000\text{ ms}$ acquisition window.
- **Issues Schema**:
  ```json
  {
    "lock_target": "string (filesystem path)",
    "timeout_ms": 5000,
    "active_holder_pid": "number (optional)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "LOCK_TIMEOUT",
    "message": "Timed out after 5000ms waiting for exclusive run lock: .olt/capsules/core-engine/state.json. Another process holds the kernel lock.",
    "exit_code": 4,
    "issues": [
      {
        "lock_target": "/workspace/.olt/capsules/core-engine/state.json",
        "timeout_ms": 5000,
        "active_holder_pid": 48291
      }
    ],
    "fix": "Verify whether background processes or subagents are hung with 'bun harness.ts recover --run .olt/capsules/core-engine'.",
    "repair_argv": ["recover", "--run", ".olt/capsules/core-engine"],
    "footer": "never read the harness source; run `harness.ts explain LOCK_TIMEOUT`."
  }
}
```

---

### 10. `NOT_FOUND` (Exit Code 3)

- **Source Reference**: [`olt/scripts/src/cli/options.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/options.ts)
- **Description**: Entity resolution failure. Thrown when a referenced capsule run, task identifier, command receipt ID, or requirement ID does not exist in active storage.
- **Issues Schema**:
  ```json
  {
    "entity_type": "string (run | task | gate | command_receipt | requirement)",
    "entity_id": "string",
    "search_path": "string (optional)"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "task 'task-auth-token' does not exist in capsule run '.olt/capsules/auth-v1'",
    "exit_code": 3,
    "issues": [
      {
        "entity_type": "task",
        "entity_id": "task-auth-token",
        "search_path": ".olt/capsules/auth-v1/state.json"
      }
    ],
    "fix": "List all available tasks in the active run with 'bun harness.ts queue:list --run .olt/capsules/auth-v1'.",
    "repair_argv": ["queue:list", "--run", ".olt/capsules/auth-v1"],
    "footer": "never read the harness source; run `harness.ts explain NOT_FOUND`."
  }
}
```

---

### 11. `NOT_IMPLEMENTED` (Exit Code 70)

- **Source Reference**: [`olt/scripts/src/graph/gate-proof.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/gate-proof.ts), [`olt/scripts/src/cli/execute.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/execute.ts)
- **Description**: Unsupported operation or feature variant. Thrown when a valid command verb is invoked with an unsupported storage or filesystem mode (e.g. attempting `gate:prove` across symbolic link write scopes).
- **Issues Schema**:
  ```json
  {
    "feature": "string",
    "unsupported_mode": "string",
    "supported_alternatives": ["array of supported options"]
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "gate:prove does not support write scopes containing symbolic links or Git submodules; scratch-copy rollback cannot guarantee bitwise reversion",
    "exit_code": 70,
    "issues": [
      {
        "feature": "gate:prove",
        "unsupported_mode": "symlink_scope",
        "path": "src/vendor/libsym.so"
      }
    ],
    "fix": "Exclude symbolic links from task write scope or perform gate validation manually.",
    "footer": "never read the harness source; run `harness.ts explain NOT_IMPLEMENTED`."
  }
}
```

---

### 12. `INTERNAL` (Exit Code 70)

- **Source Reference**: [`olt/scripts/src/core/errors/normalize-error.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/errors/normalize-error.ts)
- **Description**: Unhandled JavaScript runtime crash, engine panic, or memory exhaustion. All uncaught exceptions are trapped by `normalizeError()` to ensure valid structured JSON is emitted to `stderr`.
- **Issues Schema**:
  ```json
  {
    "exception_type": "string (e.g. RangeError, TypeError)",
    "stack_top": "string"
  }
  ```

#### Verbatim Payload Exemplar

```json
{
  "ok": false,
  "error": {
    "code": "INTERNAL",
    "message": "JavaScript runtime panic: V8 memory heap exhausted during large AST parsing",
    "exit_code": 70,
    "issues": [
      {
        "exception_type": "RangeError",
        "stack_top": "at ASTParser.parseTree (src/linter/ast-linter.ts:142:18)"
      }
    ],
    "footer": "never read the harness source; run `harness.ts explain INTERNAL`."
  }
}
```

---

[⏮️ Previous: Exit Status Hierarchy](16-01-exit-status-hierarchy.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 28 Empirical Blunders](16-03-twenty-eight-empirical-blunders.md)
---
