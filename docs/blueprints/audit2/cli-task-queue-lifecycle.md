# CLI Task & Queue Lifecycle Routing Audit

## 1. Exact Unconstrained Finding Count

Based on an inspection of the task and queue registries, there are **20 exported command endpoints** orchestrating the Task and Todo lifecycles within the harness.

### **Task Registry (`TASK_COMMANDS`) - 11 Commands**

1. `task:brief` - Generates zero-exploration exact-anchor briefs.
2. `task:claim` - Claims a write lease under a role.
3. `task:heartbeat` - Extends lease duration.
4. `task:submit` - Submits completed work with a write-scope digest and report.
5. `task:validate-start` - Dispatches an independent validator against a submission.
6. `task:review` - Records a pass or fail validator verdict and gate evidence.
7. `task:probe` - Records a mandatory adversarial probe demand.
8. `task:reject` - Records a specific defect and returns task to `changes_requested`.
9. `task:assign-repairer` - Evicts and re-assigns a repairer.
10. `task:abandon` - Clears dead/stale leases.
11. `task:check` - Executes fast incremental syntax and lint checks.

### **Queue Registry (`QUEUE_COMMANDS`) - 4 Commands**

12. `queue:next` - Inspects the highest-priority ready task.
13. `queue:list` - Partitions and displays the whole run queue.
14. `queue:wave` - Determines concurrent wave dispatches under Brent scaling ($P = W / S$).
15. `queue:pop` - Atomically claims and mints a lease for the next task.

### **Todo / Mind Queue (`todo-ops.ts`) - 5 Commands**

16. `todo:list` - Filters and lists items.
17. `todo:add` - Ingests feedback/requirements.
18. `todo:drain` - Pops items for processing.
19. `todo:seal` - Seals resolutions.
20. `todo:clean` - Archives sealed issues.

---

## 2. Call Graphs & Queue Lifecycle Routing

The core implementation routing follows a strict Tier 2/Tier 3 state machine:

### **A. Initial Implementation Loop**

1. **`queue:pop`** (or `task:claim`)
   - Invokes `claimTask` in the core workflow.
   - Evaluates caller's role (`ROLE_CONFINEMENT_VIOLATION` block if `orchestrator`, `coordinator`, or `validator` tries to claim an implementer lease).
   - Generates exact-anchor briefing via `buildExactAnchorBriefing`.
   - Emits a Token and transitions to **`leased`**.
2. **`task:heartbeat`**
   - Calls `heartbeat(port, taskId, agent, token)`.
   - Bumps expiration deadlines.
3. **`task:submit`**
   - Reads provided `--summary` or `--report`.
   - Generates digest of `write_scope`. If identical to claim time without `--no-op`, fails instantly.
   - Optionally commits worktree (`commitSubphaseIfAssigned`) for data isolation.
   - Transitions task to **`submitted`**.

### **B. Validation & Micro-Cycle Loop**

4. **`task:validate-start`**
   - Assigns a validator domain.
   - Mints a validation token.
   - Transitions task to **`validating`**.
5. **`task:probe`** (Optional Adversarial Validation)
   - Dispatches a demand against the implementer.
   - Accumulates demands requiring resolution via `recordProbe`.
6. **`task:review` / `task:reject`**
   - **Micro-Cycles:** If `--micro-cycle` or `--in-lease` is passed, routing redirects to `recordMicroCycleCritique`. State remains in-lease and bypasses hard workflow rejection.
   - **Hard Fail (`task:reject` / `task:review --status fail`):** Calls `recordReview` -> task transitions to **`changes_requested`** (ready for repair).
   - **Pass (`task:review --status pass`):** Ensures all open findings are answered, verifies `checklist-domain` logic, performs `isUiTask` dual-channel audits, and calls `finalizePassingTask` -> task transitions to **`done`**. Unblocks child DAG nodes.

---

## 3. Flag Routing Mechanics

Commands process input through deterministic static extraction (e.g., `textFlag`, `boolFlag`, `listFlag`, `integerFlag`).

- Validation executes in real-time on extraction. Ex: `integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 })`.
- Unknown or invalid flags trigger immediate runtime `HarnessError` (no unshielded JSON or messy stack traces leak to the agent).
- `no-op` routing requires explicit coupling with `reason` routing logic.
- Evidence paths (like `files-changed`, `evidence`) process as lists directly matching execution receipts from the shell layer.

---

## 4. Zero-JSON Compliance

- All `ops` files strictly respect the `Zero-JSON CLI Surface` rule.
- While handlers interact deeply with state representations (`TaskRecord`, `WorkflowState`, `.json` storage files) and their signatures reflect `Record<string, unknown>`, their responses prioritize a rigorously generated `markdown` attribute.
- Formatters (e.g., `formatTaskClaimBrief`, `formatTaskReviewPassBrief`, `formatQueueEmptyBrief`) build clean, token-efficient string layouts of less than 30 lines.
- Agents interacting with the CLI receive these rendered markdown strings directly on standard out, fulfilling the requirement of zero raw JSON payloads blocking the model context window.

---

## 5. Current Live Code Verification Assessment

- **Anti-Serialization interlocks are active:** Multi-lane partitioning in `queue:wave` executes Brent topological decoupled reads correctly.
- **Role Boundary Hard Locks are implemented:** `task-claim.ts` throws explicit containment violations when `coordinator`, `validator`, or `mind` attempts to intercept code task leases.
- **Micro-cycles:** Explicit 1-hop micro-cycles natively supported via `--in-lease` or `--micro-cycle` flags inside `task:review` and `task:reject` logic, ensuring agents can repair dynamically without resetting main topology leases.
- **Strict Evidence and Write Scope Integrity:** Write scopes are deterministically hashed via `hashWriteScope` and validated during `task:submit`. Unexplained no-op tasks are explicitly refused. Code is highly rigorous and strongly maps to `AGENTS.md` operating directives.
