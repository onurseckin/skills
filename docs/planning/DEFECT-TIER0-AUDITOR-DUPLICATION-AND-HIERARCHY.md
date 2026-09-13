# Defect & Remediation Plan: Tier 0 Companion Auditor Duplication & Hierarchy Confinement

**Defect ID:** `DEFECT-TIER0-AUDITOR-DUPLICATION-AND-HIERARCHY`  
**Severity:** CRITICAL / ARCHITECTURAL  
**Category:** Orchestration / Role Confinement / Lifecycle  
**Target Repository:** `/Users/onurseckinsenoglu/repos/skills`  
**Status:** OPEN (Pending Planner Agent Enhancement & Autonomous Orchestration)

---

## 1. Executive Summary & Problem Statement

In the long-task orchestration system across **Optimizer Orchestrator**, **Orchestrator**, and **Mind** flows, companion auditors are experiencing duplicate deployments and hierarchical misassignments:

1. **Auditor Duplication:**
   - When an Orchestrator or Optimizer Orchestrator flow initializes, a companion `skill_auditor` is often already running in the host session or active capsule. Rather than detecting the existing running instance and latching onto it, the system frequently re-deploys a duplicate `skill_auditor`.
   - Similarly, in Mind flows where both `mind_auditor` and `skill_auditor` must be active, running instances are duplicated upon re-initialization or pulse restarts, leading to multiple competing auditor processes, telemetry chatter, and token burning.
2. **Hierarchical Boundary Breach (Non-Tier-0 Assignment):**
   - Both `mind_auditor` and `skill_auditor` are strictly **Tier 0 Out-of-Band Companion Agents** (`parent_agent_id: null`).
   - In several execution traces, auditors have been mistakenly registered or spawned with `--parent-agent` pointing to Tier 1 Orchestrator or Tier 2 Coordinators, violating the strict 4-Tier Hierarchical Confinement model and corrupting supervision topology.
3. **Harness Active Agent Check Gap:**
   - The OLT harness CLI lacks or fails to enforce an authoritative pre-spawn active agent check (e.g. against host `manage_subagents list`, active session registers, or mailbox endpoints) to prevent spawning when a live companion auditor already exists.

---

## 2. Mandatory Planning Directive: Planner Agent Problem Detection

> [!IMPORTANT]
> **Zero Main-Thread Code Peeking & Mandatory Planner Agent Enhancement:**  
> The main interactive thread is strictly forbidden from reading repository source code files or hand-crafting ad-hoc fixes for this defect.  
> **This plan requires dedicated Planner subagents (deployed by Tier 1 Optimizer Orchestrator) to detect the actual underlying issues, analyze the agent YAML definitions and harness CLI mechanisms, and enhance this plan before proceeding to implementation.**

### Responsibilities Delegated to Planner Agents:

- **Manifest Audit:** Perform static inspection and validation across agent YAML definitions:
  - `olt/agents/optimizer-orchestrator.yaml`
  - `olt/agents/orchestrator.yaml`
  - `olt/agents/mind.yaml`
  - `olt/agents/skill-auditor.yaml`
  - `olt/agents/mind-auditor.yaml`
- **Active Agent Checking Analysis:** Investigate how the OLT harness CLI (`agent:register`, companion deployment routines, and doctor checks) queries live agents and identify why existing instances are not recognized prior to deployment.
- **Hierarchical Confinement Verification:** Formulate concrete gate invariants verifying that `parent_agent_id` is unconditionally `null` for Tier 0 companions and that no supervisory tier can claim parent authority over them.
- **Plan Enhancement:** Update and refine this document with exact file coordinates, discriminating gate commands, and disjoint task scopes for Tier 3 Implementers.

---

## 3. Targeted Remediation Scope (Preliminary)

### Pillar 1: Agent YAML Manifest Double-Check & Schema Alignment

- Double-check all agent YAML definitions:
  - Ensure `skill-auditor.yaml` and `mind-auditor.yaml` explicitly declare `tier: 0`, `parent_agent_id: null`, and `companion: true`.
  - Ensure `optimizer-orchestrator.yaml`, `orchestrator.yaml`, and `mind.yaml` specify idempotent companion pairing contracts rather than direct child-agent spawning.
  - Ban any declaration that allows Tier 1 or Tier 2 agents to adopt auditors as child subordinates.

### Pillar 2: OLT Harness CLI Active Agent Check & De-duplication Guard

- In the OLT harness CLI:
  - Implement/verify an active agent pre-flight check before initiating companion deployment.
  - Query host active subagent state (`manage_subagents list`, capsule state, or mailbox ping).
  - If a running auditor of the required type already exists:
    - Re-use the running instance.
    - Send an IPC handshake (`PING` / `HANDSHAKE`) instead of calling `invoke_subagent` or `agent:register`.
    - Log an informational notice (`AUDITOR_ALREADY_ACTIVE_REUSED`).
  - Mechanically block duplicate spawns if an active auditor exists.

### Pillar 3: Strict Tier 0 Hierarchy Confinement Engine

- Enforce in `agent:register` and `watchdog:role-boundary`:
  - If `agent` or `role` is `skill_auditor` or `mind_auditor`, reject any request where `parent_agent` is specified or non-null.
  - Reject supervisory attempts from Tier 1 (`orchestrator`) or Tier 2 (`coordinator`) to register auditors as child tasks.

---

## 4. Verification & Quality Gates

1. **Unit & Invariant Tests:**
   - Dedicated test suite asserting that companion pairing logic returns existing instances when already registered.
   - Negative test asserting that attempting to register an auditor with a parent agent triggers a mechanical rejection (`ROLE_CONFINEMENT_VIOLATION`).
2. **Manifest Schema Compliance:**
   - Automated YAML schema validation ensuring all manifests comply with Tier 0 companion specifications.
3. **Modularity & Purity:**
   - Zero files exceeding 400 lines, zero directories exceeding 10 files, named facades intact.
   - Zero test skipping (`--no-verify` banned).

---

## 5. Execution Protocol & Ownership

- **Lead Orchestration:** Tier 1 Autonomous Optimizer Orchestrator (`optimizer_orchestrator`).
- **Supervisory Auditing:** Tier 0 Out-of-Band Companion Skill Auditor (`skill_auditor`).
- **Decomposition & Implementation:** Leased Tier 3 Implementers via Tier 2 Domain Coordinators in isolated worktrees following enhanced planner specifications.
