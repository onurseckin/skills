# 02. Role Contracts & Task Execution Briefs

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

---

## 📄 Compact Markdown Briefs, Not JSON Packets

Rather than making agents parse multi-page JSON from disk, every command prints a compact markdown
brief (≤ 30 lines) to stdout:

```text
### Task Leased: task-slug
- **Agent**: `impl-slug`
- **Lease Token**: `K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A`
- **Duration**: 20 minutes
- **Assigned Write Scope**: `src/slug.ts`
- **Note**: Pass `--token K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A` to `task:submit`.
```

`--format json` returns the same result structured, for anything scripted. It must appear **before**
any `--`, or it is forwarded to the child process instead of read by the harness.

---

## 🎭 The Ten Canonical Roles

`AgentRole` is a closed vocabulary (`contracts/packets.ts`'s `AGENT_ROLES`). Each role has exactly
one document in `orchestrating-long-tasks/roles/<role>.md`. The `validator` role additionally carries
one contract per standing-checklist domain (B12.2) — `roles/validator-code-quality.md`,
`-product.md`, `-security.md`, `-system-design.md` and `-ui-design.md` — each declaring `role:
validator` plus its own `domain:`, so every check keyed on the literal role string `"validator"`
keeps working unchanged; a domain variant is not a separate `AgentRole` and its filename does not
match one. A unit test asserts `roles/` holds exactly one document per canonical role, plus exactly
one per validator domain — fifteen files total, not ten.

```text
+-----------------------------------------------------------------------------------------------+
|                                    THE 10 CANONICAL ROLES                                     |
+-----------------------------------------------------------------------------------------------+
| Tier 2                                                                                        |
|  1. coordinator         ---> Owns the run. Never edits a repository file.                     |
| Tier 3                                                                                        |
|  2. planner             ---> Prompt → tasks, gates, dependencies. plan:add, plan:compile      |
|  3. plan-validator      ---> The coordinator's own adversary. plan:validate-start, plan:review |
|  4. implementer         ---> task:claim --role implementer, run:exec, task:submit             |
|  5. validator           ---> task:validate-start, task:probe, task:reject, task:review        |
|  6. repairer            ---> task:claim --role repairer; closes findings, nothing else        |
|  7. completeness-critic ---> critic:review / critic:reject over the whole request             |
| Branch children (tier 3)                                                                      |
|  8. sub-implementer     ---> One branch sub-task, one disjoint sub-scope                      |
|  9. sub-validator       ---> Verification hand; produces evidence, never a verdict            |
| 10. sub-investigator    ---> Read-only diagnosis; returns a cause or an explicit unknown       |
+-----------------------------------------------------------------------------------------------+
```

The plan-validator is the newest of the ten and the only one that never touches a task: it reviews
the _compiled plan itself_ — the graph, the projected requirements and tasks, and the topology's own
reasoning for where each task landed — before a single implementer is dispatched. Its own commands,
budgets and independence rule are covered in
[Chapter 03 §03](../03-graph-scheduler/03-plan-revision-and-freezing.md); this chapter treats it like
any other role for packet publication and contract enforcement, because that machinery is identical
across all ten.

---

## 📜 The Contract Format

Each role document opens with YAML frontmatter the harness parses and hashes:

```yaml
---
role: validator
tier: 3
may:
  - Start validation on a submitted task after confirming independence from its implementers
must_not:
  - Pass before the mandatory adversarial probe round has been recorded
commands:
  - task:validate-start
  - task:probe
spawns:
  - sub-validator
---
```

| Key        | Meaning                                             | Validation                                                                                               |
| :--------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `role`     | One of the ten canonical roles.                     | Rejected otherwise.                                                                                      |
| `tier`     | Integer 1–3.                                        | Rejected otherwise.                                                                                      |
| `may`      | Explicit allowed actions.                           | Must be non-empty.                                                                                       |
| `must_not` | Non-negotiable prohibitions.                        | Must be non-empty.                                                                                       |
| `commands` | The exact CLI commands this role may invoke.        | Must be non-empty and duplicate-free; every entry is checked against `references/cli-capabilities.json`. |
| `spawns`   | Roles it may branch into or dispatch; `[]` if none. | Must name canonical roles; a role may not spawn itself.                                                  |

A malformed document is an `INTEGRITY` error, not a warning. The whole file — frontmatter and prose —
is SHA-256 hashed and that digest is recorded on the packet published for the agent, so what an agent
was told is auditable after the fact.

---

## 🔗 Where a Contract Binds

Role packets are published at every point where an agent takes on work:

| Command               | Role bound                                               |
| :-------------------- | :------------------------------------------------------- |
| `task:claim --role`   | `implementer` or `repairer`                              |
| `queue:pop`           | `implementer`                                            |
| `task:validate-start` | `validator`                                              |
| `plan:validate-start` | `plan-validator`                                         |
| `critic:start`        | `completeness-critic`                                    |
| `branch:claim --role` | `sub-implementer` / `sub-validator` / `sub-investigator` |

`plan:validate-start` mints a packet that carries the compiled graph, the projected requirements and
tasks, and the recorded topology at that revision — plus the four DESIGN.md C2 questions as explicit
prompts, the same way a validator-domain packet carries its own standing checklist (B12.2, see
[Chapter 06 §01](../06-validation-repair/01-adversarial-validation-philosophy.md)) — rather than
trusting a coordinator to type them into a dispatch prompt.

The packet embeds the role document's bytes verbatim and records their sha256 as
`role_contract_sha256`, so what an agent was handed stays provable after the fact. Each of these
commands returns `packet_id`, `packet_path` and `role_contract_sha256` alongside the bearer token.

`--role` is **mandatory** on `task:claim` and `branch:claim`. Defaulting it would bind an agent to a
contract nobody chose for it, so the harness refuses instead:

```bash
bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1 --role implementer
bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1 --role repairer
bun harness.ts branch:claim --run .capsules/<run-id> --branch <B-id> --sub-task S-1 --agent sub-1 --role sub-investigator
```

Submission and review then assert that a packet was actually published for the acting agent, role
and attempt, so a report cannot arrive from an identity that was never issued a contract. Orphan
evidence from an expired lease is the one exception: preserving a dead agent's work is not an act of
authority, and refusing it would destroy the only record of what that agent did.

## 🚧 The `commands:` List Is Enforced at Dispatch

Before any handler runs, the CLI resolves the acting agent's role from the `state.agents` grant
ledger — the record `agent:register` wrote — and refuses an invocation the role's `commands:` list
does not grant. The refusal names the role, the command and the path of the document it was checked
against:

```
role validator may not invoke task:submit: agent val-1 holds a validator grant, and the contract at
.../orchestrating-long-tasks/roles/validator.md grants only task:validate-start, run:exec, ...
```

The acting agent is the caller: `--agent` for the task and branch families, `--validator` for a
validation, `--critic` for a critic's own review, and `--actor` for the plan and run families.

Five commands hand authority to somebody else, and there the identity flag names that **subject**,
not the caller: `--agent` on `agent:register`, `agent:report`, `agent:release` and `queue:pop`, and
`--critic` on `critic:start`. All five belong to the coordinator's contract. The subject is skipped
when resolving who called, because charging a critic's contract for the `critic:start` that created
it would refuse the coordinator's own documented dispatch and record the wrong agent as having
acted. On `agent:*` the caller is `--actor`; `queue:pop` and `critic:start` take no `--actor`, so
the run holds no record of who invoked them and no contract is resolved rather than one guessed.

An identity with no grant has no recorded role, so there is no contract to enforce and none is
guessed from the shape of an agent id. What refuses an unregistered agent is the published-packet
requirement on the actions that carry authority.

---

## ⚠️ Contracts Can Be Stricter Than the Harness, Never Looser

A role may forbid something the harness would technically allow — `repairer` refuses to open a branch
even though a lease holder could, because a repair is already bounded by the findings it must close.
That is a legitimate contract.

The reverse is a lie. A role document that lists a command the harness refuses for that role teaches
an agent to fail. Two examples that were corrected:

- **`validator` may not branch.** `branch:open` demands a live implementation lease; a validator holds
  a validation token. Its branch commands were removed and the prohibition stated explicitly.
- **`sub-investigator` has no empty write scope.** Every branch sub-task requires a `--sub-scope` that
  is a proper subset of the parent's. Its read-only guarantee is the contract, not a filesystem
  permission.

---

## ⚙️ Budgets Every Role Inherits

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4
}
```

- **A pass is refused** until `min_adversarial_probes` probe rounds are recorded (default 1). A probe
  is a demand for proof, not a rejection: it does not consume repair budget.
- **Escalation** at `max_repair_rounds` (default 6) recorded rejections: the task becomes `escalated`
  rather than looping.
- **Branch nesting** past `max_branch_depth` (default 5) is an escalation to a human, not a retry.
  It is a tripwire, not the termination guarantee: that comes from every sub-scope being a strictly
  proper subset of its parent's.
- **Agent budget** at `max_agents` (default 100, assumed rather than measured): every grant a run
  issues at any depth counts, and `agent:register` and `branch:open` are refused once it is spent.

---

## 📜 Universal Invariants for Worker Subagents

- **Exclusive write scope.** Never edit, format or delete a file outside the lease — not even a
  one-line fix.
- **Direct argv.** Gate commands run through `run:exec … -- <argv>` with no shell interpolation.
- **Focused verification.** Implementers prove their own change with a focused command; the run-scope
  gate belongs to the coordinator and the critic.
- **Token confidentiality.** A plaintext token is a CLI argument and nothing else — never a log line,
  a commit message, a report field, or chat.
- **Absence stays absent.** Never substitute a plausible path, command id or check for one you did not
  observe.

---

## 🛡️ Lean Packets & Validator Context Isolation

To ensure that subagents remain laser-focused and completely immune to sycophantic cognitive bias, the harness enforces **Lean Packet Generation** and **Strict Context Isolation** (`isolateValidatorContext`, `excludeValidatorContamination`, `isolateCriticContext`).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   CONTEXT ISOLATION & LEAN PACKET PIPELINE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Task Submission / State Context ]                                        │
│    • Implementer narrative summary ("I fixed bug X, tests look good!")      │
│    • Subjective confidence estimates & decision rationale                   │
│    • Task contract, repository state, gate command definitions              │
│                                  │                                          │
│                                  ▼                                          │
│  [ isolateValidatorContext / excludeValidatorContamination ]                │
│    • Strips all subjective narrative & conclusion keys                      │
│    • Strips previous review notes & implementer excuses                     │
│    • Retains ONLY ground-truth objective evidence & contracts               │
│                                  │                                          │
│                                  ▼                                          │
│  [ Lean Validator Packet (Token-Budgeted <= 4KB) ]                          │
│    • Original prompt & acceptance criteria                                  │
│    • Exact write scope & current repository git state                       │
│    • Mandatory gate command argv to execute via run:exec                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. The Strict Validator Exclusion Set (`VALIDATOR_EXCLUSIONS`)

The context isolation pipeline recursively scrubs all keys matching subjective or contaminated reporting:

| Sanitized Key Family                 | Why It Is Stripped from Validator Context                              |
| :----------------------------------- | :--------------------------------------------------------------------- |
| `confidence`                         | Prevents anchoring on the implementer's self-confidence score.         |
| `decision_narrative`                 | Eliminates implementer rationalizations and conversational excuses.    |
| `implementer_report` / `task_report` | Strips implementer prose; validators must inspect real code.           |
| `previous_review` / `prior_reviews`  | Prevents round-2+ validators from adopting previous reviewers' biases. |
| `validator_report`                   | Prevents circular review feedback loops.                               |

### 2. The Strict Validator Allowed Allowlist

A validator packet receives **strictly** these objective fields:

- `baseline_repository_state`: Git commit SHA / tree digest before task execution.
- `current_repository_state`: Live repository tree and diffs.
- `task_contract`: Declared write scope, priority, effort, and assigned ID.
- `mapped_requirements`: Specific prompt obligations assigned to this task.
- `original_prompt`: Verbatim prompt markdown text.
- `command_evidence`: Real recorded execution receipts from `run:exec`.
- `validation_round`: Current validation cycle counter.

### 3. Critic Context Isolation (`isolateCriticContext`)

The whole-run completeness critic receives a dedicated, isolated context:

- `commands`, `completion_readiness`, `completion_result`, `completion_review`, `gates`, `graph`, `integrity_evidence`, `orphan_evidence`, `original_prompt`, `plan_history`, `repository_evidence`, `requirements`, `repository_state`, `tasks`.

This structural firewall guarantees that adversarial verification is grounded entirely in real code execution, eliminating conversational sycophancy.

---

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)
