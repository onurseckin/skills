# 03. Mechanical Completion Engine & The 8-Point Terminal Checklist

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)

---

## 🚫 Why AI Agents Cannot Declare Victory by Assertion

In standard LLM systems, an agent prints _"Everything is complete and tested! Thank you!"_ even when half the files are missing or broken.

In `orchestrating-long-tasks`, the final state transition to `status: "completed"` is computed **purely deterministically** by the completion engine (`run:complete`).

The CLI inspects `state.json` and evaluates an uncompromising **8-Point Mechanical Checklist**. If even a single condition fails, `run:complete` aborts with an error and outputs the exact blocking reasons.

---

## 📋 The 8-Point Terminal Completion Checklist

```text
┌────────────────────────────────────────────────────────────────────────┐
│               THE 8-POINT TERMINAL COMPLETION CHECKLIST                │
├────┬─────────────────────────────┬─────────────────────────────────────┤
│ 1. │ All Graph Tasks Done        │ 100% of task nodes have `done`.     │
│ 2. │ Zero Unresolved Findings    │ No open findings exist in capsule.  │
│ 3. │ All Mandatory Gates Passed  │ Task gates & run gates passed (0).  │
│ 4. │ Zero Active Leases          │ No running or validating leases.    │
│ 5. │ Critic Review Approved      │ Authoritative critic verdict: pass. │
│ 6. │ Artifacts Present On Disk   │ All declared artifacts exist.       │
│ 7. │ Zero Stale Receipts         │ Repositories match gate snapshots.  │
│ 8. │ Clean Hash Chain Head       │ events.jsonl cryptographic head ok. │
└────┴─────────────────────────────┴─────────────────────────────────────┘
```

---

## 💻 Terminal CLI Execution (`run:complete`)

When all tasks and gates are satisfied, the coordinator runs the final command:

```bash
bun harness.ts run:complete \
  --run .capsules/<run-id> \
  --actor coordinator
```

You can inspect the sealed run status at any time:

```bash
bun harness.ts run:status \
  --run .capsules/<run-id>
```

---

## 🚢 Post-Completion Workflow: Git Commit & Push

Once the run is officially `completed` by the harness engine:

1. The developer or agent reviews the git status:
   ```bash
   git status --short
   ```
2. Stages the changes and commits following **Conventional Commits**:
   ```bash
   git add <scoped-paths>
   git commit -m "docs: add comprehensive orchestrating-long-tasks tutorial documentation"
   ```
3. Pushes the branch to remote:
   ```bash
   git push origin main
   ```

---

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)
