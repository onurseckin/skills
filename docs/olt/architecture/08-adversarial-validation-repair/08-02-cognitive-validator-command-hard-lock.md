# 08-02 Cognitive Validator Command Hard-Lock & UI Validator Split

---

[Previous: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 08-03 Meta-Auditor Seven Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md)

---

## 1. Executive Summary & The Validator Compromise Vulnerability

In autonomous agent architectures, granting command execution capabilities to code validator agents introduces severe security, reliability, and epistemic vulnerabilities:

1. **Test Harness Mutation**: A validator with shell access may rewrite test suites, inject permissive mocks, or loosen assertion thresholds to force failing tests to pass.
2. **Terminal Exit Code Spoofing**: An hallucinating or compromised validator can execute shell commands that forge exit status 0 (e.g., `true`) without performing real semantic code verification.
3. **Epistemic Collapse**: When validators execute tests directly, their reasoning collapses into shallow CLI feedback loops rather than rigorous AST logic and invariant analysis.
4. **Prompt Injection & Byzantine Execution**: Diff comments or test fixtures containing prompt injection payloads could coerce a shell-enabled validator into running arbitrary host commands.

The **OLT (Orchestrating Long Tasks)** engine implements the **Cognitive Validator Command Hard-Lock Interlock**:

- **Mechanical Command Lock (0 Commands)**: Cognitive validators are mechanically stripped of all command execution tools: $\text{Commands}(\text{Validator}) \equiv \emptyset$.
- **Pure AST & Semantic Auditing**: Validators operate strictly via read-only tools (`view_file`, `grep_search`, `find_by_name`) and AST inspection logic.
- **Detached Evidence Resolution**: Mandatory gate proofs are resolved via detached evidence (`task:review --evidence <cmd-id>`) produced by deterministic execution (`task:check`) or implementer receipts.

```text
+--------------------------------------------------------------------------------------------------+
│                               COGNITIVE VALIDATOR HARD-LOCK TOPOLOGY                             │
+--------------------------------------------------------------------------------------------------+
│   ┌──────────────────────────────────────────────────────────────────────────────────────┐       │
│   │                        TIER 3 COGNITIVE VALIDATOR (Pure Audit)                       │       │
│   │  - Permitted Tools: view_file, grep_search, find_by_name, send_message               │       │
│   │  - PROHIBITED TOOLS: run_command, execute_script, bash (0 Commands Granted)          │       │
│   └──────────────────────────────────────────┬───────────────────────────────────────────┘       │
│                                              │ Tool Invocation Request: action a                 │
│                                              ▼                                                   │
│   ┌──────────────────────────────────────────────────────────────────────────────────────┐       │
│   │                       HARNESS RBAC INTERCEPTOR & PERMISSION GATE                     │       │
│   │    Is a in {run_command, execute_script, bash}?                                      │       │
│   │       ├── YES ──► [ TRAP: COMMAND_HARD_LOCKED ] ──► Revoke Lease & Abort             │       │
│   │       └── NO  ──► [ PASS TO READ DISPATCHER ] ──► Execute view_file / AST inspect    │       │
│   └──────────────────────────────────────────────────────────────────────────────────────┘       │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. UI Validation Decoupling: Headless vs Optical Split

For user interface surfaces, automated tests are strictly only half of verification. OLT splits UI validation into two sequential, specialized Tier 3 validator roles:

```text
+---------------------------+------------------------------------------+---------------------------+
│ Architectural Dimension   │ Tier 3 UI Headless Validator             │ Tier 3 UI Optical Validator│
+---------------------------+------------------------------------------+---------------------------+
│ Primary Mission           │ Playwright test execution, headless DOM  │ 4-viewport visual review  │
│                           │ assertions, screenshot capture.          │ across 8 Optical Dims.    │
+---------------------------+------------------------------------------+---------------------------+
│ Shell Command Authority   │ ALLOWED (Playwright CLI runner)          │ STRICTLY 0 (Hard-Locked)  │
+---------------------------+------------------------------------------+---------------------------+
│ File System Mutation      │ STRICTLY 0 (Read-Only)                   │ STRICTLY 0 (Read-Only)    │
+---------------------------+------------------------------------------+---------------------------+
│ Input Artifacts           │ Worktree test suites & components        │ Captured image files      │
+---------------------------+------------------------------------------+---------------------------+
│ Output Evidence           │ Test execution receipts & screenshots    │ Socratic optical critique │
+---------------------------+------------------------------------------+---------------------------+
```

### The 8 Optical Dimensions

`ui-optical-validator` inspects captured screenshot images ($\ge 1024\text{ B}$) across all 4 mandatory viewports (Desktop-Wide 1920x1080, Desktop 1440x900, Tablet 768x1024, Mobile 390x844):

1. **Spatial Density**: Grid rhythm, padding consistency, margin flow.
2. **Chromatic Coherence**: Theme harmony across light/dark modes, brand palettes.
3. **Typographic Scale**: Hierarchical font sizes, line heights, text contrast (APCA $L_c \ge 60$).
4. **Responsive Fidelity**: Fluid reflow without horizontal scrollbars or orphaned text.
5. **Perceptual Hierarchy**: Primary action salience, visual weight distribution.
6. **Viewport Boundary Clipping**: Zero clipped text, overflow hidden bugs, or collapsed panels.
7. **Interaction Affordance**: Hover/focus state clarity, tap targets ($\ge 44\times 44\text{ px}$).
8. **Component Token Alignment**: Strict adherence to design tokens and border radius standards.

Approving UI tasks without viewing screenshots is mechanically rejected as `SUPERFICIAL_UI_APPROVAL`.

---

## 3. Fail-Closed Permission Enforcement & RBAC Hard-Locks

Let $\mathcal{A}_{\text{exec}} = \{\texttt{"run\_command"}, \texttt{"execute\_script"}, \texttt{"bash"}, \texttt{"terminal\_exec"}\}$.
When role $R$ requests execution of tool $t$:

$$ \text{AuthorizeTool}(R, t) = \begin{cases}
\text{ALLOW} & \text{if } t \in \text{PermittedTools}(R) \land (R \neq \text{Validator} \lor t \notin \mathcal{A}_{\text{exec}}) \\
\text{TRAP}(\texttt{"COMMAND\_HARD\_LOCKED"}) & \text{if } R \in \text{CognitiveValidators} \land t \in \mathcal{A}_{\text{exec}} \\
\text{DENY}(\texttt{"PERMISSION\_DENIED"}) & \text{otherwise}
\end{cases}$$

Upon a `COMMAND_HARD_LOCKED` trap:
1. Tool dispatch aborts before any child process is spawned.
2. The validator agent's lease is immediately revoked.
3. A fatal security violation event is written to `.olt/capsules/<slug>/evidence/security-audit.json`.

---

## 4. Pure AST & Diff Cognitive Auditing Mechanics

Cognitive validators verify code diffs without running execution commands:

1. **AST Purity Traversal**: Parses modified files via TypeScript compiler API to trap explicit or implicit `any`, unsafe type casts, and `@ts-ignore`.
2. **Control Flow Graph (CFG) Verification**: Validates that all branching paths return valid values, throw structured exceptions, or cleanly terminate.
3. **Boundary Condition Probing**: Statically verifies constants across public API boundaries.
4. **Invariant Tracing**: Confirms atomic file write swaps, flock mutexes, and zero unbounded memory growth.

---

## 5. Mathematical Confinement & Prompt Injection Immunity

Let $\mathcal{S}$ denote repository state and $\mathcal{E}$ denote the external host environment.
For all actions $a$ issued by a Cognitive Validator $V_{\text{cog}}$:

$$\forall a \in \text{Actions}(V_{\text{cog}}), \quad \Delta \mathcal{S}(a) = \emptyset \quad \land \quad \Delta \mathcal{E}(a) = \emptyset$$

Let $\mathcal{P}_{\text{inj}}$ represent an adversarial prompt injection payload embedded within an audited code diff. Because execution tools are mechanically disconnected at the harness dispatcher:

$$\text{CommandsExecuted}(\text{Evaluate}(V_{\text{cog}}, \Delta_i \cup \mathcal{P}_{\text{inj}})) \equiv \emptyset$$

This mathematically guarantees that audited diffs cannot breach the host OS via validator subagents.

---

## 6. TypeScript Capability Contracts

Defined in [`role-contract.ts`](../../../../olt/scripts/src/packets/role-contract.ts):

```typescript
export interface RoleCapabilityContract {
  readonly roleName: string;
  readonly permittedTools: readonly string[];
  readonly prohibitedTools: readonly string[];
  readonly commandExecutionGranted: boolean;
  readonly fileSystemWriteGranted: boolean;
}

export const COGNITIVE_VALIDATOR_CONTRACT: RoleCapabilityContract = {
  roleName: "validator",
  permittedTools: ["view_file", "grep_search", "find_by_name", "send_message"],
  prohibitedTools: ["run_command", "write_to_file", "replace_file_content", "notebook_edit"],
  commandExecutionGranted: false,
  fileSystemWriteGranted: false,
};

export const UI_OPTICAL_VALIDATOR_CONTRACT: RoleCapabilityContract = {
  roleName: "ui-optical-validator",
  permittedTools: ["view_file", "grep_search", "find_by_name", "send_message"],
  prohibitedTools: ["run_command", "write_to_file", "replace_file_content", "notebook_edit"],
  commandExecutionGranted: false,
  fileSystemWriteGranted: false,
};

export class CommandHardLockInterceptor {
  constructor(private readonly contract: RoleCapabilityContract) {}

  public validateToolDispatch(toolName: string): void {
    const isExec = ["run_command", "execute_script", "bash"].includes(toolName);
    if (!this.contract.commandExecutionGranted && isExec) {
      throw new Error(`COMMAND_HARD_LOCKED: Role '${this.contract.roleName}' has 0 command authority.`);
    }
    if (!this.contract.permittedTools.includes(toolName)) {
      throw new Error(`PERMISSION_DENIED: Tool '${toolName}' not permitted for '${this.contract.roleName}'.`);
    }
  }
}
```

---

## 7. Failure Modes & Security Guarantees

| Failure Vector | Vulnerability Without Lock | OLT Hard-Lock Defense Mechanism |
| :--- | :--- | :--- |
| Test Suite Rewriting | Validator edits tests to force pass. | Write tools prohibited; validator is strictly read-only. |
| Fake Exit Code 0 | Validator executes dummy `exit 0`. | Commands hard-locked (0 cmd); detached receipts required. |
| Host OS Exploitation | Prompt injection triggers malicious shell. | Shell execution mechanically impossible. |
| Flaky Test Masking | Validator re-runs tests until green. | Deterministic receipts record single-pass results. |
| Superficial UI Pass | Validator passes UI without visual check. | Headless Playwright + Optical screenshot review mandatory. |

---

## 8. Architectural Invariants Summary

1. **Zero Command Grant**: $\text{Commands}(\text{Validator}_{\text{cog}}) \equiv \emptyset$. Cognitive validators execute strictly 0 terminal commands.
2. **Read-Only Confinement**: Cognitive validators have zero permission to modify workspace files.
3. **UI Dual Sequential Gate**: UI verification strictly requires `ui-headless-validator` execution followed by `ui-optical-validator` visual review across 4 viewports.
4. **Detached Evidence Resolution**: Gate proofs resolve via detached receipts (`task:review --evidence`) or implementer records.

---

[Previous: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 08-03 Meta-Auditor Seven Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md)

---
$$
