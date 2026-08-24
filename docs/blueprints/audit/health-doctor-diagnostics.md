# Health, Doctor, and DAG Diagnostics

## Target File(s)
- `olt/scripts/src/health/doctor.ts`
- `olt/scripts/src/health/health-check.ts`
- `olt/scripts/src/health/dag-diagnostics.ts`
- `olt/scripts/src/reporting/doctor.ts`

## Things to Look For Count
1. **Script-Backed Pulses:** Pre-pulse deterministic diagnostics to ensure state sanity.
2. **DAG Badges:** How ASCII DAG badges are generated from topological graphs.
3. **Receipt Hashing:** Cryptographic guarantees of execution state.

## What's Happening Here
Before generating live telemetry or coordinating loops, the system runs deterministic script-backed diagnostics (`doctor.ts`, `health-check.ts`). These checks validate internal state ledgers (e.g., verifying that no tasks are deadlocked in the DAG, no orphaned background processes exist). The results are embedded as live CLI receipts with SHA-256 hashes and ASCII DAG diagrams (`dag-diagnostics.ts`) directly into pulse briefs, providing absolute truth to coordinators.

## LLM Friction Points & Implicit Assumptions
- **False Positives:** Strict health checks might flag transient states (like an agent taking slightly too long) as fatal anomalies.
- **DAG Complexity:** Large waves can result in ASCII DAGs that consume excessive tokens or get mangled by LLM markdown formatters.

## Concrete Simplification & Improvement Blueprint
1. **DAG Pruning:** Enhance `dag-diagnostics.ts` to only emit the immediate neighborhood of active nodes instead of the entire graph, drastically reducing token bloat.
2. **Auto-Remediation:** Wire `doctor.ts` directly to the `manage_subagents` hard reset API. If a node is zombie, `doctor.ts` should auto-kill it without requiring manual coordinator intervention.
3. **Telemetry Diffing:** Only broadcast health state changes rather than full state dumps during each pulse to save token bandwidth.
