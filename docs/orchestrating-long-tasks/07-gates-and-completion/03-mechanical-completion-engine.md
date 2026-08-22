# 03. Mechanical Completion Engine & The 9-Point Terminal Checklist

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)

---

## 🚫 Why AI Agents Cannot Declare Victory by Assertion

In standard LLM systems, an agent prints _"Everything is complete and tested! Thank you!"_ even when half the files are missing or broken.

In `orchestrating-long-tasks`, the final state transition to `status: "completed"` is computed **purely deterministically** by the completion engine (`run:complete`).

The CLI inspects `state.json`, re-verifies the recorded command evidence against the live repository, and evaluates an uncompromising **9-Point Mechanical Checklist**. If even a single condition fails, `run:complete` aborts and names the exact blockers.

---

## 📋 The 9-Point Terminal Completion Checklist

```text
┌────────────────────────────────────────────────────────────────────────┐
│               THE 9-POINT TERMINAL COMPLETION CHECKLIST                │
├────┬─────────────────────────────┬─────────────────────────────────────┤
│ 1. │ All Graph Tasks Done        │ 100% of task nodes have `done`.     │
│ 2. │ Zero Unresolved Findings    │ Probe demands and defects alike.    │
│ 3. │ All Mandatory Gates Passed  │ Task gates & run gates exited 0.    │
│ 4. │ Zero Active Leases          │ No leased, running, branched or     │
│    │                             │ validating task remains.            │
│ 5. │ Every Requirement Proven    │ No requirement recorded `unproven`. │
│ 6. │ Critic Review Approved      │ Authoritative critic verdict: clean.│
│ 7. │ Artifacts Present On Disk   │ All declared artifacts exist.       │
│ 8. │ Zero Stale Receipts         │ Live repo matches gate snapshots.   │
│ 9. │ Clean Hash Chain Head       │ events.jsonl cryptographic head ok. │
└────┴─────────────────────────────┴─────────────────────────────────────┘
```

Point 3 is stricter than "the gate exited 0" alone: `workflow/completion/completion-state.ts`'s
`validatorProofIssues` requires, per task, that **every validator domain the task's write scope
actually draws** (`applicableValidatorDomains` — `code-quality` always applies; `ui-design` and
`system-design` are derived from file extensions and path signals in the write scope) has its own
independently recorded `pass`, each carrying command evidence that is itself successful, bound to that
task, run by that domain's own validator, and matched against one of the task's applicable gates. A
task touching both application code and a database migration schema, for instance, needs a passing
`code-quality` verdict **and** a passing `system-design` verdict — one domain approving is not the whole
task approving. Point 8 is enforced the same mechanical way: `completionIssues` recomputes whether the
live repository still matches the run gate's recorded post-command binding and the completion result's
own recorded provenance hashes, and refuses with `"completion result provenance is stale"` the instant
any of them has moved.

Undisposed orphan evidence — a command record that arrived without a live owner, typically from an
agent that died mid-run — also blocks completion. It is disposed explicitly, never ignored:

```bash
bun harness.ts orphan:dispose --run .capsules/<run-id> --actor coordinator \
  --orphan-sha256 <sha, from doctor's issues> --disposition ignored_non_authoritative \
  --rationale "worker-1's lease expired before it submitted; the work was re-dispatched" \
  --evidence <command-id>
```

`--disposition` is `ignored_non_authoritative`, `rejected`, or `superseded`, and every disposition is
terminal — the same orphan can never be dispositioned twice.

---

## 💻 Terminal CLI Execution (`run:complete`)

Close every agent grant **first**. A completed run is terminal, so a release afterwards is refused:

```bash
bun harness.ts agent:release --run .capsules/<run-id> --agent <id> --reason "run sealed"
bun harness.ts run:complete --run .capsules/<run-id> --actor coordinator \
  --auth-token <token-from-critic:start>
```

```text
### 🎉 Run Completed Successfully: slugger
- **Capsule**: `.capsules/slugger`
- **Summary**: 2 tasks executed, 2 independent validations passed, 1 critic sign-off
- **Total Gates Verified**: 3/3 gates green
- **Run Duration**: unknown
- **Capsule Status**: Sealed & Auditable
```

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"completed runs are terminal and cannot be mutated"}}
```

Note what the brief does **not** do with an unmeasured duration: it prints `unknown` rather than a
plausible-looking number. `--actor` and `--auth-token` are both required with no default; the run
records who sealed it, and the token is the same bearer token `critic:start` minted, checked against
the critic assignment's own token digest — not the critic's live grant, so releasing the critic first
does not invalidate it; `critic:review` itself never mints or returns a token. Omitting `--auth-token`
is refused outright: `{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"--auth-token is required"}}`.

`run:complete` also regenerates the summary suite. Inspect the sealed run at any time:

```bash
bun harness.ts run:status --run .capsules/<run-id>
bun harness.ts summary:view --run .capsules/<run-id>
bun harness.ts agent:list --run .capsules/<run-id> --task <task-id>
bun harness.ts doctor --run .capsules/<run-id>
```

```text
### Capsule Doctor: `.capsules/slugger`
- **Healthy**: yes
- **Bun**: 1.3.14 (supported)
- **Gitignored**: yes
- **Issues**: none
```

`doctor` re-hashes the event chain, re-verifies every recorded command, and reports workflow blockers.
It is the fastest way to answer "is this capsule still trustworthy" without mutating it.

---

## 🚢 Post-Completion Workflow: Git Commit & Push

Once the run is officially `completed` by the harness engine:

1. Export the run's artifacts for review:
   ```bash
   bun harness.ts summary:export --run .capsules/<run-id> --out <viewer-registry-dir>
   ```
2. Review the working tree:
   ```bash
   git status --short
   ```
3. Stage and commit following **Conventional Commits**:
   ```bash
   git add <scoped-paths>
   git commit -m "feat: add slugify and truncate helpers"
   ```

The capsule itself is gitignored: it is the audit record of how the change was produced, not part of
the change.

---

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)
