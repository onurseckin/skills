# 02. Comprehensive CLI Command Reference & Architecture

[⬅ Previous: End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)

---

## ⚡ The Zero-JSON Colon Command Architecture

In multi-agent autonomous engineering, invoking CLI tools using large nested JSON payloads inside shell commands introduces severe fragility: shell quote escaping bugs, string concatenation errors, multiline parsing failures, and JSON syntax truncation.

To eliminate this class of failures, `olt` implements a **Zero-JSON Colon Command Architecture**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ZERO-JSON COLON CLI ARCHITECTURAL PARADIGM                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Traditional Fragile Model:                                                 │
│    $ tool --payload '{"action":"plan","tasks":[{"id":"t1","scope":"src"}]}' │
│      --> Shell escaping errors, multiline JSON breaks, untyped parsing.      │
│                                                                             │
│  olt Deterministic Zero-JSON Model:                                         │
│    $ bun harness.ts plan:add --run .capsules/<slug> --actor planner \       │
│        --id task-auth --label "Auth service" --scope src/auth \             │
│        --gate "bun test tests/auth.test.ts" --requirement-lines 1           │
│      --> Type-safe flat flags, atomic arguments, zero JSON quoting in shell │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core CLI Design Principles

1. **Flat Flag Grammars**: All configuration is passed via explicit, named CLI flags (e.g., `--task`, `--scope`, `--gate`, `--actor`).
2. **Dual-Format Output**:
   - **Markdown Briefs (Default)**: Human and LLM-readable terminal tables (max 30 lines) with prescriptive "Next Step" directives.
   - **Structured JSON (`--format json`)**: Clean, machine-parseable JSON envelopes on stdout for programmatic consumption.
3. **Strict Remainder Argument Boundary (`-- <argv>`)**: Literal verification and test commands are separated by `--` to prevent argument pollution.
4. **Digest-Only Token Persistence**: Bearer tokens are printed once to stdout; only SHA-256 digests are stored in state.

---

## 🧭 Global Flags & Execution Conventions

These rules apply across every command in the `olt` suite:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GLOBAL EXECUTION CONVENTIONS                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CAPSULE ROOT IDENTIFIER (--run)                                         │
│     Points to .capsules/<run-id>. Strips one optional '.capsules/' prefix.  │
│     Embedded path separators ('/') are strictly rejected.                   │
│                                                                             │
│  2. ACTOR AUDIT TRAIL (--actor)                                             │
│     Mandatory on all mutations. Zero defaults; unattributed work is barred. │
│                                                                             │
│  3. STRUCTURED JSON POSITIONING                                             │
│     --format json MUST appear BEFORE any '--' remainder separator:          │
│     ✓ bun harness.ts run:exec --format json --run .capsules/slug -- bun test│
│     ✗ bun harness.ts run:exec --run .capsules/slug -- bun test --format json│
│                                                                             │
│  4. BEARER TOKEN SECURITY                                                   │
│     Tokens are issued on stdout. Never written to logs or event chains.     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Standard Exit Code Specification

| Exit Code | Classification                | System Meaning & Recovery Action                                                                                      |
| :-------: | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
|  **`0`**  | `SUCCESS`                     | Command executed successfully. State transition committed and hash-chained.                                           |
|  **`3`**  | `INTEGRITY_OR_ARGUMENT_ERROR` | Validation failure (`INVALID_ARGUMENT`, `INVALID_STATE`, `INTEGRITY`, `PATH_SAFETY`). Rejected before state mutation. |
|  **`4`**  | `LOCK_TIMEOUT`                | Kernel `flock` acquisition timeout (5000ms). Concurrent writer held the lock.                                         |
| **`70`**  | `INTERNAL_OR_UNCLASSIFIED`    | Unclassified platform or system failure.                                                                              |

> **Exception (`run:exec`)**: `run:exec` exits `0` whenever the child process launched and completed, reporting the child's exit code inside the structured output envelope.

---

## 📚 Complete Domain Command Reference

The command suite is organized into 16 formal domains:

```text
+---------------------------------------------------------------------------------------------------+
|                                      THE 16 COMMAND DOMAINS                                       |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  1. plan         ---> Lifecycle staging, prompt capture, task declaration, and compilation.       |
|  2. queue        ---> Topological batching, wave inspection, and task claiming.                   |
|  3. task         ---> Worker leasing, heartbeats, structured submission, and validation.          |
|  4. run          ---> Command execution, run-wide status, and terminal completion sealing.        |
|  5. critic       ---> Completeness critic leasing, independent proof auditing, and certification. |
|  6. summary      ---> Summary suite export, metrics aggregation, and human report generation.     |
|  7. agent        ---> Two-tier workforce registration, capability contracts, and grant release.   |
|  8. branch       ---> Runtime execution branching, sub-task management, and collect barrier.      |
|  9. authority    ---> Authority-gated requirement grants, decisions, and role cheat-sheets.       |
| 10. watchdog     ---> Supervisory monitoring, background verification, and stale phase cleanup.   |
| 11. gate         ---> Dynamic gate falsifiability verification on isolated scratch copies.         |
| 12. dag / report ---> Sugiyama hierarchical rendering, living step tracing, and graph reporting.  |
| 13. mind         ---> Cognitive memory synchronization and Work/Span scaling telemetry.           |
| 14. diagnostics  ---> Repository health checks, doctor audits, and crash recovery.               |
| 15. inspection   ---> Forensic inspection of findings, evidence blobs, and screenshots.           |
| 16. orphan       ---> Stale artifact cleanup and worktree space reclamation.                      |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

---

### 1. `plan` Domain: Capsule Initialization & Graph Compilation

Manages the lifecycle of prompt capture, repository enhancement, task declaration, and graph compilation.

#### `plan:init`

Initializes a new immutable capsule container, freezing prompt bytes and recording the runtime environment pin.

```bash
bun harness.ts plan:init --repo <path> --run <run-id> --prompt-file <path> [--capture-mode file|inline]
```

#### `plan:enhance`

Records host-observed repository facts, to-dos, risks, and open architectural questions into derived planning state.

```bash
bun harness.ts plan:enhance --run .capsules/<slug> --actor <id> \
  --summary "<text>" [--observation "<text>"] [--todo "<text>"] [--risk "<text>"] [--source <path>]
```

#### `plan:add`

Registers a granular task into the mutable planning buffer (Revision 0), binding it to write scopes and prompt line numbers.

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor <id> --id <task-id> \
  --label "<label>" --scope <path> --gate "<cmd>" --requirement-lines <lines> \
  [--priority <n>] [--effort <n>] [--deps <id1,id2>] [--dep-reason "<id>:<why>"]
```

#### `plan:add` (Auto-Partitioning Mode)

Enumerates files on disk matching a glob to generate independent, parallel root tasks automatically.

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor <id> --id <prefix> \
  --label "<label>" --auto-partition "<glob>" --gate-template "<cmd with {scope}>" [--group-by file|directory]
```

#### `plan:audit`

Mechanically evaluates the six structural plan invariants (A1-A6) against the planning buffer.

```bash
bun harness.ts plan:audit --run .capsules/<slug> --actor <id>
```

#### `plan:compile`

Executes `plan:audit`, checks `--dep-reason` justifications, and commits the immutable execution DAG (`state.graph`, Revision 1).

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor <id> --completion-gate "<cmd>" \
  [--accept-audit "<invariant-id>:<reason>"]
```

#### `plan:validate-start` & `plan:review`

Mints an adversarial plan-validation lease and records structured written reviews of the compiled plan.

```bash
bun harness.ts plan:validate-start --run .capsules/<slug> --validator <id>
bun harness.ts plan:review --run .capsules/<slug> --validator <id> --token <token> \
  --status approved|changes_requested \
  --decomposition-answer "<ans>" --dependency-answer "<ans>" --gate-answer "<ans>" --straggler-answer "<ans>" \
  --dependency-edges-reviewed "<edges>" --gate-ids-reviewed "<gates>" --summary "<text>"
```

#### `plan:replan`

Ingests defect findings, partitions them into disjoint repair scopes, and commits Revision $N+1$.

```bash
bun harness.ts plan:replan --run .capsules/<slug> --actor <id> \
  --findings-file <path> --gate "<cmd>" --round <n>
```

---

### 2. `queue` Domain: Topological Wave Scheduling

Calculates conflict-free waves and serves dispatchable tasks using `proposeBatch`.

#### `queue:wave`

Read-only query returning all currently claimable, conflict-free tasks in the active wave.

```bash
bun harness.ts queue:wave --run .capsules/<slug> [--max-parallel <n>]
```

#### `queue:pop`

Atomically leases the highest-ranked ready task and mints a bearer token.

```bash
bun harness.ts queue:pop --run .capsules/<slug> --agent <id> --role <role>
```

---

### 3. `task` Domain: Worker Leasing, Submission & Validation

Governs worker leases, heartbeats, submissions, and adversarial validation.

#### `task:claim`

Claims a specific task under a formal role contract (`implementer` or `repairer`).

```bash
bun harness.ts task:claim --run .capsules/<slug> --task <id> --agent <id> --role implementer|repairer
```

#### `task:heartbeat`

Extends an active lease deadline before expiration.

```bash
bun harness.ts task:heartbeat --run .capsules/<slug> --task <id> --agent <id> --token <token>
```

#### `task:submit`

Submits completed work, checking write scope compliance and content digest modifications.

```bash
bun harness.ts task:submit --run .capsules/<slug> --task <id> --agent <id> --token <token> --summary "<text>" \
  [--no-op --reason "<why>"]
```

#### `task:validate-start`

Mints an independent validation lease for a submitted task.

```bash
bun harness.ts task:validate-start --run .capsules/<slug> --task <id> --validator <id>
```

#### `task:probe`

Issues a non-defect demand for proof against a task under validation.

```bash
bun harness.ts task:probe --run .capsules/<slug> --task <id> --validator <id> --token <token> \
  --demand "<text>" --revalidation "<cmd>"
```

#### `task:reject`

Filing a structured defect report, moving the task to `changes_requested` (Repair Round $+1$).

```bash
bun harness.ts task:reject --run .capsules/<slug> --task <id> --validator <id> --token <token> \
  --reason "<text>" --severity minor|important|critical --remediation "<text>" --checks <cmd-ids>
```

#### `task:review`

Signs off on task completion, resolving all open probe and defect findings with command IDs.

```bash
bun harness.ts task:review --run .capsules/<slug> --task <id> --validator <id> --token <token> \
  --status pass --summary "<text>" --checks <cmd-ids> --resolve "<finding-id>=<cmd-id>"
```

---

### 4. `run` Domain: Command Execution & Terminal Sealing

#### `run:exec`

Executes a verification command in the repository, recording a cryptographic receipt.

```bash
bun harness.ts run:exec --run .capsules/<slug> --actor <id> [--task <id>] [--gate <id>] -- <argv...>
```

#### `run:status`

Displays real-time capsule occupancy, task states, gate ceilings, and telemetry.

```bash
bun harness.ts run:status --run .capsules/<slug>
```

#### `run:complete`

Mechanically seals the capsule permanently, verifying the Completeness Critic certificate token.

```bash
bun harness.ts run:complete --run .capsules/<slug> --actor <id> --auth-token <critic-token>
```

---

### 5. `critic` Domain: Completeness Verification

#### `critic:start`

Registers the Completeness Critic and mints an authorization token bound to repository state.

```bash
bun harness.ts critic:start --run .capsules/<slug> --critic <id>
```

#### `critic:review`

Submits final prompt line verification proofs and issues the completion certificate.

```bash
bun harness.ts critic:review --run .capsules/<slug> --critic <id> --token <token> \
  --decision approve|reject --proofs-file <path> --summary "<text>"
```

---

### 6. `agent` Domain: Workforce Ledger & Lineage

#### `agent:register`

Enters an agent identity into `state.agents` before it executes any work.

```bash
bun harness.ts agent:register --run .capsules/<slug> --agent <id> --role <role> --host <host> \
  [--parent-agent <id>] [--parent-task <id>] [--model <model>] [--tool <tool>]
```

#### `agent:release`

Releases an agent grant with a mandatory audited reason.

```bash
bun harness.ts agent:release --run .capsules/<slug> --agent <id> --reason "<why>"
```

---

### 7. `branch` Domain: Runtime Execution Branching

#### `branch:open`

Subdivides an active task lease into proper-subset sub-tasks, freezing the parent lease clock.

```bash
bun harness.ts branch:open --run .capsules/<slug> --parent-task <id> --agent <id> --token <token> \
  --reason "<why>" --sub-task <id> --sub-label <id>="<label>" --sub-scope <id>=<path>
```

#### `branch:collect`

Collects submitted sub-tasks, unfreezing the parent lease with a fresh Git-observed diff.

```bash
bun harness.ts branch:collect --run .capsules/<slug> --branch <id> --agent <id> --token <token> --summary "<text>"
```

---

### 8. `gate` Domain: Dynamic Gate Falsifiability

#### `gate:prove`

Reverts a task's write scope in an isolated scratch copy and tests if the gate command fails.

```bash
bun harness.ts gate:prove --run .capsules/<slug> --task <id> --actor <id> [--base <ref>]
```

---

### 9. `dag` & `reporting` Domains: Sugiyama Layout & Living Tracing

#### `dag:render` (alias `graph:sugiyama`)

Renders the Sugiyama 4-phase hierarchical DAG with Unicode/ASCII boxes and live status badges.

```bash
bun harness.ts dag:render --run .capsules/<slug> [--box-style rounded|sharp|ascii] [--recommendations]
```

#### `dag:trace` (alias `trace:dag`)

Replays `events.jsonl` to render a vertical chronological step timeline of all agent operations.

```bash
bun harness.ts dag:trace --run .capsules/<slug> [--max-steps <n>]
```

---

### 10. `mind` Domain: Cognitive Memory & Work/Span Sync

Synchronizes execution graph metrics and learned heuristics with the cognitive memory store (`.capsules/mind/memory.json`).

```bash
bun harness.ts mind:sync --run .capsules/<slug>
bun harness.ts mind:query --run .capsules/<slug> --topic "<domain>"
```

---

### 11. `diagnostics` Domain: Health & Doctor Audits

#### `doctor`

Audits the capsule for corruption, untracked files, lock contention, and platform compatibility.

```bash
bun harness.ts doctor --run .capsules/<slug>
```

#### `recover`

Reclaims expired leases, reopens interrupted validations, and recovers orphaned branches.

```bash
bun harness.ts recover --run .capsules/<slug> --actor <id>
```

---

[⬅ Previous: End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)
