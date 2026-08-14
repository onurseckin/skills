# Validator-green schema examples

These are complete, executable examples for runtime version 1. The test
`scripts/tests/packets/schema-examples.test.ts` parses every block below and runs the production
requirements, graph, submission, and review validators. Do not remove required fields or substitute
agent prose for command-backed evidence.

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
      "requirement_id": "R-001",
      "severity": "important",
      "observation": "prompt.md retains writable mode bits after initialization.",
      "evidence": [{ "path": ".harness/example/prompt.md", "mode": "0644" }],
      "remediation": "Persist prompt.md without any write mode bits and fsync the containing directory.",
      "revalidation": "Initialize a fresh run and assert prompt.md mode has no 0222 bits."
    }
  ]
}
```

A rejection has at least one mapped, substantive finding. The validator command ID must resolve to
a fresh successful command owned by the active validator when the review is recorded.

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
