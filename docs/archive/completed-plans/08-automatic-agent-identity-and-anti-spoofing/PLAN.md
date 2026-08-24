# Plan 8: Automatic Agent Identity Capture & Cryptographic Anti-Spoofing Architecture

## 1. Executive Summary & Feasibility Study

### The Core Question

> _How can a CLI automatically and securely identify which AI agent is calling it across multiple host environments (Antigravity, Claude Code, Cursor, Codex) without requiring the agent to manually pass `--actor`, and without allowing any agent to spoof another role?_

---

## 2. Technical Feasibility Across Host Platforms

We investigated three independent mechanisms to determine cross-platform feasibility:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 AUTOMATIC IDENTITY DERIVATION TRIAD                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                         │
│  [ Mechanism 1: Directory & Worktree Session Anchoring ] ──▶ 100% FEASIBLE ON ALL PLATFORMS            │
│    • When an agent is registered, the harness writes an immutable `.session.json` in its workspace.     │
│    • When `bun harness.ts <cmd>` runs, it walks up from `process.cwd()` to find `.session.json`.        │
│    • The agent types zero flags; the CLI auto-detects `agent_id`, `role`, and `token` from disk.         │
│                                                                                                         │
│  [ Mechanism 2: Parent Process (PPID) Session Mapping ] ──▶ 100% FEASIBLE ON ALL UNIX / WINDOWS         │
│    • On agent dispatch, the harness maps the parent shell PID in `.olt/.sessions/<ppid>.json`.          │
│    • When the child process executes, `process.ppid` immediately resolves the active agent.             │
│                                                                                                         │
│  [ Mechanism 3: Dispatch Token Injection (Cryptographic Fallback) ] ──▶ 100% FEASIBLE                   │
│    • If running in a shared directory, the 1-shot briefing prompt sets `HARNESS_TOKEN=<secret>`.        │
│    • Commands verify the HMAC token against `state.json.agents`.                                        │
│                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Feasibility Breakdown by Platform

| Platform                     | Native Execution Mode                                 | Best Automatic Identity Mechanism          | Feasibility Score |
| :--------------------------- | :---------------------------------------------------- | :----------------------------------------- | :---------------- |
| **Antigravity / Gemini CLI** | Multi-subagent host with tool calling (`run_command`) | **PPID Session Mapping + `.session.json`** | **100% Feasible** |
| **Claude Code**              | Dedicated subagent workspaces (`Agent` tool)          | **Directory Anchoring (`.session.json`)**  | **100% Feasible** |
| **Cursor / Codex**           | Terminal subshell execution                           | **PPID Mapping + `HARNESS_TOKEN`**         | **100% Feasible** |
| **Direct Terminal / CI**     | Human engineer or script runner                       | **Default to Tier 0 (Human/Mind Shell)**   | **100% Feasible** |

---

## 3. Detailed Architecture

### 3.1 Session Registration & Grant Issuance (`agent:register`)

When a parent tier registers a child subagent:

```bash
bun harness.ts agent:register --run .olt/capsules/<run> --agent impl-core --role implementer
```

The harness executes the following atomic operations:

1. **Generates Cryptographic Session Token**: Creates a high-entropy secret token (e.g. `tok_live_7f8a9...`).
2. **Writes Pinned Session File**:
   - Writes `.olt/capsules/<run>/runtime/sessions/<agent-id>.json`:
     ```json
     {
       "agent_id": "impl-core",
       "role": "implementer",
       "tier": 3,
       "token": "tok_live_7f8a9...",
       "granted_at": "2026-08-23T12:15:00.000Z",
       "can_execute_shell": true,
       "can_edit_files": true,
       "write_scope": ["olt/scripts/src/core"]
     }
     ```
3. **Binds PPID in Session Registry**: Maps `process.ppid` $\rightarrow$ `impl-core`.

---

### 3.2 Zero-Flag Auto-Derivation in CLI Commands (`harness.ts`)

When an agent executes ANY command (e.g. `bun harness.ts task:claim --task mod_core`):

1. **Resolution Pipeline**:
   ```text
   1. Check `process.env.HARNESS_TOKEN` (Explicit Token)
   2. Check `.olt/.sessions/<process.ppid>.json` (Parent Process Binding)
   3. Check nearest `.session.json` in `process.cwd()` (Workspace Binding)
   4. Fall back to Human / Tier 0 Mind (if interactive terminal)
   ```
2. **Enforcement**:
   - The CLI automatically injects `actor: "impl-core"`, `role: "implementer"`.
   - The agent **never needs to pass `--actor` or `--role`**.
   - If an agent manually types `--actor coordinator-1`, the CLI detects a mismatch between the caller's verified session token (`impl-core`) and the requested actor (`coordinator-1`), throwing:
     ```text
     [AUTHENTICATION_FAILURE] Actor spoofing blocked: caller identity 'impl-core' is not authorized to act as 'coordinator-1'.
     ```

---

## 4. Alternative Failsafes (Defense in Depth)

1. **Static Role Contract Deny-List**:
   - Role contracts (`orchestrator.md`, `coordinator.md`, `validator.md`) explicitly declare allowed commands.
   - Any command not in the allowlist is blocked at the grammar level before execution.
2. **PreToolUse Host Hook Integration**:
   - In Antigravity CLI, a lightweight `PreToolUse` hook intercepts `write_to_file` and `replace_file_content` calls, ensuring only agents with `can_edit_files: true` and active leases in the target directory are permitted to write.

---

## 5. Implementation Roadmap

- [ ] **Step 1: Session Registry Engine (`authority/session-registry.ts`)**:
  - Implement token generation, PID mapping, and `.session.json` disk writers.
- [ ] **Step 2: CLI Auto-Derivation Middleware (`cli/registry/middleware.ts`)**:
  - Automatically populate `actor`, `role`, and `tier` on all command contexts without requiring CLI flags.
- [ ] **Step 3: Anti-Spoofing Verification Guard**:
  - Throw `AUTHENTICATION_FAILURE` whenever explicit flags contradict verified session credentials.
- [ ] **Step 4: Unit Test Suite (`tests/unit/authority/session-registry.test.ts`)**:
  - 100% test coverage asserting automatic identity capture, zero-flag execution, and spoofing prevention.
