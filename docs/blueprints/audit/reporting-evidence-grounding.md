# Reporting & Evidence Grounding

## Target File(s)
- `olt/scripts/src/reporting/summary-exporter.ts`
- `olt/scripts/src/reporting/report-generator.ts`
- `olt/scripts/src/reporting/evidence-collector.ts`
- `olt/scripts/src/reporting/diff-analyzer.ts`

## Things to Look For Count
1. **Cryptographic Binding:** How SHA-256 hashes bind test runs and screenshots.
2. **"Absence Stays Absent":** Strict logic preventing hallucinated test passes.
3. **Storage:** Writing to `.olt/capsules/<run>/evidence/`, `findings.jsonl`, `telemetry.jsonl`.

## What's Happening Here
Evidence grounding strictly adheres to "Absence Stays Absent". When tests or commands execute, `evidence-collector.ts` intercepts the raw stdio streams, hashes them, and seals them into `.olt/capsules/<run>/evidence/`. `summary-exporter.ts` and `report-generator.ts` then synthesize this data. If an expected test output or screenshot receipt doesn't exist, the system assumes failure. 

## LLM Friction Points & Implicit Assumptions
- **Token Burning:** High-verbosity test outputs are bundled into reports, risking context overflow.
- **Traceability:** LLMs might misinterpret raw hex hashes if not paired with human-readable aliases or summaries.

## Concrete Simplification & Improvement Blueprint
1. **Truncation Proxies:** Before evidence is bundled for the LLM, pass it through an aggressive semantic trunk (`diff-analyzer.ts`) that strips boilerplate and only retains the `expect()` failure stack traces.
2. **Unified Ledger:** Move away from scattered JSONL (`findings.jsonl`, `reviews.jsonl`) into a unified SQLite or structured queryable ledger that the reporting system can securely pull from without loading files into memory.
3. **Artifact Aliasing:** Replace direct SHA-256 embeddings in LLM prompts with alias tokens (e.g., `EVIDENCE_#1`) that map internally to hashes.
