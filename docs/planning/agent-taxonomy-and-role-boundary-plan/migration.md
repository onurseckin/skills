# Zero-Backwards-Compatibility Migration & Alignment Plan

This document details the step-by-step migration roadmap to transition the repository from the current 33-manifest drift state to the clean, streamlined 20-manifest target architecture. In accordance with [AGENTS.md §36](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L136-L139), **zero backwards-compatibility shims, forwarding stubs, or legacy aliases will be retained**.

---

## 1. Migration Phase Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       6-PHASE MIGRATION TIMELINE                            │
├─────────┬───────────────────────────────────┬───────────────────────────────┤
│ Phase   │ Primary Milestone                 │ Manifest Operations           │
├─────────┼───────────────────────────────────┼───────────────────────────────┤
│ Phase 1 │ Dead & Duplicate Manifest Purge   │ Delete 8 obsolete YAML files  │
│ Phase 2 │ Host Wrapper Compliance (§31)     │ Delete 2 non-canonical hosts  │
│ Phase 3 │ Supervisory Permission Revocation │ Harden Mind, Orch, Coord YAML │
│ Phase 4 │ Dedicated Tier 3 Publisher Deploy │ Create publisher.yaml & RBAC  │
│ Phase 5 │ Policy Discovery CLI Conversion   │ Retire policy-discovery.yaml  │
│ Phase 6 │ Ecosystem Test & SSoT Alignment   │ Update tests & archetypes     │
└─────────┴───────────────────────────────────┴───────────────────────────────┘
```

---

## 2. Granular Execution Phases

### Phase 1: Dead & Duplicate Manifest Purge

Permanently delete 8 files from `olt/agents/` that violate §26 and §36:

1. **Delete `worker.yaml`**: Duplicate of [implementer.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml).
2. **Delete `critic.yaml`**: Duplicate of [completeness-critic.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/completeness-critic.yaml).
3. **Delete `repairer.yaml`**: Retired by [§26](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L98-L101). In-lease micro-cycles (`task:reject --in-lease`) replace separate repair subagents.
4. **Delete `mechanic-validator.yaml`**: Retired by [§26](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L98-L101). Deterministic tool `task:check` replaces LLM subagent.
5. **Delete `ui-validator.yaml`**: Duplicate of [ui-optical-validator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/ui-optical-validator.yaml).
6. **Delete `ui-visual-reviewer.yaml`**: Redundant copy of `ui-optical-validator.yaml`.
7. **Delete `ui-mechanic-validator.yaml`**: Redundant copy of `ui-headless-validator.yaml`.
8. **Delete `ui-debugger.yaml`**: Obsolete narrow diagnostic role.

**Commands**:

```bash
git rm olt/agents/worker.yaml olt/agents/critic.yaml olt/agents/repairer.yaml \
       olt/agents/mechanic-validator.yaml olt/agents/ui-validator.yaml \
       olt/agents/ui-visual-reviewer.yaml olt/agents/ui-mechanic-validator.yaml \
       olt/agents/ui-debugger.yaml
```

---

### Phase 2: Host Platform Cleanup (§31 Invariant)

Eliminate non-canonical host platform files that violate [§31](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L116-L123):

1. **Delete `generic.yaml`**: Violates the Zero Generic Fallback Invariant. The repository recognizes strictly 4 canonical hosts (`antigravity`, `claude_code`, `codex`, `cursor`).
2. **Delete `openai.yaml`**: Redundant duplicate of [codex.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/codex.yaml).

**Commands**:

```bash
git rm olt/agents/generic.yaml olt/agents/openai.yaml
```

---

### Phase 3: Supervisory Role Hardening & Permission Revocation

Eliminate permission leakage in Tier 0, 1, and 2 supervisor manifests:

1. **[mind.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mind.yaml)**:
   - Change `tools.enable_write_tools` from `true` to `false`.
2. **[orchestrator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml)**:
   - Change `tools.enable_write_tools` from `true` to `false`.
   - Remove `worktree:land` from `commands` list.
3. **[coordinator.yaml](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml)**:
   - Change `tools.enable_write_tools` from `true` to `false`.
   - Remove `worktree:land`, `worktree:clean`, `worktree:reclaim` from `commands` list.
   - Add `publisher` to `spawns` list.
4. **[olt/policy.json](file:///Users/onurseckinsenoglu/repos/skills/olt/policy.json)**:
   - Revoke `git commit` and `git push` from `coordinator.rbac.allowed_commands`.
   - Ensure `can_edit_code: false` is strictly verified for all supervisors.

---

### Phase 4: Dedicated Tier 3 Publisher Implementation

Introduce the dedicated release subagent to own wave landing and remote push:

1. **Author `olt/agents/publisher.yaml`**:
   - Tier 3 role, leased by Coordinator upon wave convergence.
   - Holds `can_execute_shell: true` and `enable_write_tools: true`.
   - Authorized commands: `worktree:land`, `worktree:clean`, `worktree:status`, `task:check`, `doctor`, `whoami`, `msg:send`, `msg:recv`.
   - Prohibited from touching application source files outside the release transaction.
2. **Register in `olt/policy.json`**:
   - Add `publisher` agent entry with full 4-host model mappings (`gemini-3.7-flash`, `claude-5-sonnet`, `gpt-5.6-terra`, `cursor-latest` at Medium Thinking).
3. **Update Fleet Archetypes & Matrix**:
   - Add `publisher` to `TIER_3_EXECUTION_AGENTS` in [fleet/archetypes.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/agents/fleet/archetypes.ts).
   - Add contract definition in `fleet/contracts-tier3-exec.ts`.

---

### Phase 5: Policy Discovery Agent Retirement

Transition cold-start policy scaffolding to 100% deterministic CLI execution:

1. **Delete `policy-discovery.yaml`**:
   ```bash
   git rm olt/agents/policy-discovery.yaml
   ```
2. **Update Directives & Scripts**:
   - Anchor all cold-start bootstrapping to `bun harness.ts policy:init`.
   - Update [AGENTS.md §2](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L215) and [AGENTS.md §7](file:///Users/onurseckinsenoglu/repos/skills/AGENTS.md#L813) to reference the deterministic `policy:init` command instead of an LLM subagent persona.

---

### Phase 6: Ecosystem Test & SSoT Alignment

Ensure complete monorepo test passing and zero reference to deleted files:

1. **Purge Ghost Roles from Fleet Registry**:
   - Remove obsolete archetypes (`autonomous-repairer`, `general-task-worker`, `ui-cognitive-validator`, `ui-visual-reviewer`, `ui-headless-debugger`, `mechanic-validator`) from [fleet/archetypes.ts](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/agents/fleet/archetypes.ts).
   - Prune corresponding contract objects from `contracts-tier*.ts`.
2. **Execute Test Suites**:
   ```bash
   bun test tests/roles/
   bun test tests/policy/
   bun test tests/workflow/
   bun test tests/cli/
   ```
3. **Validate Monorepo Cleanliness**:
   ```bash
   bun run typecheck
   bun run modularity:staged
   git status
   ```

---

## 3. Risk Mitigation & Verification Matrix

| Migration Step             | Risk Identified                             | Mechanical Mitigation                                                      | Verification Command         |
| :------------------------- | :------------------------------------------ | :------------------------------------------------------------------------- | :--------------------------- |
| **Manifest Deletions**     | Test assertions expecting 33 files fail     | Update test fixtures in `tests/roles/` to assert exact 20 canonical files  | `bun test tests/roles/`      |
| **Write Tool Revocation**  | Supervisor attempts file edit and crashes   | Hard-lock failure is expected; supervisor delegates edit to Implementer    | `bun test tests/policy/`     |
| **Publisher Deployment**   | Unauthenticated release call rejected       | Publisher must hold valid run grant leased by parent Coordinator           | `bun test tests/workflow/`   |
| **Policy Discovery Purge** | Bootstrapping script fails looking for YAML | `mind:init` calls `PolicyDiscoveryEngine` in-process; zero YAML dependency | `bun harness.ts policy:init` |
