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

## 🔒 The Capture Modes & Provenance Levels

The harness supports capture mechanisms through the modern `plan:init` command:

```bash
printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <slug> --prompt-stdin
bun harness.ts plan:init --repo . --run <slug> --prompt-file prompt.txt --capture-mode file
```

`plan:init` refuses to create a capsule that git would track:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":".capsules must be gitignored before initializing a run"}}
```

```text
+-----------------------------------------------------------------------------------------------+
|                                      PROMPT CAPTURE MODES                                     |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. --prompt-stdin / Direct File Capture                                                      |
|     ➜ Piped directly via UNIX stream or read from source file without model intervention      |
|     ➜ Assigned Assurance: `source-verified`                                                   |
|                                                                                               |
|  2. Transcribed Context Copy                                                                  |
|     ➜ Transcribed from host conversation window when direct stream access is unavailable      |
|     ➜ Assigned Assurance: `recorded-unverified` (Cannot be silently upgraded)                 |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

### The Assurance Label Contract:

- **`source-verified`**: The harness opened a direct OS file descriptor or standard input pipe and hashed the raw source bytes before any model interaction.
- **`recorded-unverified`**: The prompt was copied from chat memory. The harness acknowledges that it _cannot prove_ identity to an inaccessible original source. **The harness strictly forbids an agent from silently claiming `source-verified` on a transcribed copy.**

---

## 🛡️ The `manifest.json` Cryptographic Binding

During `plan:init`, the prompt is written to `.capsules/<run-id>/prompt.md` with read-only permissions (`mode 0444`), and its SHA-256 digest is permanently bound in `manifest.json`:

```json
{
  "schema": "harness.manifest",
  "version": 1,
  "run_id": "slugger",
  "capsule_id": "f5c05b7bd29d4207a7dc0f93484717c3",
  "created_at": "2026-08-20T05:12:58.486Z",
  "capture_mode": "file",
  "assurance": "source-verified",
  "source_verified": true,
  "prompt_bytes": 200,
  "prompt_sha256": "ba20966731e18c4133cd16a43dd9d2f205c7d57844d58ce2e332cc5e2a91401d",
  "bun_version": "1.3.14",
  "runtime_version": "0.1.0"
}
```

Every subsequent command executed by the harness runtime performs a cryptographic verification before doing any work:

$$\text{assert}(\text{SHA-256}(\text{read}(\text{prompt.md})) == \text{manifest.prompt\_sha256})$$

If a single byte, space, or newline in `prompt.md` changes, the harness immediately aborts with an `INTEGRITY` error and blocks all mutations.

---

## 💡 Key Architectural Benefits

1. **Elimination of Scope Drift:** No matter how many subagents are spawned or how many context resets occur, every agent is anchored to the exact same immutable SHA-256 prompt digest.
2. **Deterministic Reproducibility:** Anyone auditing the run can inspect `prompt.md`, run `sha256sum`, and verify that the requirements map 1:1 to what was originally requested.
3. **Zero-JSON Markdown Briefs:** `plan:init` immediately confirms initialization with a concise Markdown brief ($\le 30$ lines) outlining capsule root, prompt SHA-256, and assurance level.
4. **A Derived Plan Never Displaces the Source:** `plan:enhance` records the agent's reading of the repository as a separate, read-only document whose digest lands in `state.planning`. It is labelled `agent_reported` and explicitly derived; requirements keep binding to the raw prompt digest, so a well-written plan document can never quietly become the thing the run is held to.

---

[⬅ Previous: Lifecycle Walkthrough](../01-foundations/03-lifecycle-walkthrough.md) | [Master Table of Contents](../README.md) | [Next: Line Disposition Algorithm ➡](./02-line-disposition-algorithm.md)
