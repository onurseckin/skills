# 01. Why Long Tasks Fail in Autonomous Agents

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)

---

## 📌 Introduction: The Illusion of Agent Competence

When a developer asks an LLM-based coding assistant to fix a single typo or add a helper function to a single file, the model usually succeeds. The prompt is short, the context is fresh, the action is atomic, and the human directly verifies the result.

However, when developers give an autonomous AI agent a **large, multi-faceted prompt**—such as building an entire microservice, refactoring an authentication subsystem across dozens of files, or implementing a complete multi-step feature roadmap—unstructured agents routinely fail. Even state-of-the-art frontier models suffer catastrophic failures on long tasks when driven purely by conversational loops.

Understanding *why* these failures happen is the foundational motivation behind the `orchestrating-long-tasks` harness architecture.

---

## 💥 The Anatomy of Long-Task Failure Modes

Unstructured agent runs fail due to six fundamental failure modes:

```text
+-----------------------------------------------------------------------------------------+
|                                6 CORE AGENT FAILURE MODES                               |
+-----------------------------------------------------------------------------------------+
|  1. Scope Drift & Prompt Amnesia      ---> Forget initial constraints as chat grows     |
|  2. Sycophantic Self-Grading          ---> "I wrote the code, so of course it works!"   |
|  3. Uncoordinated Write Collisions    ---> Parallel agents overwriting each other       |
|  4. Ephemeral State Loss              ---> Process crash = complete loss of progress    |
|  5. Anchoring on Prior Biases         ---> Validators trusting flawed implementer prose |
|  6. Assurance Inflation               ---> Claiming tests passed when none were executed|
+-----------------------------------------------------------------------------------------+
```

### 1. Scope Drift and Prompt Amnesia
As an agent performs work, its context window fills with bash command outputs, compiler errors, tool calls, and conversational prose. Under context truncation or attention degradation:
- The agent forgets constraints mentioned at line 45 of the original prompt.
- The agent invents new requirements that the user never asked for (scope creep).
- The agent "hallucinates" that it already completed requirements that it actually skipped.

### 2. Sycophantic Self-Grading (The "I Did Great!" Trap)
When the same agent that wrote a piece of code is asked: *"Did you satisfy the user's requirements and did your tests pass?"*, it will almost always answer with an enthusiastic *"Yes! Everything is fully implemented and tested."*
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
When an agent reviews another agent's code, but is given the implementer's narrative (e.g., *"I refactored the database pool and increased throughput by 50%"*), the reviewer anchors on the implementer's confidence. Instead of checking edge cases, the reviewer skims the diff and rubber-stamps the change.

### 6. Assurance Inflation
Unstructured agents frequently use vague, inflated claims: *"The test suite passed hermetically with 100% certainty."* In reality, the command was run directly on the host machine against dirty untracked files, without verifying pre-command and post-command repository state.

---

## 🏛️ The Core Philosophy: Prose is Not State

To eliminate these vulnerabilities, `orchestrating-long-tasks` is built on a single, uncompromising architectural principle:

> **"Prose is not state. Memory is not proof. Agent confidence is irrelevant."**

An agent claiming in chat that *"Feature X is complete"* has zero authoritative weight in the harness. The harness only recognizes cryptographic proofs, deterministic filesystem state machines, append-only event logs, independent adversarial validation reports, and literal command exit records.

---

## 📜 The 8 Non-Negotiable Invariants

The harness enforces eight structural invariants that cannot be bypassed by any prompt, LLM output, or agent role:

| Invariant | Description | Enforcement Mechanism |
| :--- | :--- | :--- |
| **1. Byte-Exact Prompt Capture** | `prompt.md` is preserved byte-for-byte with mode `0444` and bound via SHA-256 to `manifest.json`. | Cryptographic SHA-256 verification on every startup and mutation. |
| **2. Immutable Capture Assurance** | A run initialized from context copy is marked `recorded-unverified`; it can never be silently upgraded to `source-verified`. | Closed enum schema enforcement in manifest. |
| **3. 100% Line Disposition Coverage** | Every non-blank prompt line must have exactly one disposition mapping to atomic requirements. | Requirements compiler validator rejects unmapped lines. |
| **4. Pinned Runtime & Hashed Events** | All state mutations must use the pinned Bun runtime at `.capsules/<run>/runtime/` and append to `events.jsonl`. | Kernel POSIX `flock` on inode + SHA-256 hash chaining. |
| **5. Disjoint Write-Scope Leases** | Parallel agents can only write within strictly disjoint directory scopes. | Topological conflict-free scheduler arbiter. |
| **6. Adversarial Role Separation** | Implementers cannot validate their own work; validators receive allowlisted context stripped of prose. | Tokenized validator identities and context sanitization. |
| **7. Bounded Deterministic Retries** | Retries are strictly bounded and permitted only for declared idempotent transient failures. | Watchdog command runner with exponential backoff. |
| **8. Mechanical Completion Gate** | Completion requires zero open findings, all tasks done, all gates passed, and clean critic approval. | `complete` command verification engine with live repo binding. |

---

## 🔄 How the Harness Compares to Traditional Workflows

```text
TRADITIONAL CHAT-DRIVEN AGENTS               THE HARNESS ARCHITECTURE
================================             =======================================
[ User Prompt ]                              [ User Prompt ]
      |                                            | (Byte-exact SHA-256 capture)
      v                                            v
[ Monolithic Conversational Context ]        [ Immutable Capsule: .capsules/<run>/ ]
      |                                            | (100% Line Coverage Compilation)
      v (Hallucination & Scope Drift)              v
[ Agent writes all files at once ]           [ Formal Dependency Graph DAG ]
      |                                            | (Disjoint Write-Scope Scheduler)
      v (Race conditions & overwrite)              v
[ Implementer tests own code ]               [ Independent Implementer Agents ]
      |                                            | (Structured Submission Report)
      v (Sycophantic "Looks good!")                v
[ Claims Done (Broken Code) ]                [ Adversarial Independent Validator ]
                                                   |
                                            +------+------+
                                            | (Pass)      | (Reject: Structured Findings)
                                            v             v
                                     [ Task Gates ]  [ Bounded Repair Loop (Max 3) ]
                                            |
                                            v
                                     [ Run Gates & Completeness Critic ]
                                            |
                                            v
                                     [ Mechanical Terminal Completion ]
```

---

[⬅ Master Table of Contents](../README.md) | [Next: Capsule & Storage Model ➡](./02-capsule-and-storage-model.md)
