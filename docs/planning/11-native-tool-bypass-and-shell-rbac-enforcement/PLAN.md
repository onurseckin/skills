# Plan 11: Native Host Tool Bypass & Universal Shell RBAC Enforcement

## 1. Problem Statement & Context

The OLT system establishes strict Role-Based Access Control (RBAC) rules:

- **Tier 0 Mind & Tier 1 Orchestrators**: Forbidden from running unit test suites directly (Zero Unit Test Execution).
- **Tier 3 Cognitive Validators**: Locked at 0 shell commands (Hard-Lock Interlock).
- **Tier 3 Implementers**: Restricted to file-scoped tests and forbidden from running whole-repo test suites (`bun test`, `npm test`) or un-gated git mutations.

### Observed Systemic Failure Mode:

While the OLT harness CLI implements cryptographic command signing (`harness.ts shell` and `harness.ts run:exec`), AI agents frequently **bypass the harness entirely** by calling the native host tool `run_command` with raw shell strings (e.g., `run_command("bun test ...")`). Because `run_command` dispatches directly to the OS shell (`/bin/zsh`), the harness RBAC checks are never invoked, allowing supervisors and validators to run forbidden commands with impunity.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Tool Invocation Dual-Track Divergence**:
   - The LLM has direct access to the native tool `run_command`.
   - When the LLM decides to test a hypothesis, it chooses the path of least resistance: writing a raw bash command into `run_command` rather than wrapping it in `bun harness.ts shell -- ...`.
2. **Post-Hoc vs. Pre-Execution Gating**:
   - Currently, harness RBAC is evaluated _inside_ the harness CLI entrypoint.
   - If the agent never calls `harness.ts`, the harness has zero opportunity to block or intercept the execution before it reaches the OS kernel.
3. **Absence of Native Shell Interception / Pre-Tool Hooks**:
   - The environment lacks a system-level pre-tool execution hook that intercepts raw `run_command` payloads and validates caller identity and role permissions before shell dispatch.

---

## 3. Scope of the Problem & Affected Subsystems

- **Native Tools**: `run_command`, terminal execution hooks.
- **Harness Policy Engine**: `olt/scripts/src/policy/rbac-engine.ts`, `olt/scripts/src/authority/`.
- **Shell Wrapper**: `olt/scripts/src/cli/commands/shell.ts`.
- **System Lifecycle Hooks**: Antigravity CLI / host hook configurations.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Universal Command Interception**:
   - No agent can execute an out-of-role shell command, whole-repo test suite, or unauthorized git mutation, regardless of whether it invokes `run_command` directly or uses `harness.ts`.
2. **Cognitive Validator Absolute 0-Command Lock**:
   - Any attempt by a Cognitive Validator to execute a terminal command must be intercepted and mechanically blocked before execution.
3. **Supervisor Zero-Test Enforcement**:
   - Supervisors attempting to run test runners directly must receive an immediate structural block directing them to dispatch a Tier 3 Implementer.
