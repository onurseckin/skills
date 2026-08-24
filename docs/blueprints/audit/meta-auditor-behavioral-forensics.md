# Meta-Auditor & Behavioral Forensics

## Target File(s)
- `olt/scripts/src/heuristics/meta-auditor-heuristics.ts`
- `olt/scripts/src/linter/anti-blunder-gates.ts`
- `olt/scripts/src/mind/meta-auditor.ts`
- `olt/scripts/src/cli/commands/meta-audit.ts`

## Things to Look For Count
1. **7 Anomaly Heuristics:** Identifying `TOKEN_BURNING`, `FALSE_SERIALIZATION`, etc.
2. **Behavioral Efficiency Score:** How is it calculated ($0.0\% - 100.0\%$).
3. **Autonomous Injection:** The `--inject` command and feedback loop.

## What's Happening Here
The Tier 2 Meta-Auditor operates post-wave, doing deep behavioral forensics on `events.jsonl` and `telemetry.jsonl`. It scans for known systemic inefficiencies across subagents—like Ghost Leases (leasing files without modifying them) or Polling Waste. It calculates a deterministic efficiency score. If bad patterns are detected, it autonomously synthesizes remediations and injects them back into the `.olt/backlog.jsonl` using `meta-audit --inject`.

## LLM Friction Points & Implicit Assumptions
- **Over-Calibration:** The meta-auditor LLM might be overly harsh or overly lenient based on temperature and prompt wording, leading to volatile efficiency scores.
- **Actionability:** Generated remediations may be vague ("improve prompt") rather than concrete ("add constraint X to prompt Y").

## Concrete Simplification & Improvement Blueprint
1. **Hard-Coded Penalties:** Offload the efficiency scoring from the LLM to deterministic TypeScript logic in `meta-auditor-heuristics.ts`. The LLM should only provide the qualitative analysis of the deterministic drops.
2. **Standardized Blunder Syntax:** Enforce a strict schema for injected remediations to ensure they directly compile into new `anti-blunder-gates.ts` rules, eliminating vague advice.
3. **Forensics Visualizer:** Emit an ASCII flame-graph of token usage and wait-times so the user (and supervisor agents) can instantly see where time was burned.
