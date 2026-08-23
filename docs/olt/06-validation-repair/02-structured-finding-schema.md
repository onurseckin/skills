# 02. Structured Finding Schema & Resolution

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                       |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand the design rationale of structured findings, why unstructured prose feedback fails, and the mechanics of cryptographic resolution. |
| **How-To Guide** | Creating defects, emitting probes, filing AST static findings, querying findings, and mechanically resolving them with gate receipts.         |
| **Reference**    | Complete JSON schemas for `Finding`, `ProbeDemand`, `ChecklistReport`, and severity classification rules.                                     |
| **Tutorial**     | Step-by-step example of resolving a multi-finding defect report through targeted revalidation.                                                |

---

## 🛑 1. Explanation: Why Vague Feedback Fails

In typical AI agent systems, code review feedback consists of conversational prose such as:

> _"The error handling in auth looks a bit weak and there might be an edge case with empty payloads. Please clean this up."_

This feedback produces immediate failure cascades:

- **No Precise Target**: The repairer does not know which function, line, or input triggers the issue.
- **No Actionable Remediation**: The expected behavioral change is ambiguous.
- **No Falsifiable Proof**: There is no defined command to verify when the repair is actually complete.
- **Rubber-Stamping Risk**: A repairer can make trivial changes, claim "fixed", and pass without proof.

To eliminate this ambiguity, every finding in the `olt` capsule conforms to a **Strict Structural Finding Schema** enforcing six mandatory components:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 6-POINT FINDING CONTRACT                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Stable Identifier (`id`)       ──► finding-<task>-<seq> or probe-<task> │
│  2. Bound Obligation (`req_id`)    ──► Explicit requirement link            │
│  3. Discrete Severity (`severity`) ──► critical | important | minor         │
│  4. Empirical Observation          ──► Exact failure reproduction / demand  │
│  5. Concrete Remediation           ──► Specific code correction required    │
│  6. Falsifiable Revalidation       ──► Exact command verifying the fix      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 2. Reference: The Core Finding Schema

All findings are stored in `state.tasks.<id>.findings[]` and cataloged in `index.json`.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FINDING OBJECT STRUCTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  {                                                                          │
│    "id": "finding-task-slug-01",                                            │
│    "class": "defect" | "probe_demand",                                      │
│    "requirement_id": "req-slug-core",                                       │
│    "severity": "critical" | "important" | "minor",                          │
│    "observation": "String describing exact defect or demand to prove",      │
│    "remediation": "String describing concrete fix or proof path",           │
│    "revalidation": "Command string to execute for verification",            │
│    "status": "open" | "resolved",                                           │
│    "evidence": [                                                            │
│      {                                                                      │
│        "kind": "command" | "demand" | "ast_node" | "reference",             │
│        "reference": "C-1c12763c-29c4-493b-a0ef-e5a6b6e255a3",              │
│        "detail": "src/slug.ts:14-22"                                        │
│      }                                                                      │
│    ],                                                                       │
│    "resolution": {                                                          │
│      "command_id": "C-948205",                                              │
│      "resolved_by": "val-sec-1",                                            │
│      "resolved_at": "2026-08-23T03:15:00.000Z"                              │
│    }                                                                        │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Field Specifications

| Field                | Type     | Invariant / Validation Rule                                                                      |
| :------------------- | :------- | :----------------------------------------------------------------------------------------------- |
| **`id`**             | `string` | Unique, stable identifier matching `(finding\|probe)-<task>-.*`.                                 |
| **`class`**          | `enum`   | Exactly `"defect"` (for `task:reject`) or `"probe_demand"` (for `task:probe`).                   |
| **`requirement_id`** | `string` | Must resolve to a valid requirement registered in `state.requirements`.                          |
| **`severity`**       | `enum`   | `"critical"` (blocks execution), `"important"` (correctness risk), or `"minor"` (hygiene/probe). |
| **`observation`**    | `string` | Non-empty string. Cannot be identical to remediation.                                            |
| **`remediation`**    | `string` | Non-empty actionable fix description. Required on all defects.                                   |
| **`revalidation`**   | `string` | Executable gate command or verification instruction.                                             |
| **`status`**         | `enum`   | `"open"` when emitted; transitions to `"resolved"` only via `--resolve`.                         |
| **`evidence`**       | `array`  | List of supporting command execution receipts or AST references.                                 |

---

## ⚡ 3. Reference: Fast Incremental Static Findings (`task:check`)

When static audits (`task:check`) detect AST rule violations, they generate structured static findings under the `code-quality` domain:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STATIC AST CHECK FINDING DEFINITIONS                     │
├───────────────────┬──────────────┬──────────────────────────────────────────┤
│ Rule ID           │ Severity     │ Description                              │
├───────────────────┼──────────────┼──────────────────────────────────────────┤
│ `CQ-TYPE-001`     │ `critical`   │ Disallowed `any` type in TypeScript AST. │
│ `CQ-SUPPRESS-002` │ `critical`   │ Disallowed suppression comments          │
│                   │              │ (`@ts-ignore`, `eslint-disable`).        │
│ `CQ-EXPORT-003`   │ `important`  │ Exported symbol missing explicit return  │
│                   │              │ or parameter types.                      │
│ `CQ-UNUSED-004`   │ `minor`      │ Unused variable or import declaration.   │
└───────────────────┴──────────────┴──────────────────────────────────────────┘
```

### Static Finding JSON Example

```json
{
  "id": "finding-task-auth-ast-01",
  "class": "defect",
  "requirement_id": "req-auth-types",
  "severity": "critical",
  "observation": "Explicit 'any' type annotation used for parameter 'payload' in src/auth/token.ts:18.",
  "remediation": "Replace 'any' with strongly typed interface 'TokenPayload' or 'unknown' with type narrowing.",
  "revalidation": "bun harness.ts task:check --task task-auth",
  "evidence": [
    {
      "kind": "ast_node",
      "detail": "src/auth/token.ts:18:24 -> ParameterDeclaration: payload: any"
    }
  ],
  "status": "open"
}
```

---

## 🔐 4. Explanation: The Mechanical Resolution Contract

A finding **cannot** be marked resolved through conversational assertion, prose explanations, or subsequent code commits.

> **A finding is resolved ONLY when a fresh, independent validator executes a successful gate run and explicitly binds the command receipt to the finding ID via `--resolve`.**

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FINDING RESOLUTION STATE TRANSITION                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Open Finding in state.json ]                                             │
│    • id: "finding-task-slug-01"                                             │
│    • status: "open"                                                         │
│                                                                             │
│                                  │                                          │
│                                  ▼ (Validator runs gate: run:exec)          │
│  [ Command Receipt Generated ]                                              │
│    • command_id: "C-168a1579"                                               │
│    • exit_code: 0 (Success)                                                 │
│    • actor: "val-code-2" (Active Validator)                                 │
│    • task: "task-slug"                                                      │
│                                                                             │
│                                  │                                          │
│                                  ▼ (task:review --resolve finding=cmd)      │
│  [ Finding Marked Resolved ]                                                │
│    • status: "resolved"                                                     │
│    • resolution.command_id: "C-168a1579"                                    │
│    • resolution.resolved_by: "val-code-2"                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Resolution Rules:

1. **Receipt Actor Match**: The command ID passed to `--resolve` must have been executed by the _active validator_ holding the current lease.
2. **Task Scope Match**: The command must be bound to the task under review.
3. **Exit Code Zero**: The command receipt must record an exit code of `0`.
4. **All Open Findings Addressed**: `task:review --status pass` will fail with `INVALID_STATE` if any open finding on the task is omitted from `--resolve`.

---

## 📐 5. Reference: Standing Checklist Coverage Reports (B12.5)

In addition to task-specific requirements, validators evaluate standard engineering checklists (`checklists/<domain>.md`). Checklist coverage is submitted via `--checklist-report <file.json>`.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STANDING CHECKLIST DOMAINS & PREFIXES                    │
├───────────────────────┬────────────┬────────────────────────────────────────┤
│ Domain                │ Prefix     │ Checklist File                         │
├───────────────────────┼────────────┼────────────────────────────────────────┤
│ Code Quality          │ `CQ-`      │ `checklists/code-quality.md`           │
│ Product Completeness  │ `PROD-`    │ `checklists/product.md`                │
│ Security & Isolation  │ `SEC-`     │ `checklists/security.md`               │
│ System Design         │ `SYS-`     │ `checklists/system-design.md`          │
│ UI & Visual Quality   │ `UI-`      │ `checklists/ui-design.md`              │
└───────────────────────┴────────────┴────────────────────────────────────────┘
```

### Checklist Report JSON Schema

Every item in the domain checklist must have an explicit entry:

```json
{
  "items": [
    {
      "id": "CQ-STRUCT-001",
      "disposition": "checked"
    },
    {
      "id": "CQ-NAMING-002",
      "disposition": "not_applicable",
      "reason": "Task did not introduce any collection identifiers or boolean flags."
    },
    {
      "id": "CQ-TEST-004",
      "disposition": "could_not_check",
      "reason": "Database integration fixture unavailable in offline test runner."
    }
  ],
  "adjacent_findings": [
    {
      "id": "adj-parser-01",
      "checklist_item_id": "CQ-STRUCT-001",
      "severity": "minor",
      "observation": "Legacy helper src/legacy/format.ts has cyclomatic complexity > 25, outside task write scope.",
      "remediation": "Schedule refactoring task for legacy helpers.",
      "evidence": [{ "kind": "reference", "detail": "src/legacy/format.ts:32-89" }]
    }
  ]
}
```

### Dispositions:

- **`checked`**: Item was directly inspected and satisfied.
- **`not_applicable`**: Item does not apply to this change (non-empty `reason` required).
- **`could_not_check`**: Item could not be inspected (non-empty `reason` required).
- **`adjacent_findings` (B12.1)**: Out-of-scope defects noticed during review. Surfaced to the coordinator for future task generation without blocking current task completion.

---

## 📖 6. How-To Guide: Working with Findings

### Emitting a Structured Defect

```bash
bun harness.ts task:reject \
  --run .capsules/<run-id> \
  --task <task-id> \
  --validator <val-id> \
  --token <val-token> \
  --reason "Regex in slug generator fails on Unicode emojis, emitting empty strings." \
  --severity critical \
  --remediation "Use Unicode character class property escapes: replace(/[^\\p{L}\\p{N}]+/gu, '-')" \
  --checks <gate-cmd-id>
```

### Emitting an Adversarial Probe

```bash
bun harness.ts task:probe \
  --run .capsules/<run-id> \
  --task <task-id> \
  --validator <val-id> \
  --token <val-token> \
  --demand "Prove that token revocation blacklisting survives process restarts using durable storage." \
  --revalidation "bun test tests/auth/revocation.test.ts"
```

### Querying All Open Findings

```bash
bun harness.ts finding:get --run .capsules/<run-id> --status open
```

### Querying Specific Finding Detail

```bash
bun harness.ts finding:get --run .capsules/<run-id> --id finding-task-slug-01
```

### Resolving Findings with Gate Receipts

```bash
bun harness.ts task:review \
  --run .capsules/<run-id> \
  --task <task-id> \
  --validator <val-id> \
  --token <val-token> \
  --status pass \
  --summary "All defects resolved and verified against mandatory gate suite." \
  --checks <gate-cmd-id> \
  --resolve "finding-task-slug-01=<gate-cmd-id>" \
  --resolve "probe-task-slug-01-1=<gate-cmd-id>"
```

---

## 💻 7. Tutorial: Multi-Finding Revalidation Workflow

### Context

A validator previously rejected `task-crypto-hash` with two open findings:

1. `finding-task-crypto-01` (Critical): Missing salt generation in PBKDF2 hashing.
2. `probe-task-crypto-01-1` (Minor): Probe demanding timing attack resistance evidence.

A repairer implemented the fix and re-submitted. A fresh validator (`val-crypto-2`) is leased.

### Step 1: Query Open Findings

```bash
bun harness.ts finding:get --run .capsules/run-91 --task task-crypto-hash
```

Output:

```text
Found 2 open finding(s) for task-crypto-hash:
- finding-task-crypto-01 [critical]: Missing salt generation in PBKDF2 hashing.
- probe-task-crypto-01-1 [minor]: Prove constant-time comparison is used to prevent timing attacks.
```

### Step 2: Validator Reruns Mandatory Test Gate

```bash
bun harness.ts run:exec --run .capsules/run-91 --actor val-crypto-2 --task task-crypto-hash -- \
  bun test tests/crypto/hash.test.ts
```

Receipt generated: `C-552019` (Exit code: 0).

### Step 3: Validator Runs Specific Timing Test

```bash
bun harness.ts run:exec --run .capsules/run-91 --actor val-crypto-2 --task task-crypto-hash -- \
  bun test tests/crypto/timing.test.ts
```

Receipt generated: `C-552020` (Exit code: 0).

### Step 4: Submit Review Resolving Both Findings

```bash
bun harness.ts task:review \
  --run .capsules/run-91 \
  --task task-crypto-hash \
  --validator val-crypto-2 \
  --token VAL_TOK_HASH_2 \
  --status pass \
  --summary "PBKDF2 uses 32-byte cryptographic salt. Timing resistance verified via crypto.timingSafeEqual." \
  --checks C-552019,C-552020 \
  --resolve "finding-task-crypto-01=C-552019" \
  --resolve "probe-task-crypto-01-1=C-552020"
```

The harness marks both findings `resolved` in `state.json`, records the transition event in `events.jsonl`, and advances `task-crypto-hash` to `validated`.

---

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)
