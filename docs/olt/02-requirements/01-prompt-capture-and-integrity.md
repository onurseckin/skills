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

The harness supports capture mechanisms through the modern `plan:init` command, or the equivalent
single-entry-point `orchestrate` command:

```bash
printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <slug> --prompt-stdin
bun harness.ts plan:init --repo . --run <slug> --prompt-file prompt.txt --capture-mode file
bun harness.ts orchestrate Add a slugify helper that lowercases text and collapses punctuation.
```

`plan:init` refuses to create a capsule that git would track:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":".capsules must be gitignored before initializing a run"}}
```

The manifest's `capture_mode` field is a closed enum of exactly four values
(`store/assurance.ts`'s `CAPTURE_MODES`), and each one carries a fixed, non-negotiable default for
`source_verified` — the manifest is refused outright (`INVALID_ARGUMENT`) if a caller asserts the
opposite of what its own capture mode implies:

```text
+-----------------------------------------------------------------------------------------------+
|                                      PROMPT CAPTURE MODES                                     |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. "file"    ➜ Read from a named source file (--prompt-file). source_verified: true          |
|  2. "stdin"   ➜ Piped directly via a UNIX stream (--prompt-stdin). source_verified: true       |
|  3. "argv"    ➜ Typed inline as free text (bare `orchestrate ...`). source_verified: true      |
|  4. "verbatim_context_copy"                                                                   |
|     ➜ Transcribed from a host's conversation window when no direct stream access exists       |
|     ➜ The ONE mode whose default is source_verified: false — cannot be silently upgraded       |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

The first three modes are all forms of the harness reading bytes it can directly attest to — a file
descriptor, a stdin pipe, or argv itself — so all three earn `source-verified` by default alike;
there is no meaningful distinction in provenance strength between "piped" and "typed inline" once
the harness has the raw bytes in hand. `verbatim_context_copy` is the sole exception, precisely
because it names the one path where the harness is trusting a report of what a prompt said rather
than reading the prompt itself.

### The Assurance Label Contract:

- **`source-verified`**: The harness opened a direct OS file descriptor, a standard input pipe, or
  read argv itself, and hashed the raw source bytes before any model interaction. This is the
  default for `file`, `stdin` and `argv` capture, and is refused if a caller tries to assert
  `source_verified: false` against one of them.
- **`recorded-unverified`**: The prompt was copied from chat memory (`capture_mode:
"verbatim_context_copy"`). The harness acknowledges that it _cannot prove_ identity to an
  inaccessible original source. **The harness strictly forbids an agent from silently claiming
  `source-verified` on a transcribed copy** — `captureAssurance()` recomputes the expected assurance
  from the capture mode and rejects any manifest whose asserted `source_verified` disagrees with it.

---

## 🛡️ The `manifest.json` Cryptographic Binding

During `plan:init`, the prompt is written to `.olt/capsules/<run-id>/prompt.md` with read-only permissions (`mode 0444`), and its SHA-256 digest is permanently bound in `manifest.json`:

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

### 📎 `plan:enhance` in Detail

```bash
bun harness.ts plan:enhance --run .olt/capsules/<slug> --actor planner \
  --summary "<what this run is about>" --observation "<what the repo actually contains>" \
  --todo "<one organised step>" --risk "<what could go wrong>" --source <file-actually-read>
```

The rendered `planning/enhanced-plan.md` leads with a "Derived, not authoritative" disclaimer for a
concrete reason: the one way this document could do real damage is being mistaken for the prompt
itself. Every entry in it — `summary`, every `observation`, `risk` and `open_question` — carries
`evidence_class: "agent_reported"`, because every one of them arrived through a CLI flag; the harness
never re-reads the repository or asks a model anything to produce this document.

The command is refused outright (`INVALID_ARGUMENT`) if it would produce an **empty** enhancement:
`--source` alone is not enough to satisfy it, deliberately. `--source` only says a file was opened —
it says nothing about what was found there — so accepting it alone would be the one place a
plausible-looking planning document could be minted with nothing real behind it. At least one of
`--summary`, `--observation`, `--todo`, `--risk` or `--open-question` must be present.

Both `planning/enhanced-plan.md` and `planning/enhanced-plan.json` are written **read-only** (mode
`0444`): the enhancement is a dated claim, not a living document, so a later round that disagrees
with an earlier one re-runs `plan:enhance` again rather than editing the record in place. The digests
recorded in `state.planning` are a sha256 of the bytes that actually landed on disk — a harness
observation about what was written, never a restatement of what the caller typed in.

---

[⬅ Previous: Lifecycle Walkthrough](../01-foundations/03-lifecycle-walkthrough.md) | [Master Table of Contents](../README.md) | [Next: Line Disposition Algorithm ➡](./02-line-disposition-algorithm.md)
