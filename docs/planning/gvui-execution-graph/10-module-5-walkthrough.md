# Module 5: End-to-End Walkthrough & Worked Examples

**Document**: `docs/planning/gvui-execution-graph/10-module-5-walkthrough.md`  
**Date**: 2026-08-15  
**Status**: Concrete Reference Trace & Worked Execution Example  
**Subsystem**: End-to-End Cascading Execution Protocol

---

## 1. Scenario Context: The GVUI Execution Graph Run

- **Capsule**: `/Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan`
- **Initial Scope**: Implementation of Edge Drawer and Hierarchical Layout engine for GVUI.
- **Initial DAG (Revision 1)**:
  - `task-01-types`: `src/contracts/` (Status: `done`)
  - `task-02-drawer`: `src/components/EdgeDetailDrawer/` (Status: `done`)
  - `task-03-layout`: `src/engine/layout/` (Status: `done`)
- **Initial Run Gate**: `gate-run-completion` passed exit code 0.

---

## 2. Step-by-Step Execution Trace

### Step 1: Critic Session Claim (`critic:start`)

The Tier 3 Completeness Critic initializes an independent session:

```bash
bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts critic:start \
  --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan \
  --critic critic-attempt-1
```

**Output**:

```markdown
### Completeness Critic Session Started

- **Critic ID**: `critic-attempt-1`
- **Lease Token**: `tok_critic_78dfa91b`
- **Tasks Satisfied**: 3/3 tasks completed
- **Requirements Evidenced**: 3/3 requirements evidenced
- **Status**: Audit authorized against immutable prompt and repository diff.
```

---

### Step 2: Critic Audits & Detects Cross-Module Defects

The Critic reviews `prompt.md` line-by-line against `git diff` and finds 2 unaddressed edge cases:

1. `src/components/EdgeDetailDrawer/EdgeDrawer.tsx`: Missing toggle callback causing TS2322 compile diagnostic.
2. `src/engine/layout/hierarchical.ts`: Negative canvas coordinate clamping omitted.

**Critic Invariant**: The Critic **DOES NOT EDIT CODE**. It writes structured findings to `review.json`.

```json
{
  "packet_id": "packet-critic-audit-1",
  "critic_token": "tok_critic_78dfa91b",
  "graph_revision": 1,
  "status": "findings",
  "readiness_sha256": "4b9e2...",
  "repository_binding": { "head_sha": "e1f2a3...", "dirty": true },
  "integrity_evidence": [{ "status": "passed", "issues": [] }],
  "repository_command_ids": ["cmd-001-init"],
  "checks": [{ "command_id": "cmd-critic-diff-check" }],
  "findings": [
    {
      "id": "F-DRAWER-01",
      "requirement_id": "req-drawer",
      "severity": "critical",
      "file_paths": ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
      "observation": "TypeScript TS2322 in drawer toggle handler.",
      "remediation": "Add onToggle optional prop to EdgeDrawerProps.",
      "revalidation_gate": "bun test tests"
    },
    {
      "id": "F-LAYOUT-01",
      "requirement_id": "req-layout",
      "severity": "important",
      "file_paths": ["src/engine/layout/hierarchical.ts"],
      "observation": "Negative coordinates crash layout projection bounds.",
      "remediation": "Clamp bounding boxes to min 0,0 before node placement.",
      "revalidation_gate": "bun test tests"
    }
  ],
  "unresolved_finding_ids": ["F-DRAWER-01", "F-LAYOUT-01"],
  "requirement_proofs": [],
  "residual_risks": []
}
```

The Critic submits the rejection:

```bash
bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts critic:review \
  --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan \
  --critic critic-attempt-1 \
  --token tok_critic_78dfa91b \
  --decision request_changes \
  --review review.json
```

---

### Step 3: Coordinator Dynamic Scope Partitioning & Re-Planning

The Coordinator ingests `findings` from `state.json` and runs `partitionFindingsIntoScopes(findings, 1)`:

- **Cluster 1**: `src/components/EdgeDetailDrawer/` $\to$ Task `repair-R1-drawer`
- **Cluster 2**: `src/engine/layout/` $\to$ Task `repair-R1-layout`

The Coordinator executes `plan:replan` (or registers tasks and advances graph to Revision 2).

---

### Step 4: Parallel Batch `invoke_subagent` Dispatch

The Coordinator dispatches both repair lanes concurrently in a single tool call:

```typescript
invoke_subagent({
  Subagents: [
    {
      TypeName: "self",
      Role: "Repair Implementer: Edge Drawer",
      Prompt:
        "Claim repair-R1-drawer, fix F-DRAWER-01 in src/components/EdgeDetailDrawer/, submit task.",
    },
    {
      TypeName: "self",
      Role: "Repair Validator: Edge Drawer",
      Prompt:
        "Validate repair-R1-drawer, run gate proof bun test tests via run:exec, verify fix, review pass.",
    },
    {
      TypeName: "self",
      Role: "Repair Implementer: Layout Engine",
      Prompt: "Claim repair-R1-layout, fix F-LAYOUT-01 in src/engine/layout/, submit task.",
    },
    {
      TypeName: "self",
      Role: "Repair Validator: Layout Engine",
      Prompt:
        "Validate repair-R1-layout, run gate proof bun test tests via run:exec, verify fix, review pass.",
    },
  ],
});
```

---

### Step 5: Parallel Worker Implementation & Submission

#### Lane 1: Edge Drawer

```bash
# Worker Claims
bun harness.ts task:claim --run $RUN --task repair-R1-drawer --agent worker-drawer --lease-seconds 1800
# Worker fixes EdgeDrawer.tsx Props
# Worker Submits
bun harness.ts task:submit --run $RUN --task repair-R1-drawer --agent worker-drawer --token tok_drawer_123 --summary "Added onToggle callback to EdgeDrawerProps"
```

#### Lane 2: Layout Engine

```bash
# Worker Claims
bun harness.ts task:claim --run $RUN --task repair-R1-layout --agent worker-layout --lease-seconds 1800
# Worker adds Math.max(0, coord) clamping in hierarchical.ts
# Worker Submits
bun harness.ts task:submit --run $RUN --task repair-R1-layout --agent worker-layout --token tok_layout_456 --summary "Added coordinate clamping in hierarchical layout engine"
```

---

### Step 6: Parallel Validator Gate Proofs & Passing Reviews

#### Lane 1 Validator

```bash
bun harness.ts task:validate-start --run $RUN --task repair-R1-drawer --validator validator-drawer
bun harness.ts run:exec --run $RUN --task repair-R1-drawer --actor validator-drawer -- bun test tests
bun harness.ts task:review --run $RUN --task repair-R1-drawer --validator validator-drawer --token tok_val_drawer --status pass --summary "TS2322 resolved; drawer tests pass"
```

#### Lane 2 Validator

```bash
bun harness.ts task:validate-start --run $RUN --task repair-R1-layout --validator validator-layout
bun harness.ts run:exec --run $RUN --task repair-R1-layout --actor validator-layout -- bun test tests
bun harness.ts task:review --run $RUN --task repair-R1-layout --validator validator-layout --token tok_val_layout --status pass --summary "Clamping verified; layout regression tests pass"
```

---

### Step 7: Re-Convergence, Final Gate & Capsule Sealing

1. **Barrier Releases**: Both `repair-R1-drawer` and `repair-R1-layout` are `done`.
2. **Coordinator Executes Final Run Gate**:
   ```bash
   bun harness.ts run:exec --run $RUN --gate gate-run-completion --actor coordinator -- bun test tests
   ```
3. **Round 2 Critic Session Authorization**:
   ```bash
   bun harness.ts critic:start --run $RUN --critic critic-attempt-2
   ```
4. **Critic Approves (Clean Audit Certificate)**:
   ```bash
   bun harness.ts critic:review --run $RUN --critic critic-attempt-2 --token tok_critic_round2 --decision approve --summary "All prompt requirements satisfied; both repair tasks verified; zero compiler diagnostics; all gates green."
   ```
5. **Coordinator Seals Capsule**:
   ```bash
   bun harness.ts run:complete --run $RUN --actor coordinator
   ```

**Final Output**:

```markdown
### Run Completed Successfully: 2026-08-15-cascading-replanning-deep-plan

- **Capsule Path**: `/Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan`
- **Total Tasks Satisfied**: 5/5 tasks done (3 original + 2 repair wave tasks)
- **Mandatory Gates Passed**: 5/5
- **Status**: COMPLETE & SEALED (Cryptographic Certificate Issued)
```
