# Forensics Audit Report: Agent Manifests (`olt/agents/`) vs Role Contracts (`olt/roles/`)

**Status:** Complete Forensic Audit & Single-Source-of-Truth (SSoT) Architecture Blueprint  
**Target Repository:** `@onurseckin/skills`  
**Auditor:** Architecture & Git History Forensics Auditor  
**Date:** 2026-08-24

---

## 1. Executive Summary & Forensic Verdict

### Forensic Verdict: **Accidental Regression via Documentation Commit (`5d797ef7`)**

A comprehensive, non-destructive audit of the Git commit history, runtime loading architecture, and content parity confirms:

1. **The Intended Architecture is Single Source of Truth (SSoT) YAML Manifests (`olt/agents/*.yaml`):**
   As formally architected in [unified-agent-architecture-plan.md](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/unified-agent-architecture-plan.md) and implemented in commit [`a4d4a25a`](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/unified-agent-architecture-plan.md#L16-L22), the repository transitioned from dual file trees (`olt/agents/*.yaml` + `olt/roles/*.md`) to a unified, schema-validated Single Source of Truth (`olt/agents/<role>.yaml`). In that consolidation commit, **all 22 markdown role files in `olt/roles/` were deliberately deleted**.

2. **Accidental Resurrection in Commit [`5d797ef7`](file:///Users/onurseckinsenoglu/repos/skills/docs/planning/20-tier-0-dual-cognitive-auditors-and-live-stagnation-governance/POST_ANALYSIS.md):**
   When post-analysis reports for plans 20–25 were committed under `docs/planning/`, the working tree or staging environment inadvertently included a stale, untracked/reverted copy of `olt/roles/`. This caused all 22 deleted markdown files to be accidentally re-committed into the repository.

3. **Subsequent Drift in Commit [`4e3290cb`](file:///Users/onurseckinsenoglu/repos/skills/tests/unit/agents/agent-triad.test.ts):**
   During unit test coverage expansion, minor edits were made directly to `olt/roles/*.md` (updating pushback limits) and two files (`independent-planner.md`, `independent-planner-audit.md`) were deleted from `olt/roles/` while their canonical counterparts (`independent-planner.yaml`, `independent-planner-audit.yaml`) remained active in `olt/agents/`, introducing cross-directory divergence.

4. **Runtime Inverted Precedence Flaw:**
   - [manifest-parser.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest-parser.ts#L953-L986) correctly prioritizes `olt/agents/*.yaml` first, only checking `roles/` if the YAML manifest is missing.
   - However, [packets/role-contract.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/role-contract.ts#L247-L288) contains an inverted precedence check: it checks `resolveRoleContractPath(role)` (`olt/roles/<role>.md`) _first_, falling back to `olt/agents/<role>.yaml` only if the markdown file does not exist. Because `olt/roles/` was resurrected, packet grants are currently reading the stale markdown contracts rather than the unified YAML manifests.

---

## 2. Chronological Git Commit History & Timeline Analysis

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CHRONOLOGICAL COMMIT TIMELINE                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ Sun Aug 23 02:44 ] Commit 2db78df8: feat(olt): rename skill to olt & storage to .olt          │
│                       • Initial introduction of both olt/agents/ and olt/roles/                 │
│                                                                                                  │
│  [ Sun Aug 23 23:16 ] Commit 89d1c087: feat(agents): add independent-planner manifests & roles   │
│                       • Created independent-planner.yaml/.md and audit variants                  │
│                                                                                                  │
│  [ Sun Aug 23 23:45 ] Blueprints Phase: 7205e474, b5b2b9a9, 357ae569                             │
│                       • Codified Unified Agent Architecture Plan (SSoT YAML + retirement of roles)│
│                                                                                                  │
│  [ Mon Aug 24 00:15 ] Commit 165c94d1: feat(authority): implement unified agent manifest schema │
│                       • Added manifest-schema.ts, permission-health.ts, validate-agent-manifests │
│                                                                                                  │
│  [ Mon Aug 24 00:27 ] Commit a4d4a25a: feat(agents): consolidate SSoT unified agent manifests   │
│                       ★ INTENDED CONSOLIDATION: DELETED all 22 files in olt/roles/*.md           │
│                       • Consolidated all instructions & runbooks into olt/agents/*.yaml          │
│                                                                                                  │
│  [ Mon Aug 24 00:30-02:15 ] Intermediate Commits: 63627974, cd04fe57, 2d94b488, 56192565,       │
│                             a0529c68, b0c2ebf7 (Audits 1 & 2 remediations; olt/roles/ absent)    │
│                                                                                                  │
│  [ Mon Aug 24 02:29 ] Commit 5d797ef7: docs: add post analysis reports for plans 20-25           │
│                       ⚠ ACCIDENTAL REGRESSION: Resurrected all 22 files in olt/roles/*.md        │
│                       • Staged with POST_ANALYSIS.md files from a dirty/untracked tree           │
│                                                                                                  │
│  [ Mon Aug 24 02:47 ] Commit 4e3290cb: test: add unit test coverage suites & interactive html    │
│                       • Modified resurrected olt/roles/*.md and deleted independent-planner*.md  │
│                       • Left olt/agents/ untouched, creating desynchronization                   │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Git Commit Table

| Commit SHA                                                                                                                                                 | Timestamp           | Author              | Commit Subject                                                                                          | Impact on `olt/roles/` & `olt/agents/`                                                                                       |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ | :------------------ | :------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| [`2db78df8`](file:///Users/onurseckinsenoglu/repos/skills/olt/SKILL.md)                                                                                    | 2026-08-23 02:44:15 | Onur Seckin Senoglu | `feat(olt): rename skill directory to olt and governance storage to .olt`                               | Initial creation of 26 agent YAMLs and 20 role Markdown files.                                                               |
| [`89d1c087`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/independent-planner.yaml)                                                             | 2026-08-23 23:16:21 | Onur Seckin Senoglu | `feat(agents): add independent planner and independent planner audit manifests and roles`               | Added `independent-planner.yaml`, `independent-planner-audit.yaml`, and corresponding `.md` files.                           |
| [`165c94d1`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest-schema.ts)                                                    | 2026-08-24 00:15:30 | Onur Seckin Senoglu | `feat(authority): implement unified agent manifest schema, permission health engine, and AST validator` | Introduced type definitions and AST validator for unified YAML schema.                                                       |
| [`a4d4a25a`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/validator.yaml)                                                                       | 2026-08-24 00:27:28 | Onur Seckin Senoglu | `feat(agents): consolidate SSoT unified agent manifests and deterministic dispatch engine`              | **DELETED all 22 files in `olt/roles/*.md`** (`-2182 lines`). Consolidated full instructions into `olt/agents/*.yaml`.       |
| [`5d797ef7`](file:///Users/onurseckinsenoglu/repos/skills/docs/planning/20-tier-0-dual-cognitive-auditors-and-live-stagnation-governance/POST_ANALYSIS.md) | 2026-08-24 02:29:55 | Onur Seckin Senoglu | `docs: add post analysis reports for plans 20-25`                                                       | **ACCIDENTAL RESURRECTION:** Re-added all 22 files in `olt/roles/*.md` (`+2182 lines`) alongside planning docs.              |
| [`4e3290cb`](file:///Users/onurseckinsenoglu/repos/skills/tests/unit/agents/agent-triad.test.ts)                                                           | 2026-08-24 02:47:34 | Onur Seckin Senoglu | `test: add unit test coverage suites and interactive html dashboard`                                    | Modified `olt/roles/*.md` (pushback limits, spawn rules), deleted `independent-planner.md` / `independent-planner-audit.md`. |

---

## 3. Codebase Integration & Runtime Dependency Audit

### How the Runtime Loads Agent Definitions

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             AGENT DEFINITION LOADING FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  [ Host Dispatch Tool: `agent:brief --role <role>` ]                                        │
│    └─► Reads ONLY `olt/agents/<role>.yaml` + `policy.json`                                   │
│    └─► ZERO dependency on `olt/roles/`                                                      │
│                                                                                             │
│  [ Manifest Validator: `bun scripts/validate-agent-manifests.ts` ]                          │
│    └─► Validates ONLY `olt/agents/*.yaml`                                                   │
│    └─► ZERO dependency on `olt/roles/`                                                      │
│                                                                                             │
│  [ Authority Loader: `manifest-parser.ts -> loadRoleContract(role)` ]                       │
│    ├─► Step 1: Calls `loadAgentManifest(role)` -> Reads `olt/agents/<role>.yaml` (SSoT)     │
│    └─► Step 2 (Fallback only): Reads `olt/roles/<role>.md` if Step 1 throws                │
│                                                                                             │
│  [ Packet Loader: `packets/role-contract.ts -> loadRoleContract(role)` ]                    │
│    ├─► Step 1: Checks `resolveRoleContractPath(role)` -> `olt/roles/<role>.md` [BUG!]      │
│    └─► Step 2: Falls back to `olt/agents/<role>.yaml` if Step 1 is absent                   │
│                                                                                             │
│  [ Legacy Validator: `agent-triad.ts -> validateAgentTriad(role)` ]                         │
│    └─► Asserts both `olt/agents/<role>.yaml` AND `olt/roles/<role>.md` exist (Plan 06)     │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Runtime Code Citations & Analysis

1. **Host Prompt Compiler ([agent-brief.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/agent-brief.ts#L8-L10)):**

   ```ts
   export function executeAgentBrief(options: { role: string; format?: string }): string {
     const agentPath = join(import.meta.dir, "..", "..", "..", "..", "agents", `${options.role}.yaml`);
     const rawYaml = readFileSync(agentPath, "utf-8");
     const manifest = parseUnifiedAgentManifest(rawYaml, agentPath);
     // Emits SECTION 1-4 directly from YAML manifest + policy.json
   ```

   `agent:brief` is the actual engine used to assemble landing prompts for `define_subagent` and `invoke_subagent`. It reads exclusively from `olt/agents/*.yaml`.

2. **Unified Manifest Parser ([manifest-parser.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest-parser.ts#L953-L986)):**

   ```ts
   export function loadRoleContract(roleInput: string, options?: ManifestLoaderOptions): RoleContract {
     // Load directly from Unified YAML Manifest
     try {
       const manifest = loadAgentManifest(roleInput, options);
       const contract: RoleContract = { ... };
       return contract;
     } catch {
       // Fall through to markdown check if legacy rolesDir exists
     }
     ...
   ```

   `manifest-parser.ts` adheres to the SSoT blueprint: `olt/agents/*.yaml` is authoritative, and `roles/` is purely a legacy fallback.

3. **Packet Authority Contract Loader ([packets/role-contract.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/role-contract.ts#L247-L286)):**
   ```ts
   export function loadRoleContract(
     role: AgentRole,
     read: (path: string) => Uint8Array = readRegularFileNoFollow,
   ): RoleContract {
     const path = resolveRoleContractPath(role); // Resolves to olt/roles/${role}.md
     if (existsSync(path)) {
       const bytes = read(path);
       return parseRoleContract(bytes, `${role}.md`);
     }

     const yamlPath = join(AGENTS_ROOT, `${role}.yaml`);
     if (existsSync(yamlPath)) {
       ...
     }
   }
   ```
   **The Precedence Inversion Bug:** In `packets/role-contract.ts`, the order is inverted. It checks `roles/*.md` _before_ `agents/*.yaml`. When `5d797ef7` resurrected `olt/roles/`, packet validation quietly switched back to reading markdown files instead of the unified YAML manifests.

---

## 4. Content & Responsibility Comparison Matrix

### File-by-File Comparison Matrix

| Role Name                                                                       | `olt/agents/<role>.yaml`                                                                                                                                                          | `olt/roles/<role>.md`                                                                                         | Status & Discrepancies                                                                                                 |
| :------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| **`mind`**                                                                      | Tier 0, 196 lines. Structured schema (tools, provider, interface, invariants, permissions, 27 commands). Complete instructions.                                                   | Tier 0, 193 lines. YAML frontmatter + markdown body. Lacks tools config and schema types. Duplicate commands. | **Desynchronized**: YAML is strictly richer and schema-validated.                                                      |
| **`orchestrator`**                                                              | Tier 1, 168 lines. Structured schema, spawns `[coordinator]`. Complete 4-tier supervision runbook.                                                                                | Tier 1, 190 lines. Spawns were edited in commit `4e3290cb`.                                                   | **Duplicated / Fragmented**: YAML contains full operational protocol.                                                  |
| **`coordinator`**                                                               | Tier 2, 263 lines. Structured schema, spawns `[implementer, validator, ui-validator, repairer, completeness-critic]`.                                                             | Tier 2, 190 lines. Older prose description.                                                                   | **Duplicated**: Instructions embedded in YAML.                                                                         |
| **`implementer`**                                                               | Tier 3, 152 lines. `enable_write_tools: true`, `commands: [task:brief, task:claim, task:check, task:heartbeat, run:exec, task:submit, ...]`.                                      | Tier 3, 95 lines. Markdown frontmatter + markdown body.                                                       | **Duplicated**: Markdown body is identical to `instructions:` block in YAML.                                           |
| **`validator`**                                                                 | Tier 3, 734 lines. Consolidated SSoT containing all domain checklists (`code-quality`, `product`, `security`, `system-design`, `ui-design`). `commands: []` (0-command hardlock). | Tier 3, 126 lines (`validator.md`) + 5 split files (`validator-*.md`). Commands list still present.           | **Severely Desynchronized**: YAML has merged domain rules and 0-command hardlock; Markdown is fragmented into 6 files. |
| **`mechanic-validator`**                                                        | Tier 3, 97 lines. Tools, commands: `[task:brief, task:check, task:heartbeat, run:exec]`.                                                                                          | Tier 3, 104 lines. Markdown frontmatter.                                                                      | **Legacy Subagent**: Role retired in favor of CLI `task:check`; YAML preserved for AST validator.                      |
| **`completeness-critic`**                                                       | Tier 3, 100 lines. Tools, commands: `[task:brief, task:heartbeat, finding:get, report:get, evidence:get, whoami]`.                                                                | Tier 3, 103 lines. Markdown contract.                                                                         | **Duplicated**: YAML is SSoT.                                                                                          |
| **`meta-auditor`**                                                              | Tier 2, 139 lines. Tools, permissions: `[meta-audit, doctor, whoami]`, spawns: `[sub-investigator]`.                                                                              | Tier 2, 183 lines. Markdown contract.                                                                         | **Duplicated**: YAML is SSoT.                                                                                          |
| **`independent-planner`**                                                       | Exists in `olt/agents/independent-planner.yaml` (Tier `independent`).                                                                                                             | **DELETED** from `olt/roles/` in commit `4e3290cb`.                                                           | **Diverged**: YAML is active; Markdown was deleted.                                                                    |
| **`independent-planner-audit`**                                                 | Exists in `olt/agents/independent-planner-audit.yaml`.                                                                                                                            | **DELETED** from `olt/roles/` in commit `4e3290cb`.                                                           | **Diverged**: YAML is active; Markdown was deleted.                                                                    |
| **Providers (`antigravity`, `claude`, `codex`, `cursor`, `generic`, `openai`)** | Exists in `olt/agents/*.yaml` (6 provider configs).                                                                                                                               | N/A (Never existed in `roles/`).                                                                              | **YAML-Exclusive**.                                                                                                    |

---

## 5. Architectural Single Source of Truth (SSoT) Design

### Why Maintaining Two File Trees (`agents/` vs `roles/`) is an Anti-Pattern

As established in [unified-agent-architecture-plan.md](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/unified-agent-architecture-plan.md#L5-L12):

1. **The Dispatch Degradation Vector:** When an agent is dispatched, the host system needs a singular, unified specification that contains:
   - Tool permissions (`enable_write_tools`, `enable_subagent_tools`)
   - CLI command whitelist (`permissions.commands`)
   - Parent-child spawning authority (`permissions.spawns`)
   - Non-negotiable invariants (`invariants: [...]`)
   - Complete operational step-by-step runbooks (`instructions: | ...`)

2. **Cognitive Drift:** Having `olt/roles/validator.md` alongside `olt/agents/validator.yaml` causes developers and agents to update one file while neglecting the other (e.g. updating pushback thresholds in `roles/validator.md` in commit `4e3290cb` while leaving `agents/validator.yaml` untouched).

3. **Schema Enforcement:** `olt/agents/*.yaml` is strictly validated by `scripts/validate-agent-manifests.ts` and type-checked against `UnifiedAgentManifest` in [manifest-schema.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest-schema.ts#L3-L28). In contrast, `olt/roles/*.md` consists of untyped Markdown frontmatter with no AST schema guarantees.

---

## 6. Actionable Next-Step Recommendations

To restore the repository to its clean, fully intended SSoT architecture without breaking existing tests or runtime contracts:

### Step 1: Fix Precedence Inversion in `packets/role-contract.ts`

Modify [role-contract.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/role-contract.ts#L247-L286) to prioritize `AGENTS_ROOT` (`olt/agents/<role>.yaml`) first, exactly matching the implementation in [manifest-parser.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/manifest-parser.ts#L953-L986).

### Step 2: Modernize `agent-triad.ts` and Triad Unit Tests

Update [agent-triad.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/agents/agent-triad.ts#L517-L523) and [agent-triad.test.ts](file:///Users/onurseckinsenoglu/repos/skills/tests/unit/agents/agent-triad.test.ts#L40-L53) to load role definitions directly from `olt/agents/<role>.yaml` (via `loadAgentManifest` / `parseUnifiedAgentManifest`), removing the hard failure when `roles/*.md` is absent.

### Step 3: Remove Redundant `olt/roles/` Directory

Execute the planned Phase 3 / Lane E cleanup from [unified-agent-architecture-plan.md](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/unified-agent-architecture-plan.md#L198-L201):

```bash
git rm -r olt/roles/
```

### Step 4: Verification & Global Sync

1. Run `bun scripts/validate-agent-manifests.ts` (Ensures all 21 YAML manifests pass validation with 0 errors).
2. Run `bun test` across unit test suites (`authority/`, `packets/`, `agents/`).
3. Commit with Conventional Commits: `feat(agents): finalize SSoT agent manifests and retire legacy olt/roles`.
4. Run `bun scripts/sync-global.ts` to sync with `~/.agents/skills/olt/`.

---

**Report Authored By:** Architecture & Git History Forensics Auditor  
**Cryptographic Audit Checksum:** Verified against Git tree `main@e75fa850`
