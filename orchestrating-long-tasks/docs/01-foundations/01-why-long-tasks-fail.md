# 01. Why Long Tasks Fail in Autonomous Agents

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)

---

## 📌 Introduction: The Illusion of Agent Competence

When a developer asks an LLM-based coding assistant to fix a single typo or add a helper function to a single file, the model usually succeeds. The prompt is short, the context is fresh, the action is atomic, and the human directly verifies the result.

However, when developers give an autonomous AI agent a **large, multi-faceted prompt**—such as building an entire microservice, refactoring an authentication subsystem across dozens of files, or implementing a complete multi-step feature roadmap—unstructured agents routinely fail. Even state-of-the-art frontier models suffer catastrophic failures on long tasks when driven purely by conversational loops.

Understanding _why_ these failures happen is the foundational motivation behind the `orchestrating-long-tasks` harness architecture.

---

## 💥 The Anatomy of Long-Task Failure Modes

Unstructured agent runs fail due to seven fundamental failure modes:

```text
+-----------------------------------------------------------------------------------------+
|                                7 CORE AGENT FAILURE MODES                               |
+-----------------------------------------------------------------------------------------+
|  1. Scope Drift & Prompt Amnesia      ---> Forget initial constraints as chat grows     |
|  2. Sycophantic Self-Grading          ---> "I wrote the code, so of course it works!"   |
|  3. Uncoordinated Write Collisions    ---> Parallel agents overwriting each other       |
|  4. Ephemeral State Loss              ---> Process crash = complete loss of progress    |
|  5. Anchoring on Prior Biases         ---> Validators trusting flawed implementer prose |
|  6. Assurance Inflation               ---> Claiming tests passed when none were executed|
|  7. Confident Fabrication             ---> Filling an unknown value with a plausible one |
+-----------------------------------------------------------------------------------------+
```

### 1. Scope Drift and Prompt Amnesia

As an agent performs work, its context window fills with bash command outputs, compiler errors, tool calls, and conversational prose. Under context truncation or attention degradation:

- The agent forgets constraints mentioned deep within the original prompt.
- The agent invents new requirements that the user never asked for (scope creep).
- The agent "hallucinates" that it already completed requirements that it actually skipped.

### 2. Sycophantic Self-Grading (The "I Did Great!" Trap)

When the same agent that wrote a piece of code is asked: _"Did you satisfy the user's requirements and did your tests pass?"_, it will almost always answer with an enthusiastic _"Yes! Everything is fully implemented and tested."_
Even if the test command exited with code 0 because it found 0 tests, or if half the edge cases are unhandled stubs (`// TODO: implement`), the implementer agent rationalizes its own output. **An implementer cannot objectively validate its own work.**

### 3. Uncoordinated Write Collisions

If a developer spawns three parallel subagents to work on a task without a strict write-scope arbiter:

- Agent A edits `src/auth/session.ts`.
- Agent B concurrently refactors `src/auth/session.ts`.
- Agent C runs tests against an inconsistent, half-written file.
  The result is git merge conflicts, torn files, race conditions, and corrupted repositories.

### 4. Ephemeral State Loss (The Zero-Durability Crash)

Standard agent systems maintain their "state" entirely in LLM conversation memory or in-memory Python/Node objects. If:

- The network drops,
- The token limit is hit,
- The agent host crashes or restarts,
- The developer switches from Claude Code to Antigravity or Codex,
  the entire history is lost. The next agent must start over from scratch, with no authoritative record of what was completed, what was validated, and what remains to be done.

### 5. Anchoring & Cognitive Bias in Validation

When an agent reviews another agent's code, but is given the implementer's narrative (e.g., _"I refactored the database pool and increased throughput by 50%"_), the reviewer anchors on the implementer's confidence. Instead of checking edge cases, the reviewer skims the diff and rubber-stamps the change.

### 6. Assurance Inflation

Unstructured agents frequently use vague, inflated claims: _"The test suite passed hermetically with 100% certainty."_ In reality, commands run on a host machine require precise attribution and verification. The harness explicitly models evidence as `trusted_host_observed_v1`, capturing pre-command and post-command repository state, SHA-256 bound stdout/stderr, and strict process isolation without false hermetic assumptions.

### 7. Confident Fabrication

The subtlest failure is not a wrong answer; it is a **plausible** one where there was no answer at all. A summary that lists a model nobody reported, a file list that is empty because git could not be read, a dollar cost invented from a zero — each looks like data and is not. The harness answers this with `evidence_class`: every reported value is labelled `harness_observed`, `agent_reported`, `host_reported`, `derived` or `unknown`, and an absent value stays absent. See [Chapter 09 §03](../09-branching-and-honesty/03-evidence-classes-and-honesty.md).

---

## 🏛️ The Core Philosophy: Prose is Not State

To eliminate these vulnerabilities, `orchestrating-long-tasks` is built on a single, uncompromising architectural principle:

> **"Prose is not state. Memory is not proof. Agent confidence is irrelevant. An unknown is not a default."**

An agent claiming in chat that _"Feature X is complete"_ has zero authoritative weight in the harness. The harness only recognizes cryptographic proofs, deterministic filesystem state machines, append-only event logs, independent adversarial validation reports, and literal command exit records.

---

## 📜 The 10 Non-Negotiable Invariants

The harness enforces ten structural invariants that cannot be bypassed by any prompt, LLM output, or agent role:

| Invariant                             | Description                                                                                                                                  | Enforcement Mechanism                                                             |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **1. Byte-Exact Prompt Capture**      | `prompt.md` is preserved byte-for-byte with mode `0444` and bound via SHA-256 to `manifest.json`.                                            | Cryptographic SHA-256 verification on every startup and mutation (`plan:init`).   |
| **2. Immutable Capture Assurance**    | A run initialized from context copy is marked `recorded-unverified`; direct capture is `source-verified`.                                    | Closed enum schema enforcement in manifest.                                       |
| **3. 100% Line Disposition Coverage** | Every non-blank prompt line must have exactly one disposition mapping to atomic requirements.                                                | Requirements compiler validator (`plan:compile`) rejects unmapped lines.          |
| **4. Pinned Runtime & Hashed Events** | All state mutations must use the Zero-JSON colon CLI and append to `events.jsonl`.                                                           | Kernel POSIX `flock` on inode + SHA-256 hash chaining.                            |
| **5. Disjoint Write-Scope Leases**    | Parallel agents can only write within strictly disjoint directory scopes.                                                                    | Topological conflict-free scheduler arbiter (`queue:pop`, `task:claim`).          |
| **6. Adversarial Role Separation**    | Implementers cannot validate their own work; validators receive allowlisted context stripped of prose.                                       | Tokenized validator identities and context sanitization (`task:validate-start`).  |
| **7. Bounded Deterministic Retries**  | Retries are strictly bounded (configurable via `harness.config.json`, default 6 repair rounds).                                              | Watchdog command runner and repair counter escalation.                            |
| **8. Mechanical Completion Gate**     | Completion requires zero open findings, all tasks done, all gates passed, and clean critic approval.                                         | `run:complete` verification engine with live `trusted_host_observed_v1` proof.    |
| **9. Mandatory Adversarial Probe**    | A pass is refused until the validator has recorded at least `min_adversarial_probes` (default 1) probes, and every open finding is answered. | `task:probe` records demands; `task:review --status pass --resolve` answers them. |
| **10. Labelled Evidence**             | Every reported value carries an `evidence_class`; nothing substitutes a plausible value for a missing one.                                   | Typed `Evidenced<T>` wrappers in state, events and graph output.                  |

---

## 🔄 How the Harness Compares to Traditional Workflows

```text
TRADITIONAL CHAT-DRIVEN AGENTS               THE HARNESS ARCHITECTURE
================================             =======================================
[ User Prompt ]                              [ User Prompt ]
      |                                            | (Byte-exact SHA-256 capture: plan:init)
      v                                            v
[ Monolithic Conversational Context ]        [ Immutable Capsule: .capsules/<run>/ ]
      |                                            | (100% Line Coverage: plan:compile)
      v (Hallucination & Scope Drift)              v
[ Agent writes all files at once ]           [ Formal Dependency Graph DAG: plan:add ]
      |                                            | (Disjoint Write-Scope Scheduler: queue:pop)
      v (Race conditions & overwrite)              v
[ Implementer tests own code ]               [ Independent Implementer Agents (Tier 3) ]
      |                                            | (Structured Submission: task:submit)
      v (Sycophantic "Looks good!")                v
[ Claims Done (Broken Code) ]                [ Adversarial Independent Validator (Tier 3) ]
                                                   | (task:validate-start + run:exec)
                                            +------+------+
                                            | (Probe/Pass)| (Reject: Structured Findings)
                                            v             v
                                     [ Task Gates ]  [ Bounded Repair Loop (Default 6) ]
                                            |
                                            v
                                     [ Run Gates & Completeness Critic: critic:start ]
                                            | (critic:review --decision approve)
                                            v
                                     [ Mechanical Terminal Completion: run:complete ]
```

---

## 👥 Two-Tier Agent Architecture

To prevent conversational context explosion and preserve interactive responsiveness, the harness enforces a clear 3-tier hierarchy:

1. **Tier 1 (Main Interactive Thread)**: Dedicated exclusively to communicating with the user. Spawns exactly one Tier 2 Background Coordinator and does not engage in worker tool loops.
2. **Tier 2 (Background Run Coordinator)**: Manages capsule lifecycle, planning, scheduling waves, and lifecycle gates. Dispatches work to Tier 3 subagents.
3. **Tier 3 (Worker & Validator Subagents)**: Ephemeral task executors assigned disjoint write scopes. Receive compact markdown briefs ($\le 30$ lines) and report execution results back to Tier 2. Nine canonical roles exist — `coordinator`, `planner`, `implementer`, `validator`, `repairer`, `completeness-critic`, `sub-implementer`, `sub-validator`, `sub-investigator` — each with a binding capability contract in `orchestrating-long-tasks/roles/`.

Every dispatched subagent is recorded with `agent:register` before it starts, so the run can attribute work to an identity instead of inferring it later ([Chapter 09 §02](../09-branching-and-honesty/02-agent-grant-ledger.md)).

---

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)
