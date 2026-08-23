# 03. Troubleshooting, Blunder Dictionary & FAQ

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

---

## 🧯 The Architectural Blunder & Error Code Dictionary

Every refusal emitted by `olt` is a deterministic mechanical barrier designed to stop silent corruption before it occurs. This section catalogs all major error codes, root causes, and exact recovery procedures:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE ERROR CODE & BLUNDER TAXONOMY                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ CONCURRENCY & SCHEDULING BLUNDERS ]                                      │
│    • FALSE_SERIALIZATION_BLUNDER   --> Dispatching 1 worker when N are ready│
│    • WRITE_SCOPE_VIOLATION         --> Mutating files outside lease boundary│
│    • UNJUSTIFIED_DEPENDENCY        --> depends_on edge without --dep-reason │
│                                                                             │
│  [ INTEGRITY & FREEZE BLUNDERS ]                                            │
│    • INVALID_STATE_FROZEN_REVISION --> Attempting to mutate compiled graph  │
│    • STALE_PLAN_DIGEST             --> Plan modified underneath active lease│
│    • TORN_TAIL_DETECTED            --> Cryptographic hash chain corruption  │
│    • LOCK_TIMEOUT                  --> Kernel POSIX flock contention        │
│                                                                             │
│  [ VALIDATION & COMPLETION BLUNDERS ]                                       │
│    • CONTAMINATED_VALIDATOR        --> Validator not independent or reused  │
│    • UNANSWERED_FINDING            --> Signing off with open probe / defect │
│    • UNPROVEN_REQUIREMENT          --> Critic missing independent proof cmd │
│    • EMPTY_NON_SUBSTANTIVE_GATE    --> Gate lacks verifiable command target │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 1. `FALSE_SERIALIZATION_BLUNDER`

#### The Failure Mode

The coordinator calls `queue:wave` and receives multiple ready, conflict-free tasks (e.g., 3 tasks in Wave 1). Instead of dispatching 3 parallel implementer agents, the coordinator dispatches 1 agent, waits for completion, and then dispatches the next. This turns a high-performance parallel graph into a serial waterfall.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"FALSE_SERIALIZATION_BLUNDER","message":"Anti-serialization interlock tripped: Wave 1 contains 3 ready, conflict-free tasks [task-auth, task-billing, task-analytics], but only 1 agent was dispatched. Serializing parallel-ready work is prohibited. You MUST dispatch all 3 concurrent lanes simultaneously using task:claim across distinct agent identities.","issues":[{"claimable_tasks":["task-auth","task-billing","task-analytics"],"available_capacity":4}]}}
```

#### Remediation Workflow

1. Register distinct agent identities for each ready lane via `agent:register`.
2. Issue simultaneous `task:claim` calls across distinct agent identities.
3. If serial execution is genuinely required due to unmodeled external constraints, pass `--serialize-reason "<justification>"`.

---

### 2. `WRITE_SCOPE_VIOLATION`

#### The Failure Mode

An implementer or repairer modifies or creates a file outside its leased write scope directory tree.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"WRITE_SCOPE_VIOLATION","message":"task-auth touched files outside its declared write scope: [src/database/schema.ts]. Leased scope is strictly confined to [src/auth/**].","issues":[{"unauthorized_files":["src/database/schema.ts"]}]}}
```

#### Remediation Workflow

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WRITE SCOPE VIOLATION RESOLUTION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Did the task modify shared infrastructure or another task's scope?         │
│                                                                             │
│    ├──► YES: Revert unauthorized changes (git checkout src/database).       │
│    │         If the change is necessary, request formal replan via          │
│    │         plan:replan to assign a dedicated integration task.            │
│    │                                                                        │
│    └──► NO:  The write scope was declared too narrowly in plan:add.         │
│              Issue plan:replan with an expanded scope allocation.           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. `UNJUSTIFIED_DEPENDENCY`

#### The Failure Mode

A task declaration includes `--deps` edges without supplying corresponding `--dep-reason` justifications for every prerequisite.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"dependency edge(s) without a declared justification: task-api -> task-db. Pass plan:add --dep-reason <dep-id>:\"<why this edge exists>\" for each one before compiling.","issues":[]}}
```

#### Remediation Workflow

Provide the exact read/write data-flow rationale for each edge:

```bash
bun harness.ts plan:add --run .olt/capsules/<slug> --actor planner --id task-api \
  --deps task-db --dep-reason "task-db:imports database client generated by task-db" ...
```

---

### 4. `CONTAMINATED_VALIDATOR` / `VALIDATOR_INDEPENDENCE_VIOLATION`

#### The Failure Mode

An agent attempts to validate a task when it:

1. Previously implemented or submitted work for that task.
2. Holds a coordinator or planner role grant.
3. **Previously validated that exact task in an earlier repair round.**

#### Verbatim Output

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"validator must be independent from implementers and cannot validate the same task across multiple repair rounds","issues":[]}}
```

#### Remediation Workflow

Release the prior validator and register a brand-new validator identity:

```bash
bun harness.ts agent:release --run .olt/capsules/<slug> --agent val-1 --reason "Round 1 complete"
bun harness.ts agent:register --run .olt/capsules/<slug> --agent val-2 --role validator --parent-agent coordinator-1 --parent-task <task-id>
bun harness.ts task:validate-start --run .olt/capsules/<slug> --task <task-id> --validator val-2
```

---

### 5. `UNANSWERED_FINDING`

#### The Failure Mode

A validator attempts to pass a task (`task:review --status pass`) while open defect findings or probe demands remain unresolved.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"cannot pass task-auth: 1 open finding(s) unanswered: finding-auth-01; answer each with --resolve <finding-id>=<command-id>","issues":[]}}
```

#### Remediation Workflow

Run the verification command and pass `--resolve "<finding-id>=<cmd-id>"` for **every** open finding:

```bash
bun harness.ts task:review --run .olt/capsules/<slug> --task task-auth --validator val-2 \
  --token <token> --status pass --checks <cmd-id> --resolve "finding-auth-01=<cmd-id>"
```

---

### 6. `UNPROVEN_REQUIREMENT`

#### The Failure Mode

The Completeness Critic attempts to approve a run without attaching independent command receipts for all prompt obligations.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"INTEGRITY","message":"clean completion review leaves requirements unproven: [req-2]. Every requirement must be evidenced by an independent critic command execution.","issues":[{"unproven":["req-2"]}]}}
```

#### Remediation Workflow

The critic must execute its own verification command (unbound to any task) and include the reference in `--proofs-file`:

```bash
CMD=$(bun harness.ts run:exec --format json --run .olt/capsules/<slug> --actor critic-1 -- bun test tests/req2.test.ts | bun -e 'console.log(JSON.parse(process.argv[1]).result.command_id)')
# Include CMD in /tmp/proofs.json and call critic:review --proofs-file /tmp/proofs.json
```

---

### 7. `LOCK_TIMEOUT`

#### The Failure Mode

A command fails to acquire the POSIX `flock` on `.olt/capsules/<slug>/state.json` within the 5000ms deadline.

#### Verbatim Output

```text
{"ok":false,"error":{"code":"LOCK_TIMEOUT","message":"Failed to acquire exclusive lock on .olt/capsules/slug/state.json after 5000ms. Another process is holding the capsule lock.","issues":[]}}
```

#### Remediation Workflow

1. Check running processes: `ps aux | grep harness.ts`.
2. If an agent process crashed ungracefully while holding the lock, run recovery diagnostics:

```bash
bun harness.ts recover --run .olt/capsules/<slug> --actor coordinator-1
```

---

## 🛠️ Step-by-Step Diagnostic & Recovery Workflows

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CRASH RECOVERY & LEASE RECLAMATION                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Scenario: Implementer agent died or disconnected mid-execution.           │
│                                                                             │
│  1. Run Capsule Doctor:                                                     │
│     $ bun harness.ts doctor --run .olt/capsules/<slug>                          │
│     --> Identifies expired leases and orphaned branches.                   │
│                                                                             │
│  2. Execute Lease Recovery:                                                 │
│     $ bun harness.ts recover --run .olt/capsules/<slug> --actor coordinator     │
│     --> Returns expired leases to 'retry_ready' state.                      │
│     --> Reopens interrupted validation attempts.                            │
│     --> Preserves frozen branched parents.                                  │
│                                                                             │
│  3. Re-dispatch Work:                                                       │
│     $ bun harness.ts queue:wave --run .olt/capsules/<slug>                      │
│     --> Reclaimed task is claimable immediately in current wave.            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ❓ Frequently Asked Questions (FAQ)

### Q: How does Work/Span scaling determine optimal concurrency?

The scheduler calculates Total Work $W = \sum \text{effort}$ and Critical Path Span $S$. According to **Brent's Theorem**, maximum efficiency occurs at:
$$P = \left\lceil \frac{W}{S} \right\rceil$$
The scheduler clamps wave width to $\min(\text{max\_parallel}, P)$, preventing coordinator context exhaustion while maximizing throughput.

### Q: What is the difference between `task:probe` and `task:reject`?

| Comparison Property   | `task:probe`                  | `task:reject`                             |
| :-------------------- | :---------------------------- | :---------------------------------------- |
| **Semantic Nature**   | Non-defect demand for proof   | Formal defect finding                     |
| **Task Status**       | Stays `validating`            | Transitions to `changes_requested`        |
| **Repair Budget**     | Does NOT consume repair round | Increments `repair_round` ($+1$)          |
| **Worker Assignment** | Same validator continues      | Worker claims under `--role repairer`     |
| **Mandatory Flags**   | `--demand`, `--revalidation`  | `--severity`, `--remediation`, `--checks` |

### Q: How do I submit an investigation task that legitimately required no code changes?

If an implementer confirms that existing code already satisfies requirements, submit using `--no-op --reason "<why>"`:

```bash
bun harness.ts task:submit --run .olt/capsules/<slug> --task <task-id> --agent <agent-id> \
  --token <token> --summary "Investigation complete" \
  --no-op --reason "Existing implementation already passes all test fixtures."
```

`task:submit` compares disk content digests at claim vs submission. Byte-identical submissions without `--no-op` are rejected as unexecuted work.

### Q: How does the Supervisory Watchdog monitor long tasks?

The watchdog runs background health checks on active leases, detecting dead worker processes and stale tokens without blocking the main event loop:

```bash
bun harness.ts watchdog:status --run .olt/capsules/<slug>
bun harness.ts watchdog:verify --generation 1
```

---

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)
