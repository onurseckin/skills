# Validator-green schema examples

These are complete, executable examples for runtime version 1. The test
`tests/unit/packets/schema-examples.test.ts` parses the requirements, graph, submission and review
blocks below and runs the production validators over them, so those four cannot drift from the code.
The state-record examples that follow them show the shapes the harness itself writes. Do not remove
required fields or substitute agent prose for command-backed evidence.

## Requirements

This example is bound to the one-line prompt `Preserve the complete prompt.`.

```json
{
  "schema": "harness.requirements",
  "version": 1,
  "prompt_sha256": "fe515cb0785793c167ccb9259e21974d41a6935703ac03176d3e5e88159f9aa0",
  "requirements": [
    {
      "id": "R-001",
      "source_lines": [1],
      "source_excerpt": "Preserve the complete prompt.",
      "instruction": "Preserve the complete prompt.",
      "implementation": "Store the exact prompt bytes and bind them to the run manifest digest.",
      "subsystem": "src/store",
      "acceptance": [
        {
          "id": "A-001",
          "criterion": "The stored prompt bytes and manifest digest match the source.",
          "evidence": ["A passing prompt-capsule integrity test command"]
        }
      ],
      "candidate_gates": [{ "argv": ["bun", "test", "tests/store/prompt.test.ts"], "cwd": "." }],
      "priority": 100,
      "risk": "high",
      "ambiguity": [],
      "dependencies": [],
      "disposition": "actionable",
      "status": "planned"
    }
  ],
  "dispositions": [{ "line": 1, "kind": "requirement", "requirement_id": "R-001" }]
}
```

Every nonblank prompt line has exactly one disposition. `source_excerpt` is the exact join of
`source_lines`, and the document digest is the SHA-256 of the complete prompt bytes. A disposition
links one atomic requirement with `requirement_id` or multiple atomic requirements with the
non-empty, duplicate-free `requirement_ids`; it must declare exactly one form. Every obligation uses
the canonical line kind `requirement`; the linked atomic requirements independently declare
`actionable` or `needs_authority`. A plural line may link both dispositions. If any linked
requirement needs authority, the line includes a substantive rationale. Version 1 rejects the line
kinds `needs_authority` and `out_of_scope`, and plans cannot give an atomic requirement the
`out_of_scope` disposition. Only an audited decline disposes a planned `needs_authority`
requirement; its immutable planned disposition remains unchanged.

## Plural source-line mapping

One source line can contain independently executable and authority-gated obligations. For the exact
one-line prompt `Add local caching and publish it only after I approve.`, use two atomic requirements
and one plural line disposition:

```json
{
  "schema": "harness.requirements",
  "version": 1,
  "prompt_sha256": "d2dea8db8fb2bb51d87a5fea5b4f10d896c66fcd667109a0a12786de232c6193",
  "requirements": [
    {
      "id": "R-LOCAL",
      "source_lines": [1],
      "source_excerpt": "Add local caching and publish it only after I approve.",
      "instruction": "Add local caching.",
      "implementation": "Implement and verify the local cache without publishing anything.",
      "subsystem": "src/cache",
      "acceptance": [
        {
          "id": "A-LOCAL",
          "criterion": "The local cache passes its focused behavior tests.",
          "evidence": ["A successful focused cache test command"]
        }
      ],
      "candidate_gates": [{ "argv": ["bun", "test", "tests/cache.test.ts"], "cwd": "." }],
      "priority": 80,
      "risk": "medium",
      "ambiguity": [],
      "dependencies": [],
      "disposition": "actionable",
      "status": "planned"
    },
    {
      "id": "R-PUBLISH",
      "source_lines": [1],
      "source_excerpt": "Add local caching and publish it only after I approve.",
      "instruction": "Publish only after explicit approval.",
      "implementation": "Keep publication paused until an audited user grant authorizes it.",
      "subsystem": "release",
      "acceptance": [
        {
          "id": "A-PUBLISH",
          "criterion": "No publication occurs before a recorded grant.",
          "evidence": ["The authority history and a successful publication-policy check"]
        }
      ],
      "candidate_gates": [{ "argv": ["bun", "test", "tests/publish.test.ts"], "cwd": "." }],
      "priority": 70,
      "risk": "high",
      "ambiguity": ["The destination is selected only after approval."],
      "dependencies": ["R-LOCAL"],
      "disposition": "needs_authority",
      "status": "planned"
    }
  ],
  "dispositions": [
    {
      "line": 1,
      "kind": "requirement",
      "requirement_ids": ["R-LOCAL", "R-PUBLISH"],
      "rationale": "Publication is a separate external mutation that the user explicitly reserved for approval."
    }
  ]
}
```

Both atomic requirements repeat line 1 because both derive from it, and their exact excerpt is the
entire source line. `requirement_ids` is nonempty and duplicate-free; do not also include
`requirement_id`. The rationale explains the authority boundary but does not grant or decline it.
Prefer separate graph tasks for the two requirements so local work can proceed while publication is
paused. If they share one task, that task remains paused until the decision; after a decline, a mixed
task remains executable for `R-LOCAL`, while a task mapped only to `R-PUBLISH` is cancelled. A gate
covering only the declined requirement is not applicable and cannot block the executable work.

## Graph

```json
{
  "schema": "harness.graph",
  "version": 1,
  "revision": 1,
  "nodes": [
    {
      "id": "requirement-1",
      "type": "requirement",
      "label": "R-001",
      "requirement_id": "R-001"
    },
    {
      "id": "artifact-1",
      "type": "artifact",
      "label": "Immutable prompt capsule"
    },
    {
      "id": "task-1",
      "type": "task",
      "label": "Implement immutable prompt capsule",
      "requirement_ids": ["R-001"],
      "write_scope": ["src/store"],
      "resource_scope": [],
      "artifact_ids": ["artifact-1"],
      "status": "ready",
      "priority": 100,
      "effort": 3,
      "created_order": 0
    }
  ],
  "edges": [
    { "source": "task-1", "target": "requirement-1", "type": "implements" },
    { "source": "task-1", "target": "artifact-1", "type": "produces" }
  ],
  "gates": [
    {
      "id": "gate-task-1",
      "command": ["bun", "test", "tests/store/prompt.test.ts"],
      "cwd": ".",
      "scope": "task",
      "requirement_ids": ["R-001"],
      "mandatory": true
    },
    {
      "id": "gate-run",
      "command": ["bun", "test", "tests"],
      "cwd": ".",
      "scope": "run",
      "requirement_ids": [],
      "mandatory": true
    }
  ]
}
```

The dependency direction is `dependent --depends_on--> prerequisite`. Every actionable or
`needs_authority` requirement has a task and mandatory task gate, every artifact has one owner, and
the graph has a mandatory run gate. Pending authority pauses dispatch; a grant makes the requirement
executable, and a decline disposes only that requirement. A mixed task remains executable when at
least one mapped requirement is executable and none awaits a decision; a task whose mapped
requirements are all declined is cancelled. A mandatory task gate is applicable only when its
coverage includes an executable requirement on that task; a gate covering only declined
requirements cannot block validation or finish. Gate commands are literal argv in the strict
verification grammar, never shell programs, inline runtime evaluation, or permissive no-test modes.
Runtime verification uses explicit repository-relative scripts or test targets. Recognized tools
such as operand-free `git diff --check`, `git diff --cached --check`, and `test -f` require a bare
executable name. A path-qualified executable always uses the custom-verifier grammar. An `env`
wrapper accepts only the literal command, optionally after `--`; it accepts no assignments or options.
Package-script gates accept no trailing or passthrough argv. Custom verification uses a
repository-local executable path such as `./scripts/check`; reserved tool, wrapper, shell, and no-op
basenames are invalid. It accepts no dash-prefixed arguments. Optional arguments are separate
non-option safe tokens or repository-relative paths.

## Implementer submission

```json
{
  "summary": "The prompt capsule now preserves and verifies the exact source bytes.",
  "requirement_ids": ["R-001"],
  "files_changed": ["src/store/prompt.ts"],
  "checks": [{ "command_id": "C-IMPLEMENTER-1" }],
  "evidence": [{ "path": "commands/C-IMPLEMENTER-1/record.json" }]
}
```

Requirement coverage equals the frozen task mapping. Every changed path is normalized and inside
the task write scope. `checks` and `evidence` are nonempty substantive object lists.

## Validator rejection

```json
{
  "verdict": "reject",
  "requirement_ids": ["R-001"],
  "checks": [{ "command_id": "C-VALIDATOR-1" }],
  "findings": [
    {
      "id": "F-001",
      "class": "defect",
      "requirement_id": "R-001",
      "severity": "important",
      "observation": "prompt.md retains writable mode bits after initialization.",
      "evidence": [{ "path": ".capsules/example/prompt.md", "mode": "0644" }],
      "remediation": "Persist prompt.md without any write mode bits and fsync the containing directory.",
      "revalidation": "Initialize a fresh run and assert prompt.md mode has no 0222 bits."
    }
  ]
}
```

A rejection has at least one mapped, substantive finding, and `class` is `defect`: a rejection
asserts that something is broken. A review verdict may not carry a `probe_demand` finding — those are
recorded with `task:probe`. The validator command ID must resolve to a fresh successful command owned
by the active validator when the review is recorded.

## Validator pass after repair

```json
{
  "verdict": "pass",
  "requirement_ids": ["R-001"],
  "checks": [{ "command_id": "C-VALIDATOR-2" }],
  "findings": [],
  "resolved_findings": [
    {
      "finding_id": "F-001",
      "method": "Initialized a fresh run and inspected prompt.md mode bits.",
      "evidence": [{ "command_id": "C-VALIDATOR-2" }]
    }
  ]
}
```

A repaired pass explicitly resolves every open finding with fresh command-backed evidence. Runtime
authorization additionally requires a different validator identity from all earlier validation
rounds and from every implementer or repairer.

## Adversarial probe demand

`task:probe --demand "Prove the parser rejects an empty payload"` files one finding per demand. A
probe demand asserts nothing about the code, so requiring one is not fabrication:

```json
{
  "id": "probe-task-1-01-1",
  "class": "probe_demand",
  "requirement_id": "R-001",
  "severity": "minor",
  "evidence": [
    {
      "kind": "demand",
      "detail": "Prove the parser rejects an empty payload",
      "evidence_class": "agent_reported"
    }
  ],
  "observation": "Prove the parser rejects an empty payload",
  "remediation": "Answer the demand with evidence, or record a defect with task:reject if it does not hold.",
  "revalidation": "Cite a command id that proves this for task-1",
  "status": "open",
  "probe_round": 1
}
```

`severity` is the lowest the finding contract allows because a demand grades nothing; what separates
it from a defect is `class`, never severity. When the probe cites command ids, `evidence` carries one
`{ "kind": "command", "reference": "<command-id>", "evidence_class": "harness_observed" }` entry per
id instead of the agent-reported demand entry. The demand is closed by
`task:review --status pass --resolve probe-task-1-01-1=<command-id>`, which records a
`probe_demand_answered` resolution.

## Branch record

One entry in `state.branches`, after a collect:

```json
{
  "id": "B-4f1c2a9e6b0d4d18a1b6c2e5f70d3a91",
  "parent_task_id": "task-1",
  "parent_agent_id": "worker-1",
  "reason": "the parser rewrite blocks the API change and the two touch disjoint trees",
  "depth": 1,
  "status": "collected",
  "opened_at": "2026-08-19T10:04:11.000Z",
  "collected_at": "2026-08-19T10:41:52.000Z",
  "outcome_summary": "Parser fixed; API change unblocked.",
  "sub_tasks": [
    {
      "id": "S-1",
      "label": "Fix the parser",
      "write_scope": ["src/store/parser"],
      "gate": "bun test tests/unit/store/parser.test.ts",
      "status": "submitted",
      "agent_id": "sub-1",
      "claimed_at": "2026-08-19T10:05:02.000Z",
      "submitted_at": "2026-08-19T10:39:18.000Z",
      "summary": "Parser accepts the new grammar and rejects the empty payload."
    }
  ],
  "files_changed": {
    "value": ["src/store/parser/grammar.ts"],
    "evidence_class": "harness_observed"
  },
  "collected_observation": {
    "observed_at": "2026-08-19T10:41:52.000Z",
    "git_available": true,
    "head": "9d3b7c1f0a52d84e6b19f4c7a20e5d8b3f6c1a94",
    "entries": [
      {
        "path": "src/store/parser/grammar.ts",
        "status_code": " M",
        "sha256": "3c9a1e7d5b2f48c6a0d93e1b7f45c82a6d0e39b1c74f2a8560de3b91c7a4f605"
      }
    ]
  }
}
```

Sub-task scopes are subsets of the parent scope and disjoint from each other. `files_changed` is only
present when Git could be read; `git_available: false` leaves it absent rather than empty.

## Agent grant

One entry in `state.agents`, after the dispatcher reported telemetry via CLI flags:

```json
{
  "id": "worker-1",
  "role": "implementer",
  "parent_agent_id": "coordinator-1",
  "parent_task_id": "task-1",
  "host": "claude-code",
  "granted_at": "2026-08-19T09:58:40.000Z",
  "status": "active",
  "model": { "value": "claude-opus-5", "evidence_class": "agent_reported" },
  "model_tier": { "value": "l", "evidence_class": "agent_reported" },
  "thinking_level": { "value": "high", "evidence_class": "agent_reported" },
  "tools_granted": { "value": ["Read", "Edit", "Bash"], "evidence_class": "agent_reported" },
  "tools_used": [
    {
      "name": "Read",
      "evidence_class": "agent_reported",
      "first_reported_at": "2026-08-19T10:02:00.000Z"
    }
  ],
  "tokens_in": { "value": 18000, "evidence_class": "agent_reported" },
  "tokens_out": { "value": 2400, "evidence_class": "agent_reported" },
  "last_reported_at": "2026-08-19T10:02:00.000Z",
  "report_count": 1
}
```

A grant nobody reported telemetry for carries `id`, `role`, `parent_agent_id`, `parent_task_id`,
`host`, `granted_at` and `status` alone. The missing fields stay missing and render as "unknown";
none of them is filled in from the exporting machine. Model, tier, thinking level, tool names and
token counts all arrive over the CLI from whichever process called the harness, so all of them carry
`agent_reported` — a CLI flag is an unverified claim, not a host attestation, no matter which field
it fills. Counts recorded with `--tokens-estimated` carry `"evidence_class": "derived"` and
`"is_estimated": true`.

## Topology record

`state.topology`, written once by `plan:compile`:

```json
{
  "revision": 1,
  "max_parallel": 4,
  "waves": [
    { "wave": 1, "task_ids": ["task-1", "task-2"] },
    { "wave": 2, "task_ids": ["task-3"] }
  ],
  "decisions": [
    {
      "task_id": "task-2",
      "wave": 1,
      "parallel_with": ["task-1"],
      "serialized_after": [],
      "reason": "priority_capacity",
      "rationale": "Disjoint write scopes and no dependency; both fit inside max_parallel.",
      "evidence_class": "derived"
    },
    {
      "task_id": "task-3",
      "wave": 2,
      "parallel_with": [],
      "serialized_after": ["task-1"],
      "reason": "dependency",
      "rationale": "task-3 depends on task-1.",
      "evidence_class": "derived"
    }
  ]
}
```

`rationale` is `agent_reported` only when a coordinator supplied the sentence; the harness's own
explanation is `derived`. There is no third source, so a decision never carries prose nobody wrote.

## Enhanced plan record

`state.planning.enhanced_plan`, written by `plan:enhance`:

```json
{
  "markdown_path": "planning/enhanced-plan.md",
  "json_path": "planning/enhanced-plan.json",
  "markdown_sha256": "b71f0c5a9e34d8271c6f0a4b5d9e2731c84a6f05b3d1e97240ac68b5f31d7e02",
  "json_sha256": "5a4c81f30b9d6e27f1a83c05b47de962184c7f30a2b6d5e91c380f47a6b2d1e8",
  "revision": 1,
  "prompt_sha256": "fe515cb0785793c167ccb9259e21974d41a6935703ac03176d3e5e88159f9aa0",
  "recorded_at": "2026-08-19T09:51:07.000Z",
  "actor": "planner",
  "evidence_class": "agent_reported",
  "counts": { "observations": 3, "todos": 5, "risks": 2, "open_questions": 1, "sources": 7 }
}
```

The harness hashed the two artifacts it wrote, but their contents are the agent's claim, which is
why the record is `agent_reported`. `prompt_sha256` ties the enhancement to the prompt it was written
against; the prompt keeps requirement authority and this document never becomes the requirement
source.
