# 01. Adversarial Validation Philosophy & Context Sanitization

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

---

## 🎭 The Fatal Flaw of Self-Grading

In traditional agent workflows, when an AI writes code and is asked _"Did your tests pass?"_, it evaluates its own output under deep cognitive and conversational bias:

- It assumes its reasoning was correct.
- It interprets ambiguous test output optimistically.
- It overlooks unhandled edge cases because it didn't think of them during implementation.

To achieve production-grade reliability, `orchestrating-long-tasks` enforces **Adversarial Role Separation**:

> **An implementer is NEVER permitted to validate its own task. Validation MUST be performed by an independent validator agent possessing a distinct cryptographic lease.**

---

## 🧼 Context Sanitization: Stripping Prose & Confidence

Even when a separate agent is used as a validator, a subtle cognitive trap remains: **Anchoring Bias**.
If the validator reads the implementer's chat narrative (e.g., _"I refactored the auth module, verified all tokens, and achieved 100% test coverage"_), the validator subconsciously assumes the work is solid and skims the diff.

The harness eliminates anchoring bias through **Context Sanitization**:

```text
[ Implementer Submits Work: task:submit ]
  ├── summary: "I fixed the bug and tests pass 100%!" (PROSE)
  ├── files_changed: ["src/auth.ts"]
  └── write_scope: ["src/auth"]
                  │
                  ▼ (Harness Sanitization Engine: task:validate-start)
┌────────────────────────────────────────────────────────┐
│  STRIPPED FROM VALIDATOR BRIEF:                        │
│  ❌ implementer_narrative   ❌ subjective_confidence   │
│  ❌ prior_review_notes      ❌ implementer_claims      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
[ Pure Allowlisted Context Delivered to Validator ]
  ✅ Original Prompt Text
  ✅ Atomic Acceptance Criteria
  ✅ Physical Git Diff on Disk
  ✅ Mandatory Test Command Argv (run:exec)
```

---

## 🔍 The Validator's Mindset: Adversarial Verification

The validator's sole job is to **attempt to break the implementation** within the bounds of the acceptance criteria:

1. It does not trust the implementer's narrative.
2. It inspects the actual code on disk.
3. It executes the mandatory test command directly via `run:exec`.
4. It checks negative constraints, edge cases, type contracts, and failure modes.
5. It issues either a `pass` verdict via `task:review` or a `reject` verdict backed by structured findings via `task:reject`.

---

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)
