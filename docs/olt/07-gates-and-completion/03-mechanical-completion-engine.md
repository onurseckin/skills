# 03. Mechanical Completion Engine & The 9-Point Terminal Checklist

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                                                      |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand why completion cannot be asserted by agents, the mathematics of the 9-Point Terminal Checklist, receipt provenance verification, and orphan evidence disposition. |
| **How-To Guide** | Disposing orphan evidence, releasing agent grants, executing `run:complete`, running capsule diagnostics (`doctor`), and sealing repository commits.                         |
| **Reference**    | The 9-Point Checklist specification, CLI flags, terminal error codes, and doctor health check definitions.                                                                   |
| **Tutorial**     | Complete end-to-end execution of the terminal sealing sequence on a multi-task run.                                                                                          |

---

## 🚫 1. Explanation: The Fatal Flaw of Conversational Completion

In traditional multi-agent LLM systems, completion is declared conversationally:

> _"I have completed all requirements, verified the code, and everything is ready for production!"_

In reality, autonomous agents frequently emit this message while leaving files missing, compilation broken, test gates unexecuted, and sub-agent leases abandoned.

In `olt`, **an agent cannot declare completion**. The transition to `status: "completed"` is a **purely deterministic mathematical calculation** executed by the Mechanical Completion Engine (`run:complete`).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MECHANICAL COMPLETION VERIFICATION                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Agent Claim: "I am finished!"                                              │
│       │                                                                     │
│       ▼                                                                     │
│  `run:complete --run .olt/capsules/<id> --auth-token <critic-tok>`              │
│       │                                                                     │
│       ▼                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │             THE 9-POINT DETERMINISTIC CHECKLIST ENGINE                │  │
│  │                                                                       │  │
│  │  [✓] 1. 100% Graph Tasks Marked "done"                                │  │
│  │  [✓] 2. 0 Unresolved Findings (Defects & Probes Resolved)             │  │
│  │  [✓] 3. All Mandatory Gates Passed Across All Required Domains        │  │
│  │  [✓] 4. 0 Active, Branched, or Validating Leases                      │  │
│  │  [✓] 5. 100% Requirements Proven by Independent Critic Receipts       │  │
│  │  [✓] 6. Clean Completeness Critic Sign-Off Certificate                │  │
│  │  [✓] 7. All Declared Output Artifacts Exist and Non-Empty on Disk     │  │
│  │  [✓] 8. Live Repository Matches Gate Post-Execution SHA Snapshots    │  │
│  │  [✓] 9. SHA-256 Hash Chain Head Verified & Undisposed Orphans = 0     │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                    ┌─────────────────┴─────────────────┐                    │
│                    │                                   │                    │
│           All 9 Points Pass                   Any 1 Point Fails             │
│                    │                                   │                    │
│                    ▼                                   ▼                    │
│         [ CAPSULE SEALED: 🔒 ]                [ ABORT EXECUTION ❌ ]        │
│         • Terminal state written              • Exact blocker named         │
│         • Hash chain locked                   • State remains mutable       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 2. Reference: The 9-Point Terminal Completion Checklist

The Completion Engine evaluates all nine conditions in sequence. If even one fails, completion is aborted with a structured failure report naming the exact blockers.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 THE 9-POINT TERMINAL COMPLETION SPECIFICATION               │
├────┬─────────────────────────────┬──────────────────────────────────────────┤
│ #  │ Verification Item           │ Exact Invariant / Condition Enforced     │
├────┼─────────────────────────────┼──────────────────────────────────────────┤
│ 1. │ **All Graph Tasks Done**    │ $\forall t \in \text{tasks}, t.\text{status} = \text{"done"}$. No tasks in `todo`, `in_progress`, `changes_requested`, `validating`. |
│ 2. │ **Zero Unresolved Findings**│ $\forall f \in \text{findings}, f.\text{status} = \text{"resolved"}$. No dangling defects or probe demands. |
│ 3. │ **All Mandatory Gates Pass**│ Every task gate and run gate has a recorded receipt with `exit_code == 0` for all applicable domains (`code-quality`, `ui-design`, etc.). |
│ 4. │ **Zero Active Leases**      │ No agent holds an unreleased lease. No tasks in `branched`, `leased`, or `stale` states. |
│ 5. │ **Every Requirement Proven**│ $\forall r \in \text{requirements}, r.\text{status} = \text{"satisfied"} \lor \text{"out\_of\_scope"}$. Zero `unproven`. |
│ 6. │ **Critic Review Approved**  │ Authoritative completion review exists with `decision == "approve"`, verified against critic token digest. |
│ 7. │ **Artifacts On Disk**       │ All files declared in `state.artifacts` exist on disk, are non-empty (>0 bytes), and match content SHAs. |
│ 8. │ **Zero Stale Receipts**     │ Current repository SHA-256 matches the post-command repository binding of the run completion gate. |
│ 9. │ **Clean Hash Chain Head**   │ Full cryptographic audit of `events.jsonl` passes from genesis to head; zero undisposed orphan records. |
└────┴─────────────────────────────┴──────────────────────────────────────────┘
```

---

## 🧟 3. Explanation: Orphan Evidence & Terminal Dispositions

When an agent process terminates unexpectedly or is reclaimed after a lease expiration, any command execution records it left behind become **Orphan Evidence**.

The Completion Engine **refuses** to seal a run if undisposed orphan evidence exists:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ORPHAN EVIDENCE LIFECYCLE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Agent Crashes Mid-Run ] ──► Leaves Command Receipt `C-8819` on disk      │
│                                                │                            │
│                                                ▼                            │
│  [ `recover` Reclaims Lease ] ──► Receipt orphaned (no live task binding)   │
│                                                │                            │
│                                                ▼                            │
│  [ `run:complete` Aborts ] ──► "1 undisposed orphan evidence record exists" │
│                                                │                            │
│                                                ▼                            │
│  [ Coordinator Calls `orphan:dispose` ]                                     │
│    ├── `ignored_non_authoritative` (Dead agent's partial work)              │
│    ├── `rejected`                  (Flawed or corrupt execution)            │
│    └── `superseded`                (Replaced by fresh worker's receipt)     │
│                                                │                            │
│                                                ▼                            │
│  [ Orphan Marked Disposed ] ──► Completion Engine Unblocked                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Every disposition is **immutable and terminal**—an orphan record cannot be dispositioned twice.

---

## 🔒 4. Explanation: Immutability of Sealed Capsules

When `run:complete` succeeds:

1. An immutable `run-completed` event is appended to `events.jsonl`.
2. `state.json` status is set to `"completed"`.
3. All files in the capsule (`prompt.md`, `metadata.json`, `events.jsonl`, `state.json`) are set to read-only (`0o444`).
4. **All future mutation commands are permanently rejected**:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "completed runs are terminal and cannot be mutated"
  }
}
```

---

## 📖 5. How-To Guide: Sealing a Run

### Step 1: Dispose Any Orphan Evidence

Run doctor to check for orphan evidence:

```bash
bun harness.ts doctor --run .olt/capsules/<run-id>
```

If orphans are found, dispose them explicitly:

```bash
bun harness.ts orphan:dispose \
  --run .olt/capsules/<run-id> \
  --actor coordinator \
  --orphan-sha256 <orphan-sha> \
  --disposition superseded \
  --rationale "Worker-1 died mid-execution; task was re-dispatched and completed by Worker-2" \
  --evidence <new-command-id>
```

### Step 2: Release All Agent Grants

All subagents must be released before completion:

```bash
bun harness.ts agent:release \
  --run .olt/capsules/<run-id> \
  --agent worker-1 \
  --reason "run sealing"

bun harness.ts agent:release \
  --run .olt/capsules/<run-id> \
  --agent val-1 \
  --reason "run sealing"
```

### Step 3: Execute Terminal Completion

```bash
bun harness.ts run:complete \
  --run .olt/capsules/<run-id> \
  --actor coordinator \
  --auth-token <token-minted-by-critic:start>
```

Output:

```text
### 🎉 Run Completed Successfully: auth-engine
- **Capsule**: `.olt/capsules/auth-engine`
- **Summary**: 4 tasks executed, 4 independent validations passed, 1 critic sign-off
- **Total Gates Verified**: 5/5 gates green
- **Capsule Status**: Sealed & Auditable 🔒
```

### Step 4: Verify Capsule Health with Doctor

```bash
bun harness.ts doctor --run .olt/capsules/<run-id>
```

Expected Output:

```text
### Capsule Doctor: `.olt/capsules/auth-engine`
- **Healthy**: yes
- **Hash Chain Verified**: 142/142 events valid
- **Gitignored**: yes
- **Issues**: none
```

### Step 5: Stage & Commit Code to Git

```bash
# Export summary metrics
bun harness.ts summary:export --run .olt/capsules/<run-id> --out ./reports

# Review working tree
git status --short

# Commit verified changes
git add src/ tests/
git commit -m "feat(auth): implement token generation and revocation engine"
```

---

## 💻 6. Tutorial: End-to-End Run Sealing Walkthrough

### Context

Run `.olt/capsules/run-402` has 2 tasks (`task-jwt`, `task-schema`). Both are `validated`. The completeness critic (`critic-1`) has executed the run gate and approved review.

### 1. Attempt Sealing Without Token (Fails)

```bash
bun harness.ts run:complete --run .olt/capsules/run-402 --actor coordinator
```

Output:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"--auth-token is required"}}
```

### 2. Check for Active Leases

```bash
bun harness.ts agent:list --run .olt/capsules/run-402
```

Output shows `worker-jwt` still active. Release agent:

```bash
bun harness.ts agent:release --run .olt/capsules/run-402 --agent worker-jwt --reason "work finished"
```

### 3. Seal Run with Critic Token

```bash
bun harness.ts run:complete \
  --run .olt/capsules/run-402 \
  --actor coordinator \
  --auth-token CRITIC_TOK_88194
```

Verification Output:

```text
[1/9] Verifying all tasks done... OK (2/2)
[2/9] Checking open findings... OK (0 open)
[3/9] Auditing gate passes across domains... OK (code-quality: PASS, security: PASS)
[4/9] Verifying active leases... OK (0 active)
[5/9] Checking requirement proofs... OK (2/2 satisfied)
[6/9] Verifying critic certificate... OK (Verified digest)
[7/9] Inspecting disk artifacts... OK (openapi.json present, 14.2 KB)
[8/9] Checking repository bindings... OK (Tree matches gate post-state)
[9/9] Auditing cryptographic hash chain... OK (Genesis to Head valid)

Sealing capsule... DONE. Status: completed.
```

### 4. Verify Immutability

Attempting any modification now:

```bash
bun harness.ts task:claim --run .olt/capsules/run-402 --task task-jwt --agent imp-9 --role implementer
```

Output:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"completed runs are terminal and cannot be mutated"}}
```

---

[⬅ Previous: Completeness Critic Verification](./02-completeness-critic-verification.md) | [Master Table of Contents](../README.md) | [Next: Chapter 08 — Tamper-Proof Hash Chains ➡](../08-durability-recovery/01-tamper-proof-hash-chains.md)
