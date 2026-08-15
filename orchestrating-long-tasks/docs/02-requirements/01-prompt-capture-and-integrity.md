# 01. Prompt Capture & Byte-Exact Integrity

[⬅ Previous: Lifecycle Walkthrough](../01-foundations/03-lifecycle-walkthrough.md) | [Master Table of Contents](../README.md) | [Next: Line Disposition Algorithm ➡](./02-line-disposition-algorithm.md)

---

## 🎯 The First Line of Defense: Byte-Exact Ingestion

The entire foundation of deterministic long-task execution depends on one non-negotiable rule: **The harness must capture and preserve the user's prompt byte-for-byte, character-for-character, before any model summarization or planning can occur.**

If an agent paraphrases, summarizes, or cleans up the prompt during ingestion:

- Subtle edge cases are silently dropped.
- Formatting and indentation requirements are lost.
- Negative constraints (e.g., _"Do NOT use third-party libraries"_) get filtered out.
- The agent invents a hallucinated baseline against which it tests itself.

---

## 🔒 The Three Capture Modes & Provenance Levels

The harness supports three capture mechanisms through the `harness.ts init` CLI:

```text
+-----------------------------------------------------------------------------------------------+
|                                      PROMPT CAPTURE MODES                                     |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. --capture-mode file --source-verified                                                     |
|     ➜ Direct read from disk file (Exact bytes, zero model transcription)                      |
|     ➜ Assigned Assurance: `source-verified`                                                   |
|                                                                                               |
|  2. --capture-mode stdin --source-verified                                                    |
|     ➜ Piped directly via UNIX stream from user terminal                                       |
|     ➜ Assigned Assurance: `source-verified`                                                   |
|                                                                                               |
|  3. --capture-mode verbatim_context_copy                                                      |
|     ➜ Transcribed from host conversation window when direct file access is unavailable        |
|     ➜ Assigned Assurance: `recorded-unverified` (Cannot be upgraded)                          |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

### The Assurance Label Contract:

- **`source-verified`**: The harness opened a direct OS file descriptor or pipe and hashed the raw source bytes before any model interaction.
- **`recorded-unverified`**: The prompt was copied from chat memory. The harness acknowledges that it _cannot prove_ identity to an inaccessible original source. **The harness strictly forbids an agent from silently claiming `source-verified` on a transcribed copy.**

---

## 🛡️ The `manifest.json` Cryptographic Binding

During `init`, the prompt is written to `.capsules/<run-id>/prompt.md` with read-only permissions (`mode 0444`), and its SHA-256 digest is permanently bound in `manifest.json`:

```json
{
  "schema": "harness.manifest",
  "version": 1,
  "run_id": "docs-system",
  "created_at": "2026-08-14T23:14:18.000Z",
  "capture_mode": "file",
  "source_verified": true,
  "prompt_bytes": 1498,
  "prompt_sha256": "8dcd43232e1bf99c2746f2d7ae338227da95178c43cbcd637a4f11486a0a9aa8",
  "creator_bun_version": "1.3.14",
  "runtime_version": "0.1.0",
  "pinned_runtime_digest": "ca0b693991f6040f5db3cfaf639048ad6549b8ac45a78ff7aaffc26e3aba71a3"
}
```

Every subsequent command executed by the harness runtime (`validate`, `plan-apply`, `schedule`, `complete`) performs a cryptographic verification before doing any work:

$$\text{assert}(\text{SHA-256}(\text{read}(\text{prompt.md})) == \text{manifest.prompt\_sha256})$$

If a single byte, space, or newline in `prompt.md` changes, the harness immediately aborts with an `INTEGRITY` error and blocks all mutations.

---

## 💡 Key Architectural Benefits

1. **Elimination of Scope Drift:** No matter how many subagents are spawned or how many context resets occur, every agent is anchored to the exact same immutable SHA-256 prompt digest.
2. **Deterministic Reproducibility:** Anyone auditing the run can inspect `prompt.md`, run `sha256sum`, and verify that the requirements map 1:1 to what was originally requested.

---

[⬅ Previous: Lifecycle Walkthrough](../01-foundations/03-lifecycle-walkthrough.md) | [Master Table of Contents](../README.md) | [Next: Line Disposition Algorithm ➡](./02-line-disposition-algorithm.md)
