# Health & Doctor Diagnostics

## 1. What Calls What?

The `health` domain provides diagnostic checks ensuring the harness environments are stable and token limits are optimized.

- `generatePulseReport()` in `health-check.ts` acts as the primary composition function. It takes in raw `DagBadge` items and the `activeWave` identifier.
- It invokes `pruneAsciiDagBadges()` from `doctor.ts` to filter out visually heavy ASCII visual graphs that aren't strictly relevant to the current executing slice.
- It also invokes `checkZombieProcesses()` to scan for detached host system processes (like headless Chromium instances that failed to close).

## 2. Diagnostic Health

- **ASCII Dag Badge Pruning:** `pruneAsciiDagBadges()` filters badges based on `waveNeighborhood === activeWave || badge.isActive`. This prevents the language model's context window from overflowing with dense ASCII diagrams describing previously completed or future waves, focusing purely on the `activeWave` neighborhood to conserve tokens.
- **Zombie Process Detection:** `health-check.ts` attempts a scan (via `checkZombieProcesses()`) for stale instances. If any zombie processes are identified, it automatically appends a formal `Automated cleanup recommendation: Run 'kill -9' on the following zombie processes:` to the supervisor's active instruction pulse.

## 3. Cognitive vs Mechanic Boundary Analysis

This falls firmly within the Mechanic/Harness realm. The LLM nodes (Orchestrators, Coordinators) passively consume the output of `generatePulseReport()` via read-only telemetry pulses. The harness performs the system checks (ps/kill scans) out-of-band and directly injects the structural telemetry and health cleanup recommendations without requiring an agent to deliberately investigate the system state.

## 4. Current Live Code Verification Assessment

- **Finding Count:** 3 unconstrained core findings.
- **Evidence Collection Trace:** The generated `HealthReport` directly integrates into the system state pulse, providing active actionable `recommendations` alongside the token-pruned DAG elements.
- **Verification Assessment:** The components correctly enforce context window optimization for the DAG visualization and expose OS-level process management suggestions, keeping the cognitive load clear of system administration bloat. Note: `checkZombieProcesses()` currently contains a mock block (`return []`) that must be expanded for full physical host diagnostic fidelity, but the structural wiring is perfectly sound.
