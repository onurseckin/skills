# 02. Completeness Critic Verification Protocol

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

---

## 🎯 What the Critic Is For

Task validators review one scope each. A macro-level risk survives that: every task can pass while the
**request** goes unmet.

- All tasks done, one cross-cutting user requirement forgotten.
- Artifacts declared but absent, empty, or stubbed.
- A prompt line disposed as `context` that was actually an obligation.

The completeness critic is an independent audit of the whole request, run after task validation and
before completion.

---

## 🔐 The Lifecycle

```text
[ critic:start --critic <id> ]
        ├── refuses a critic that planned, implemented, repaired or validated anything in this run
        ├── records a repository inspection and a readiness snapshot
        └── returns the critic token (once, stdout only; digest persisted)
                 │
                 ▼
[ the critic runs its OWN commands: run:exec --actor <critic> ]
                 │
                 ▼
[ critic:review --decision approve|request_changes  |  critic:reject ]
```

```bash
bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1
```

Independence is enforced, not requested:

```text
completeness critic must be independent from implementers, repairers, and validators
```

---

## 🧪 The Critic Must Run Its Own Commands

This is the step most people miss. The critic's evidence is collected automatically from the commands
whose **actor is the critic** — and a command qualifies only if it is **not bound to a task**:

```bash
bun harness.ts run:exec --run .capsules/<run-id> --actor critic-1 -- bun test tests/slug.test.ts
bun harness.ts run:exec --run .capsules/<run-id> --actor critic-1 -- bun test tests/truncate.test.ts
bun harness.ts run:exec --run .capsules/<run-id> --gate gate-run-completion --actor critic-1 -- bun test tests
```

Skip it and the review is refused:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"critic checks must be nonempty"}}
```

Cite a task-bound or someone else's command and it is refused too:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"critic independent check is invalid: C-312707c8-…"}}
```

Rerunning the suite under the critic's own actor is the price of a sign-off. That is the whole
mechanism by which "the critic verified it" means something.

---

## 📝 Requirement Proofs Are Mandatory and Unfakeable

An approval must carry one proof per requirement, supplied by `--proofs`, `--proofs-file`, or a
complete `--review` payload:

```json
[
  {
    "requirement_id": "req-slug",
    "status": "satisfied",
    "evidence": [
      {
        "kind": "command",
        "reference": "C-6c9cbf46-fe0b-405d-a060-69176613528f",
        "observation": "the critic ran bun test tests/slug.test.ts itself and it exited 0"
      }
    ]
  }
]
```

- `status` is `satisfied`, `out_of_scope`, or `unproven`.
- **`unproven` is not something a critic can claim.** It is what the harness records for a requirement
  the critic never proved, and it blocks completion.
- A clean verdict with any unproven requirement is refused:
  ```text
  clean completion review leaves requirements unproven: req-truncate
  ```
- Every `kind: "command"` reference must resolve to a critic-run, task-unbound, successful command:
  ```text
  requirement proof command is invalid: C-3e1dbf9d-…
  ```

Nothing auto-generates a `satisfied` proof. A requirement the critic did not look at stays unproven,
and the run does not finish.

---

## ✅ Approving

```bash
bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <critic-token> \
  --decision approve --proofs-file proofs.json \
  --summary "Both prompt lines are implemented and each is bound to a gate run the harness recorded."
```

```text
### Completeness Critic Sign-Off: APPROVED
- **Critic**: `critic-1`
- **Summary**: Both prompt lines are implemented and each is bound to a gate run the harness recorded.
- **Authorization**: Valid completion certificate issued
- **Next Step**: Seal run via `bun harness.ts run:complete --run .capsules/<run-id> --auth-token …`
```

`--summary` is mandatory and is the critic's own words. `integrity_evidence` is always the harness's
own capsule integrity observation measured at review time — a `--review` file cannot certify its own
capsule, so whatever it declares under that key is replaced.

---

## ❌ Rejecting

```bash
bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <critic-token> \
  --summary "Missing error boundary" \
  --findings '[{"id":"F-01","requirement_id":"req-1","severity":"critical","observation":"No error boundary around the render tree","remediation":"Wrap the tree in an error boundary","revalidation":"bun test tests/render"}]'
```

Structured findings are **mandatory**:

```text
--decision request_changes requires --findings or --findings-file; a rejection must name the defects it found
```

Each finding carries `id`, `requirement_id`, `severity`, `observation`, `remediation` and
`revalidation`. A critic that wants to reject but has nothing concrete to say **fails** rather than
producing a finding the harness wrote for it. Rejected findings feed `plan:replan`, which partitions
them into a disjoint repair wave.

---

## 🔧 Closing the Loop: `critic:remediate`

`plan:replan` schedules the repair work; it does not, by itself, satisfy completion. Every review ever
recorded with `status: "findings"` stays in the run's history and blocks completion until it carries a
remediation naming exactly its own finding ids, each proven by a task-unbound, successful command:

```bash
bun harness.ts critic:remediate --run .capsules/<run-id> --actor coordinator \
  --resolve CF-1=<fix-command-id> --resolution-method CF-1="focused repair and verification"
```

`--resolve` is repeatable as `<finding-id>=<command-id>[,<command-id>]`; every finding the review
opened must be answered exactly, no more and no fewer. `--review-sha256` defaults to the currently
recorded review. This does **not** clear the review's own `unresolved_finding_ids` or make it
`clean` — only a fresh, independent critic pass does that. What it does is record that the defects
were closed, so completion's history check stops demanding a remediation that was never made.

---

## 🛡️ The Critic's Own Rules

1. **Token digest verification.** The critic token must match the digest recorded at `critic:start`.
2. **Independence.** No prior role in this run, ever.
3. **No implementer prose.** The critic consumes the prompt, the dispositions, the whole-repository
   diff, and the authoritative command, gate and finding records — not self-grading narratives.
4. **Readiness binding.** Any drift from the packet's readiness digest or repository binding is a
   rejection, not a note.
5. **Explicit residual risk.** An approval may carry risks; it may not carry silence about them.

---

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)
