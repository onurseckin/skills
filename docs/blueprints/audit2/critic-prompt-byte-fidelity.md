# Critic Prompt Byte Fidelity

## 1. What Calls What?

The `critic-ops.ts` module provides stateless utilities that operate directly on prompt instruction text strings.

- `deconstructPromptBytes()` is called (e.g. from `diff-analyzer.ts`) to fragment a monolithic requirement prompt into singular deterministic clauses.
- `enforceByteFidelity()` is a verification layer that takes back a mapped subset of clauses and asserts they strictly align with the origin text, ensuring no mutation or hallucinatory insertion occurred during subagent processing.

## 2. Prompt Byte Clause Deconstruction

- **Clause Fragmentation:** The deconstruction mechanism operates literally on prompt bytes split via line breaks (`\n`), stripping out whitespace. Each discrete logical line becomes a `RequirementClause` object mapped with a unique ID (`req-N`), the literal string `clause`, and a `verified` boolean defaulting to `false`.
- **Absolute Byte Fidelity:** The `enforceByteFidelity()` loop physically checks `.includes()` against the raw `promptBytes`. This ensures that downstream cognitive reviewers evaluate the precise literal strings the Orchestrator/User injected, locking out LLM summarization drift.

## 3. Cognitive vs Mechanic Boundary Analysis

This tool acts as a mechanically rigorous foundation for cognitive inspection (Completeness Critic). By converting unstructured qualitative text into a rigid map of assertions (`RequirementClause`), it transforms qualitative task reviews into binary boolean arrays. This effectively bridges the gap between semantic interpretation and strict deterministic verification.

## 4. Current Live Code Verification Assessment

- **Finding Count:** 2 unconstrained core findings.
- **Evidence Sealing Trace:** The strict byte matching array (`RequirementClause[]`) passes straight to the structural Diff fidelity evaluator.
- **Verification Assessment:** The current code is highly reductionist (splitting strictly by line rather than deep syntactic NLP mapping). However, it perfectly satisfies the mechanical criteria of zero-drift enforcement and prompt byte literalization.
