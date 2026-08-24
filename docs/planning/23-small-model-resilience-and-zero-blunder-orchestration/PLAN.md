# Plan 23: Small-Model Resilience & Zero-Blunder Orchestration Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently harden the OLT agent architecture, role contracts, YAML manifests, and host references against the 6 critical small-model failure modes discovered in conversation `8b1c3333-a00c-4dc3-871d-8f72b3b3465a` (initiation paralysis on `/olt mind`, tool hallucinations of non-existent SDKs, background bash sleep scripts, empty payload crashes, directory pollution, and gate-proof manual linking traps).

**Architecture:**

1. **Turn 0 Autonomous Wake-up Invariant**: Injects explicit zero-prompt boot directives into `mind.yaml` and `mind.md`.
2. **Host Tools vs Harness CLI Separation**: Creates authoritative `olt/references/host-environment.md` cataloging native host tools vs harness CLI commands.
3. **Role Contract Negative Constraints**: Injects rigid `must_not` clauses against prompt stalls, sleep scripts, empty payloads, and supervisor test executions.
4. **Auto-Gate Proof Attachment**: Enhances `run:exec` in `olt/scripts/src/cli/commands/run-ops.ts` to automatically record cryptographic gate proofs into active capsule ledgers.

**Tech Stack:** TypeScript, Bun, YAML manifests, Markdown role contracts.

**Spec:** `AGENTS.md` (Axiom 1: Instruction Precedence, Axiom 4: Zero-Exploration Briefings, Axiom 28: Shielded Shell).

## Global Constraints

- 0 `any` annotations.
- `bun run typecheck` must pass after every task.
- Zero tool hallucinations: never invent non-existent host SDKs.

---

### Task 1: Harden Agent YAML Manifests Against Small-Model Failure Modes

**Files:**

- Modify: `olt/agents/mind.yaml`, `orchestrator.yaml`, `coordinator.yaml`, `implementer.yaml`, `validator.yaml`
- Test: `tests/unit/agents/agent-manifests.test.ts`

- [ ] **Step 1: Write failing unit test verifying manifest invariants (autonomous wake-up, non-empty payload mandate, root scratch hygiene)**
- [ ] **Step 2: Update YAML manifests with explicit constraints**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add olt/agents/ tests/unit/agents/agent-manifests.test.ts
git commit -m "feat(agents): harden agent YAML manifests against small-model failure modes"
```

---

### Task 2: Harden Role Markdown Contracts with Explicit Failure-Mode Constraints

**Files:**

- Modify: `olt/roles/mind.md`, `orchestrator.md`, `coordinator.md`, `implementer.md`, `validator.md`
- Test: `tests/unit/roles/role-contracts.test.ts`

- [ ] **Step 1: Write failing unit test verifying may/must_not clauses**
- [ ] **Step 2: Update role markdown contracts**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add olt/roles/ tests/unit/roles/role-contracts.test.ts
git commit -m "feat(roles): harden role contracts with explicit failure-mode constraints"
```

---

### Task 3: Author Authoritative Host Environment Contract Reference

**Files:**

- Create: `olt/references/host-environment.md`
- Test: `tests/unit/references/host-environment.test.ts`

- [ ] **Step 1: Author comprehensive `host-environment.md` cataloging native host tools vs OLT harness CLI**
- [ ] **Step 2: Verify all host tools and harness commands are documented**
- [ ] **Step 3: Commit**

```bash
git add olt/references/host-environment.md tests/unit/references/host-environment.test.ts
git commit -m "docs(references): create authoritative host environment contract reference"
```

---

### Task 4: Integrate Automatic Gate Proof Attachment into `run:exec`

**Files:**

- Modify: `olt/scripts/src/cli/commands/run-ops.ts`
- Test: `tests/unit/cli/run-ops-auto-gate.test.ts`

- [ ] **Step 1: Write failing unit test for automated gate proof attachment**
- [ ] **Step 2: Implement auto-gate proof recording in `run:exec`**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit & Sync**

```bash
git add olt/scripts/src/cli/commands/run-ops.ts tests/unit/cli/run-ops-auto-gate.test.ts
git commit -m "feat(cli): integrate automatic gate proof attachment into run:exec"
bun scripts/sync-global.ts
```
