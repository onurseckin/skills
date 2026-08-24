# OLT State Schemas & Data Contracts

The OLT capsule storage model relies on strongly typed, versioned, and immutable data structures. Every state transition is recorded as an event in `events.jsonl` and projected into `state.json`.

This specification documents the formal schema specifications and validator-green exemplar JSON structures for runtime version 1.

---

## 1. Capsule Manifest (`manifest.json`)

`manifest.json` is created once during `plan:init` or `orchestrate`. It immutably binds the raw prompt bytes, runtime files, and host capture assurance to the capsule.

### Schema Fields

| Field             | Type                                                     | Description                                   |
| :---------------- | :------------------------------------------------------- | :-------------------------------------------- |
| `schema`          | `"harness.manifest"`                                     | Fixed schema identifier.                      |
| `version`         | `integer`                                                | Schema version (`1`).                         |
| `run_id`          | `string`                                                 | Unique run identifier slug.                   |
| `capsule_id`      | `string`                                                 | Cryptographic UUID for the capsule container. |
| `mode`            | `"feature" \| "mind"`                                    | Execution mode.                               |
| `prompt_sha256`   | `string`                                                 | SHA-256 digest of `prompt.md`.                |
| `prompt_bytes`    | `integer`                                                | Exact byte count of the prompt.               |
| `capture_mode`    | `"file" \| "stdin" \| "argv" \| "verbatim_context_copy"` | Prompt ingestion method.                      |
| `source_verified` | `boolean`                                                | Whether source provenance was attested.       |
| `assurance`       | `"source-verified" \| "recorded-unverified"`             | Integrity level of the prompt.                |
| `created_at`      | `string`                                                 | ISO-8601 UTC timestamp.                       |
| `runtime_sha256`  | `string`                                                 | Digest of the pinned runtime directory.       |
| `bun_version`     | `string`                                                 | Host Bun runtime version.                     |
| `runtime_version` | `string`                                                 | Semantic version of OLT harness.              |

### Exemplar JSON

```json
{
  "schema": "harness.manifest",
  "version": 1,
  "run_id": "35-comprehensive-olt-documentation-overhaul",
  "capsule_id": "c7f91a2b-38d4-4e91-8921-bc74e92a104f",
  "mode": "feature",
  "prompt_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prompt_bytes": 1024,
  "capture_mode": "argv",
  "source_verified": true,
  "assurance": "source-verified",
  "created_at": "2026-08-24T10:00:00.000Z",
  "runtime_sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "bun_version": "1.2.4",
  "runtime_version": "1.0.0"
}
```

---

## 2. Event Log Record (`events.jsonl`)

Every state mutation produces an append-only event record. Each line in `events.jsonl` contains the SHA-256 hash of the previous line, creating an immutable cryptographic hash chain.

### Schema Fields

| Field              | Type              | Description                                                   |
| :----------------- | :---------------- | :------------------------------------------------------------ |
| `schema`           | `"harness.event"` | Fixed schema identifier.                                      |
| `version`          | `integer`         | Schema version (`1`).                                         |
| `run_id`           | `string`          | Associated run ID.                                            |
| `capsule_id`       | `string`          | Associated capsule UUID.                                      |
| `sequence`         | `integer`         | Monotonically increasing event sequence index (0-indexed).    |
| `revision`         | `integer`         | Graph revision number.                                        |
| `timestamp`        | `string`          | ISO-8601 UTC timestamp.                                       |
| `actor`            | `string`          | Agent role or system process emitting the event.              |
| `kind`             | `string`          | Event discriminator (e.g., `task-claimed`, `task-submitted`). |
| `payload`          | `object`          | Event-specific arguments and metadata.                        |
| `previous_hash`    | `string \| null`  | SHA-256 hash of previous event (null for sequence 0).         |
| `projection_patch` | `array`           | RFC-6902 / JSON patch operations applied to `state.json`.     |
| `hash`             | `string`          | SHA-256 hash of canonical JSON encoding of this event.        |

### Exemplar Event Line

```json
{
  "schema": "harness.event",
  "version": 1,
  "run_id": "35-comprehensive-olt-documentation-overhaul",
  "capsule_id": "c7f91a2b-38d4-4e91-8921-bc74e92a104f",
  "mode": "feature",
  "sequence": 4,
  "revision": 1,
  "timestamp": "2026-08-24T10:05:00.000Z",
  "actor": "coordinator-1",
  "kind": "task-claimed",
  "payload": {
    "task_id": "task-docs-reference",
    "agent_id": "implementer-4",
    "role": "implementer",
    "attempt": 1,
    "duration_seconds": 600
  },
  "previous_hash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
  "projection_patch": [
    { "op": "set", "path": ["tasks", "task-docs-reference", "status"], "value": "leased" },
    {
      "op": "set",
      "path": ["tasks", "task-docs-reference", "lease", "agent_id"],
      "value": "implementer-4"
    }
  ],
  "hash": "b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01"
}
```

---

## 3. Projected Run State (`state.json`)

`state.json` is the single projected point-in-time view of the run capsule.

### Top-Level State Structure

```json
{
  "schema": "harness.state",
  "version": 1,
  "revision": 1,
  "event_sequence": 12,
  "event_head": "b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01",
  "planning": {
    "status": "compiled",
    "enhanced_plan": {
      "markdown_path": "planning/enhanced-plan.md",
      "json_path": "planning/enhanced-plan.json",
      "revision": 1,
      "prompt_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "recorded_at": "2026-08-24T10:02:00.000Z",
      "actor": "planner",
      "evidence_class": "agent_reported",
      "counts": { "observations": 4, "todos": 6, "risks": 2, "open_questions": 0, "sources": 8 }
    }
  },
  "topology": {
    "revision": 1,
    "max_parallel": 4,
    "waves": [
      {
        "wave": 1,
        "task_ids": [
          "task-docs-tutorials",
          "task-docs-how-to",
          "task-docs-architecture",
          "task-docs-reference"
        ]
      }
    ],
    "decisions": [
      {
        "task_id": "task-docs-reference",
        "wave": 1,
        "parallel_with": ["task-docs-tutorials", "task-docs-how-to", "task-docs-architecture"],
        "serialized_after": [],
        "reason": "disjoint_write_scope",
        "rationale": "Non-overlapping write scopes allow full parallel execution under Brent work/span limits.",
        "evidence_class": "derived"
      }
    ]
  },
  "agents": {
    "implementer-4": {
      "id": "implementer-4",
      "role": "implementer",
      "parent_agent_id": "coordinator-1",
      "parent_task_id": "task-docs-reference",
      "host": "antigravity",
      "granted_at": "2026-08-24T10:19:26.000Z",
      "status": "active",
      "model": { "value": "unknown", "evidence_class": "unknown" }
    }
  },
  "tasks": {
    "task-docs-reference": {
      "id": "task-docs-reference",
      "label": "Diátaxis Reference & Documentation Hub",
      "status": "leased",
      "requirement_ids": ["R-DOC-004"],
      "write_scope": ["docs/olt/reference", "docs/olt/index.md", "docs/olt/README.md"],
      "lease": {
        "agent_id": "implementer-4",
        "role": "implementer",
        "attempt": 1,
        "token_digest": "3c9a1e7d5b2f48c6a0d93e1b7f45c82a6d0e39b1c74f2a8560de3b91c7a4f605",
        "issued_at": "2026-08-24T10:19:28.000Z",
        "expires_at": "2026-08-24T10:29:28.000Z",
        "heartbeat_at": "2026-08-24T10:19:28.000Z",
        "duration_seconds": 600
      },
      "probe_round": 0,
      "repair_round": 0,
      "findings": []
    }
  },
  "branches": {},
  "gates": {
    "gate-task-docs-ref": {
      "id": "gate-task-docs-ref",
      "command": ["bun", "olt/scripts/harness.ts", "task:check", "--task", "task-docs-reference"],
      "cwd": ".",
      "scope": "task",
      "mandatory": true,
      "status": "passed"
    }
  }
}
```

---

## 4. Requirements Specification (`requirements.json`)

Binds prompt source lines to atomic, verifiable obligations.

### Exemplar JSON

```json
{
  "schema": "harness.requirements",
  "version": 1,
  "prompt_sha256": "fe515cb0785793c167ccb9259e21974d41a6935703ac03176d3e5e88159f9aa0",
  "requirements": [
    {
      "id": "R-001",
      "source_lines": [1, 2],
      "source_excerpt": "Write authoritative Diátaxis reference specifications.",
      "instruction": "Author complete Diátaxis reference specifications.",
      "implementation": "Produce reference documentation for CLI commands, state schemas, error codes, role contracts, and verification engines.",
      "subsystem": "docs/olt/reference",
      "acceptance": [
        {
          "id": "A-001",
          "criterion": "All reference files are written, typechecked, and linted cleanly.",
          "evidence": ["Passing task:check incremental audit command"]
        }
      ],
      "candidate_gates": [
        {
          "argv": ["bun", "olt/scripts/harness.ts", "task:check", "--task", "task-docs-reference"],
          "cwd": "."
        }
      ],
      "priority": 100,
      "risk": "medium",
      "ambiguity": [],
      "dependencies": [],
      "disposition": "actionable",
      "status": "planned"
    }
  ],
  "dispositions": [
    { "line": 1, "kind": "requirement", "requirement_id": "R-001" },
    { "line": 2, "kind": "requirement", "requirement_id": "R-001" }
  ]
}
```

---

## 5. Command Execution Receipt (`record.json`)

Every invocation of `run:exec` persists a detailed, signed execution record under `.olt/capsules/<slug>/commands/<command-id>/record.json`.

### Schema Fields

| Field               | Type                                     | Description                                                              |
| :------------------ | :--------------------------------------- | :----------------------------------------------------------------------- |
| `id`                | `string`                                 | Unique command execution identifier (`C-<uuid>`).                        |
| `argv`              | `string[]`                               | Literal argument vector executed.                                        |
| `cwd`               | `string`                                 | Execution working directory.                                             |
| `status`            | `"succeeded" \| "failed" \| "timed_out"` | Execution outcome status.                                                |
| `task_id`           | `string \| null`                         | Associated task identifier.                                              |
| `started_at`        | `string`                                 | Process birth ISO timestamp.                                             |
| `finished_at`       | `string`                                 | Process termination ISO timestamp.                                       |
| `exit_code`         | `integer \| null`                        | Raw process exit status.                                                 |
| `fingerprint`       | `string`                                 | SHA-256 hash of execution context.                                       |
| `logs`              | `object`                                 | Paths, byte counts, and SHA-256 hashes of `stdout` and `stderr` streams. |
| `repository_before` | `object`                                 | Pre-execution Git status and head commit hash.                           |
| `repository_after`  | `object`                                 | Post-execution Git status and head commit hash.                          |

### Exemplar JSON

```json
{
  "id": "C-VAL-CMD-101",
  "argv": ["bun", "test", "tests/unit/store.test.ts"],
  "cwd": ".",
  "cwd_relative": ".",
  "repository_root": "/workspace",
  "status": "succeeded",
  "task_id": "task-1",
  "gate_id": "gate-task-1",
  "started_at": "2026-08-24T10:15:00.000Z",
  "finished_at": "2026-08-24T10:15:02.100Z",
  "exit_code": 0,
  "signal": null,
  "fingerprint": "8d3f1a2e4b6c8d0e...",
  "attempt_signing_public_key": "ed25519-pubkey-...",
  "record_path": "commands/C-VAL-CMD-101/record.json",
  "actor": "val-cq-1",
  "assurance": "trusted_host_observed_v1",
  "logs": {
    "stdout": {
      "path": "commands/C-VAL-CMD-101/stdout.log",
      "bytes": 482,
      "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
    },
    "stderr": {
      "path": "commands/C-VAL-CMD-101/stderr.log",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
}
```

---

## 6. Structured Finding Schema

Used by adversarial validators and completeness critics to record defects and probe demands.

### Defect Finding

```json
{
  "id": "F-001",
  "class": "defect",
  "requirement_id": "R-001",
  "severity": "important",
  "observation": "Write scope allows modifying unassigned parent paths.",
  "evidence": [{ "path": "src/store/index.ts", "reason": "unauthorized edit detected" }],
  "remediation": "Restrict write scope filtering to exact child subdirectories.",
  "revalidation": "bun test tests/unit/scope.test.ts"
}
```

### Adversarial Probe Demand

```json
{
  "id": "probe-task-1-01-1",
  "class": "probe_demand",
  "requirement_id": "R-001",
  "severity": "minor",
  "evidence": [
    {
      "kind": "demand",
      "detail": "Prove that concurrent write locks timeout cleanly after 5000ms",
      "evidence_class": "agent_reported"
    }
  ],
  "observation": "Prove that concurrent write locks timeout cleanly after 5000ms",
  "remediation": "Provide command receipt proving lock timeout behavior",
  "revalidation": "Cite command ID demonstrating timeout test pass",
  "status": "open",
  "probe_round": 1
}
```
