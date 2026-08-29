# Prompt Ingestion & Cryptographic SHA-256 Binding

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 04](./index.md) > 04-01 Prompt Ingestion

---

[⏮️ Previous: Chapter 04: Continuous Preplanning Factory Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 04-02 100% Line Coverage Invariant](04-02-one-hundred-percent-line-coverage.md)
---

## 1. Upstream Prompt Tampering & Drift

In conversational agent workflows, user instructions frequently undergo **instruction drift**:

1. Intermediate agents summarize or paraphrase user prompts, stripping subtle edge-case constraints.
2. Context window truncations drop the initial user instructions during multi-turn conversations.
3. Rogue subagents alter requirements to match flawed implementations.

---

## 2. Byte-Exact Ingestion & Read-Only Immutability

OLT eliminates instruction drift by treating the user prompt as an **immutable binary artifact**:

```text
                          BYTE-EXACT PROMPT SEALING
 ┌───────────────────┐      plan:init       ┌─────────────────────────────────┐
 │ Raw Input String  │ ───────────────────► │ .olt/capsules/<slug>/prompt.txt │
 │ (STDIN / CLI arg) │                      │ Mode: 0444 (POSIX Read-Only)    │
 └───────────────────┘                      └─────────────────────────────────┘
                                                             │
                                                             ▼ SHA-256
                                            ┌─────────────────────────────────┐
                                            │ manifest.json                   │
                                            │ "prompt_sha256": "e3b0c442..."  │
                                            └─────────────────────────────────┘
```

1. **Atomic Ingestion**: The command `bun harness.ts plan:init --run <slug> --prompt <string>` writes the exact input bytes to `prompt.txt`.
2. **Filesystem Immutability**: The file permissions are locked to Unix mode `0444` (`chmod 0444`). Any subsequent attempt to overwrite `prompt.txt` triggers a kernel permission error.
3. **Cryptographic Manifest Binding**: The SHA-256 hash of `prompt.txt` is permanently recorded in `manifest.json`. Every downstream preplanning command verifies that `SHA256(prompt.txt) == manifest.prompt_sha256`.

---

[⏮️ Previous: Chapter 04: Continuous Preplanning Factory Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 04-02 100% Line Coverage Invariant](04-02-one-hundred-percent-line-coverage.md)
---
