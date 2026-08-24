# Reporting & Evidence Grounding

## 1. What Calls What? (Evidence Collection & Diff Analysis)

The reporting layer coordinates evidence pruning and export.

- `summary-exporter.ts` defines the primary export routine (`exportSummaryWithTrunking`). When generating a final payload, it maps over the array of captured `CommandEvidence` and invokes `truncateSemanticTrace` for each entry.
- `diff-analyzer.ts` imports from the Critic domain to verify prompt adherence. It takes `promptBytes` and `diffOutput`, extracts requirement clauses using `deconstructPromptBytes()`, and performs a fidelity verification mapping.
- `evidence-collector.ts` is the foundational utility providing token optimization and type definitions for native command executions.

## 2. Evidence Grounding & Zero Token Burning

- **Semantic Truncation:** `truncateSemanticTrace()` in `evidence-collector.ts` ensures strict token conservation ("Zero Token Burning"). If the raw shell output exceeds a defined maximum limit (default `50` lines), it truncates the payload, retaining the top and bottom bounds (`head` and `tail`) and injecting a formal truncation marker (`... [TRUNCATED X lines for token conservation] ...`).
- **Evidence Sealing:** The payload explicitly retains structural metrics like `exitCode`, `timingMs`, and vitally the cryptographic `sha256Hash`. These metadata elements guarantee trace grounding back to native execution. The SHA-256 bound directly maps the output back to an immutable state receipt.

## 3. Cognitive vs Mechanic Boundary Analysis

While this module doesn't dictate role assignment (that belongs to the Validation Engine), it acts as the primary data interface that mechanical and cognitive reviewers consume. The mechanical receipts (SHA-256 hashes, terminal exit codes) validate that the artifact isn't a hallucinatory synthesis, establishing ground-truth before passing it to cognitive logic.

## 4. Current Live Code Verification Assessment

- **Finding Count:** 3 unconstrained core findings.
- **Evidence Collection and Sealing Trace:** Strong mapping. The `sha256Hash` natively tracks the terminal outputs before text truncation occurs, keeping cryptographic fidelity even when the actual raw text is pruned for tokens.
- **Verification Assessment:** The reporting flow is active and accurately enforces the Zero Token Burning requirement via `truncateSemanticTrace`. Diff verification stub is naive but structurally complete for byte deconstruction integration.
