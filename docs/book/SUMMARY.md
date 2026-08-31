# Summary

[Introduction](README.md)

---

# Part I: Foundations & Getting Started

- [Chapter 1: Quickstart & Getting Started](01-quickstart-and-getting-started.md)
  - [1. 1-Shot Global Installation](01-quickstart-and-getting-started.md#1-1-shot-global-installation)
  - [2. CLI Harness Initialization & Doctor Validation](01-quickstart-and-getting-started.md#2-cli-harness-initialization--doctor-validation)
  - [3. End-to-End Task Lifecycle Walkthrough](01-quickstart-and-getting-started.md#3-end-to-end-task-lifecycle-walkthrough)
    - [Step 1: Prompt Ingestion & Merkle Root Binding](01-quickstart-and-getting-started.md#step-1-prompt-ingestion--merkle-root-binding)
    - [Step 2: Preplanning & Failure Vector Brainstorming](01-quickstart-and-getting-started.md#step-2-preplanning--failure-vector-brainstorming)
    - [Step 3: DAG Compilation & Wave Partitioning](01-quickstart-and-getting-started.md#step-3-dag-compilation--wave-partitioning)
    - [Step 4: Wave Dispatch & Workforce Registration](01-quickstart-and-getting-started.md#step-4-wave-dispatch--workforce-registration)
    - [Step 5: Implementer Task Claim & Mutation](01-quickstart-and-getting-started.md#step-5-implementer-task-claim--mutation)
    - [Step 6: Adversarial Validation & Evidence Proving](01-quickstart-and-getting-started.md#step-6-adversarial-validation--evidence-proving)
    - [Step 7: Run Completion & Terminal Sealing](01-quickstart-and-getting-started.md#step-7-run-completion--terminal-sealing)
  - [4. Inspecting Capsules, Event Ledgers & Telemetry](01-quickstart-and-getting-started.md#4-inspecting-capsules-event-ledgers--telemetry)
  - [5. Quick Reference Cheat Sheet](01-quickstart-and-getting-started.md#5-quick-reference-cheat-sheet)

- [Chapter 2: Core Philosophy & Brent Parallelism](02-core-philosophy-and-brent-parallelism.md)
  - [1. The Zero-Assumption Philosophy & Hard Zeros](02-core-philosophy-and-brent-parallelism.md#1-the-zero-assumption-philosophy--hard-zeros)
  - [2. Multi-Agent Hierarchy & Supervisor Purity](02-core-philosophy-and-brent-parallelism.md#2-multi-agent-hierarchy--supervisor-purity)
  - [3. Concurrency Mathematics: Brent's Theorem](02-core-philosophy-and-brent-parallelism.md#3-concurrency-mathematics-brents-theorem)
    - [Brent's Work-Span Scheduling Theorem](02-core-philosophy-and-brent-parallelism.md#brents-work-span-scheduling-theorem)
    - [Minimum Task Grain Size & Subagent Spawn Overhead](02-core-philosophy-and-brent-parallelism.md#minimum-task-grain-size--subagent-spawn-overhead)
    - [Amdahl's Law vs. Gustafson-Barsis Speedup](02-core-philosophy-and-brent-parallelism.md#amdahls-law-vs-gustafson-barsis-speedup)
  - [4. Anti-Serialization Invariants & Disjoint Write Scopes](02-core-philosophy-and-brent-parallelism.md#4-anti-serialization-invariants--disjoint-write-scopes)
    - [The A4 False-Barrier Invariant](02-core-philosophy-and-brent-parallelism.md#the-a4-false-barrier-invariant)
    - [Disjoint Write Scope Independence Proof](02-core-philosophy-and-brent-parallelism.md#disjoint-write-scope-independence-proof)
  - [5. Topological Wave Compilation Algorithms](02-core-philosophy-and-brent-parallelism.md#5-topological-wave-compilation-algorithms)
    - [Kahn's Algorithm for Wave Partitioning](02-core-philosophy-and-brent-parallelism.md#kahns-algorithm-for-wave-partitioning)
    - [Tarjan's SCC Algorithm for Cycle Breaking](02-core-philosophy-and-brent-parallelism.md#tarjans-scc-algorithm-for-cycle-breaking)
  - [6. Span Minimization & Straggler SLA Management](02-core-philosophy-and-brent-parallelism.md#6-span-minimization--straggler-sla-management)

- [Chapter 3: Tier 0 Governance & Autonomous Mind](03-tier-0-governance-and-autonomous-mind.md)
  - [1. Tier 0 Autonomous Mind Architecture](03-tier-0-governance-and-autonomous-mind.md#1-tier-0-autonomous-mind-architecture)
  - [2. The Infinite Pulse Loop Cadence](03-tier-0-governance-and-autonomous-mind.md#2-the-infinite-pulse-loop-cadence)
  - [3. Dual Operational Modes: Mode A vs. Mode B](03-tier-0-governance-and-autonomous-mind.md#3-dual-operational-modes-mode-a-vs-mode-b)
    - [Mode A: Creative Product Owner & Autonomous Self-Evolution](03-tier-0-governance-and-autonomous-mind.md#mode-a-creative-product-owner--autonomous-self-evolution)
    - [Mode B: Direct Ingestion & Defect Triage](03-tier-0-governance-and-autonomous-mind.md#mode-b-direct-ingestion--defect-triage)
  - [4. Dynamic Repository Authority & Policy Discovery](03-tier-0-governance-and-autonomous-mind.md#4-dynamic-repository-authority--policy-discovery)
  - [5. The 6 Backlog Admission Gates](03-tier-0-governance-and-autonomous-mind.md#5-the-6-backlog-admission-gates)
  - [6. Long-Term Memory Persistence & Generational Rotation](03-tier-0-governance-and-autonomous-mind.md#6-long-term-memory-persistence--generational-rotation)

---

# Part II: Deep Subsystem Architecture

- [Chapter 4: Toolchain Discovery & Policy Engine](04-toolchain-discovery-and-policy-engine.md)
  - [1. Zero-Config Toolchain Auto-Discovery & Cold-Start Bootstrapping](04-toolchain-discovery-and-policy-engine.md#1-zero-config-toolchain-auto-discovery--cold-start-bootstrapping)
  - [2. Monorepo Multi-Package Boundaries & Nested Discovery](04-toolchain-discovery-and-policy-engine.md#2-monorepo-multi-package-boundaries--nested-discovery)
  - [3. The Central Policy Engine: `.olt/policy.json`](04-toolchain-discovery-and-policy-engine.md#3-the-central-policy-engine-oltpolicyjson)
  - [4. Policy Drift Verification & Safety Sweeps](04-toolchain-discovery-and-policy-engine.md#4-policy-drift-verification--safety-sweeps)
  - [5. Mechanical RBAC Matrix & Fail-Closed Gates](04-toolchain-discovery-and-policy-engine.md#5-mechanical-rbac-matrix--fail-closed-gates)
  - [6. How-To Guides & Practical Operations](04-toolchain-discovery-and-policy-engine.md#6-how-to-guides--practical-operations)

- [Chapter 5: Mandatory Companion Auditors](05-mandatory-companion-auditors.md)
  - [1. The Need for Continuous Forensic Surveillance](05-mandatory-companion-auditors.md#1-the-need-for-continuous-forensic-surveillance)
  - [2. The Mind Auditor: Governance & Anti-Stagnation Audits](05-mandatory-companion-auditors.md#2-the-mind-auditor-governance--anti-stagnation-audits)
  - [3. The Skill Auditor: Agent Persona & Execution Audits](05-mandatory-companion-auditors.md#3-the-skill-auditor-agent-persona--execution-audits)
  - [4. The 7 Forensic Heuristic Detectors](05-mandatory-companion-auditors.md#4-the-7-forensic-heuristic-detectors)
  - [5. Defect Ledger Schema & Root Cause Analysis](05-mandatory-companion-auditors.md#5-defect-ledger-schema--root-cause-analysis)
  - [6. How-To Guides & Verification Workflows](05-mandatory-companion-auditors.md#6-how-to-guides--verification-workflows)

- [Chapter 6: Lifecycle Hooks & Audio Engine](06-lifecycle-hooks-and-audio-engine.md)
  - [1. Universal Lifecycle Architecture: 34 Lifecycle Events](06-lifecycle-hooks-and-audio-engine.md#1-universal-lifecycle-architecture-34-lifecycle-events)
  - [2. Multi-Channel Hook Dispatch & Fail-Safe Isolation](06-lifecycle-hooks-and-audio-engine.md#2-multi-channel-hook-dispatch--fail-safe-isolation)
  - [3. Procedural Audio Synthesis Engine](06-lifecycle-hooks-and-audio-engine.md#3-procedural-audio-synthesis-engine)
  - [4. Custom Hook Registration & Configuration Schema](06-lifecycle-hooks-and-audio-engine.md#4-custom-hook-registration--configuration-schema)
  - [5. How-To Guides & Practical Operations](06-lifecycle-hooks-and-audio-engine.md#5-how-to-guides--practical-operations)

---

# Part III: Operational Rigor & Reference

- [Chapter 7: Host-Aware Quota Engine & Graceful Freeze](07-host-aware-quota-engine-and-graceful-freeze.md)
  - [1. Multi-Platform Host Autodetection](07-host-aware-quota-engine-and-graceful-freeze.md#1-multi-platform-host-autodetection)
  - [2. Real-Time Token Telemetry & Cowan Budget Tracking](07-host-aware-quota-engine-and-graceful-freeze.md#2-real-time-token-telemetry--cowan-budget-tracking)
  - [3. The $\le 10.0\%$ Quota Circuit-Breaker Threshold](07-host-aware-quota-engine-and-graceful-freeze.md#3-the--100-quota-circuit-breaker-threshold)
  - [4. Zero-Kill Auto-Wake & Reflog Staging Safety](07-host-aware-quota-engine-and-graceful-freeze.md#4-zero-kill-auto-wake--reflog-staging-safety)
  - [5. Graceful Freeze and Resumption Lifecycle](07-host-aware-quota-engine-and-graceful-freeze.md#5-graceful-freeze-and-resumption-lifecycle)
  - [6. Practical Reference & Operational Commands](07-host-aware-quota-engine-and-graceful-freeze.md#6-practical-reference--operational-commands)

- [Chapter 8: Verification & Socratic Gating](08-verification-and-socratic-gating.md)
  - [1. The 2-Key Pairings Architecture](08-verification-and-socratic-gating.md#1-the-2-key-pairings-architecture)
  - [2. The 1-Hop In-Lease Micro-Cycle ($k \le 5$)](08-verification-and-socratic-gating.md#2-the-1-hop-in-lease-micro-cycle-k--5)
  - [3. Dual UI Validator Separation](08-verification-and-socratic-gating.md#3-dual-ui-validator-separation)
  - [4. The Completeness Critic & Requirement Mapping](08-verification-and-socratic-gating.md#4-the-completeness-critic--requirement-mapping)
  - [5. Falsifiable Evidence Collection & Counterfactual Gate Proofs](08-verification-and-socratic-gating.md#5-falsifiable-evidence-collection--counterfactual-gate-proofs)
  - [6. How-To: Step-by-Step Validation Workflow](08-verification-and-socratic-gating.md#6-how-to-step-by-step-validation-workflow)

- [Chapter 9: Full CLI Command Reference](09-full-cli-command-reference.md)
  - [1. Global CLI Conventions & Exit Codes](09-full-cli-command-reference.md#1-global-cli-conventions--exit-codes)
  - [2. Command Domains Reference](09-full-cli-command-reference.md#2-command-domains-reference)
  - [3. Flag Type Definitions & Parsing Rules](09-full-cli-command-reference.md#3-flag-type-definitions--parsing-rules)

- [Chapter 10: Troubleshooting & Anti-Blunder Compendium](10-troubleshooting-and-anti-blunder-compendium.md)
  - [1. Emergency Recovery Recipes](10-troubleshooting-and-anti-blunder-compendium.md#1-emergency-recovery-recipes)
  - [2. The 28 Empirical Blunder Catalog](10-troubleshooting-and-anti-blunder-compendium.md#2-the-28-empirical-blunder-catalog)
  - [3. Preventive Architecture: Summary Checklist](10-troubleshooting-and-anti-blunder-compendium.md#3-preventive-architecture-summary-checklist)
