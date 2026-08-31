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
    - [Work, Span, and Theoretical Bounds](02-core-philosophy-and-brent-parallelism.md#work-span-and-theoretical-bounds)
    - [Amdahl's Law vs. Gustafson-Barsis Speedup](02-core-philosophy-and-brent-parallelism.md#amdahls-law-vs-gustafson-barsis-speedup)
  - [4. Anti-Serialization Invariants & Disjoint Write Scopes](02-core-philosophy-and-brent-parallelism.md#4-anti-serialization-invariants--disjoint-write-scopes)
    - [The A4 False-Barrier Invariant](02-core-philosophy-and-brent-parallelism.md#the-a4-false-barrier-invariant)
    - [Disjoint Write Scope Independence Proof](02-core-philosophy-and-brent-parallelism.md#disjoint-write-scope-independence-proof)
  - [5. Topological Wave Compilation Algorithms](02-core-philosophy-and-brent-parallelism.md#5-topological-wave-compilation-algorithms)
    - [Kahn's Algorithm for DAG Partitioning](02-core-philosophy-and-brent-parallelism.md#kahns-algorithm-for-dag-partitioning)
    - [Tarjan's SCC Algorithm for Cycle Breaking](02-core-philosophy-and-brent-parallelism.md#tarjans-scc-algorithm-for-cycle-breaking)
  - [6. Span Minimization & Straggler SLA Management](02-core-philosophy-and-brent-parallelism.md#6-span-minimization--straggler-sla-management)

- [Chapter 3: Tier 0 Governance & Autonomous Mind](03-tier-0-governance-and-autonomous-mind.md)
  - [1. Tier 0 Autonomous Mind Architecture](03-tier-0-governance-and-autonomous-mind.md#1-tier-0-autonomous-mind-architecture)
  - [2. The Infinite Pulse Loop Cadence](03-tier-0-governance-and-autonomous-mind.md#2-the-infinite-pulse-loop-cadence)
  - [3. Dual Operational Modes: Mode A vs. Mode B](03-tier-0-governance-and-autonomous-mind.md#3-dual-operational-modes-mode-a-vs-mode-b)
    - [Mode A: Creative Product Owner & Expansion](03-tier-0-governance-and-autonomous-mind.md#mode-a-creative-product-owner--expansion)
    - [Mode B: Direct Ingestion & Defect Triage](03-tier-0-governance-and-autonomous-mind.md#mode-b-direct-ingestion--defect-triage)
  - [4. Dynamic Repository Authority & Policy Discovery](03-tier-0-governance-and-autonomous-mind.md#4-dynamic-repository-authority--policy-discovery)
  - [5. The 6 Backlog Admission Gates](03-tier-0-governance-and-autonomous-mind.md#5-the-6-backlog-admission-gates)
  - [6. Long-Term Memory Persistence & Generational Rotation](03-tier-0-governance-and-autonomous-mind.md#6-long-term-memory-persistence--generational-rotation)

---

# Part II: Deep Subsystem Architecture

- [Chapter 4: Toolchain Discovery & Policy Engine](04-toolchain-discovery-and-policy-engine.md)
  - [1. Zero-Config Toolchain Auto-Discovery](04-toolchain-discovery-and-policy-engine.md#1-zero-config-toolchain-auto-discovery)
  - [2. The Central Policy Engine: `.olt/policy.json`](04-toolchain-discovery-and-policy-engine.md#2-the-central-policy-engine-oltpolicyjson)
  - [3. Policy Drift Verification & Safety Sweeps](04-toolchain-discovery-and-policy-engine.md#3-policy-drift-verification--safety-sweeps)
  - [4. Sandboxed Execution & Tool Permission Grants](04-toolchain-discovery-and-policy-engine.md#4-sandboxed-execution--tool-permission-grants)

- [Chapter 5: Mandatory Companion Auditors](05-mandatory-companion-auditors.md)
  - [1. The Need for Continuous Forensic Surveillance](05-mandatory-companion-auditors.md#1-the-need-for-continuous-forensic-surveillance)
  - [2. The Mind Auditor: Governance & Triage Audits](05-mandatory-companion-auditors.md#2-the-mind-auditor-governance--triage-audits)
  - [3. The Skill Auditor: Agent Persona & Execution Audits](05-mandatory-companion-auditors.md#3-the-skill-auditor-agent-persona--execution-audits)
  - [4. The 7 Forensic Heuristic Detectors](05-mandatory-companion-auditors.md#4-the-7-forensic-heuristic-detectors)
  - [5. Defect Ledger Schema & Root Cause Analysis](05-mandatory-companion-auditors.md#5-defect-ledger-schema--root-cause-analysis)

- [Chapter 6: Lifecycle Hooks & Audio Engine](06-lifecycle-hooks-and-audio-engine.md)
  - [1. Universal Lifecycle Architecture: 34 Lifecycle Events](06-lifecycle-hooks-and-audio-engine.md#1-universal-lifecycle-architecture-34-lifecycle-events)
  - [2. Multi-Channel Hook Dispatch Engine](06-lifecycle-hooks-and-audio-engine.md#2-multi-channel-hook-dispatch-engine)
    - [Shell Command Hooks](06-lifecycle-hooks-and-audio-engine.md#shell-command-hooks)
    - [HTTP Webhook & Telemetry Endpoints](06-lifecycle-hooks-and-audio-engine.md#http-webhook--telemetry-endpoints)
  - [3. Procedural Audio Synthesis Engine](06-lifecycle-hooks-and-audio-engine.md#3-procedural-audio-synthesis-engine)
  - [4. Custom Hook Registration & Extensibility](06-lifecycle-hooks-and-audio-engine.md#4-custom-hook-registration--extensibility)

---

# Part III: Operational Rigor & Reference

- [Chapter 7: Host-Aware Quota Engine & Graceful Freeze](07-host-aware-quota-engine-and-graceful-freeze.md)
  - [1. Multi-Host Token & Quota Tracking](07-host-aware-quota-engine-and-graceful-freeze.md#1-multi-host-token--quota-tracking)
  - [2. The `< 10% Rate-Limit Graceful Freeze` Mechanism](07-host-aware-quota-engine-and-graceful-freeze.md#2-the--10-rate-limit-graceful-freeze-mechanism)
  - [3. Cowan Token Density & Context Leak Prevention](07-host-aware-quota-engine-and-graceful-freeze.md#3-cowan-token-density--context-leak-prevention)
  - [4. Recovery & Automatic Unfreezing Protocols](07-host-aware-quota-engine-and-graceful-freeze.md#4-recovery--automatic-unfreezing-protocols)

- [Chapter 8: Verification & Socratic Gating](08-verification-and-socratic-gating.md)
  - [1. Adversarial Validation Philosophy & Separation of Powers](08-verification-and-socratic-gating.md#1-adversarial-validation-philosophy--separation-of-powers)
  - [2. The 4-Tier Hierarchy of Evidence](08-verification-and-socratic-gating.md#2-the-4-tier-hierarchy-of-evidence)
  - [3. Visual APCA Perceptual Contrast & PNG Binary Audits](08-verification-and-socratic-gating.md#3-visual-apca-perceptual-contrast--png-binary-audits)
  - [4. Socratic Finding Records & Monotonic Repair Loops](08-verification-and-socratic-gating.md#4-socratic-finding-records--monotonic-repair-loops)
  - [5. The 2-Key Completion Ceremony](08-verification-and-socratic-gating.md#5-the-2-key-completion-ceremony)

- [Chapter 9: Full CLI Command Reference](09-full-cli-command-reference.md)
  - [1. Global Flags & Conventions](09-full-cli-command-reference.md#1-global-flags--conventions)
  - [2. Task Domain Commands (`task:*`)](09-full-cli-command-reference.md#2-task-domain-commands)
  - [3. Plan Domain Commands (`plan:*`)](09-full-cli-command-reference.md#3-plan-domain-commands)
  - [4. Agent Domain Commands (`agent:*`)](09-full-cli-command-reference.md#4-agent-domain-commands)
  - [5. Mind Domain Commands (`mind:*`)](09-full-cli-command-reference.md#5-mind-domain-commands)
  - [6. Gate & Finding Commands (`gate:*`, `finding:*`)](09-full-cli-command-reference.md#6-gate--finding-commands)
  - [7. Policy & Queue Commands (`policy:*`, `queue:*`)](09-full-cli-command-reference.md#7-policy--queue-commands)
  - [8. Doctor & Run Commands (`doctor`, `run:*`)](09-full-cli-command-reference.md#8-doctor--run-commands)

- [Chapter 10: Troubleshooting & Anti-Blunder Compendium](10-troubleshooting-and-anti-blunder-compendium.md)
  - [1. Error Code Taxonomy & Diagnostic Tree](10-troubleshooting-and-anti-blunder-compendium.md#1-error-code-taxonomy--diagnostic-tree)
  - [2. Lock Contention & Process Stagnation Runbooks](10-troubleshooting-and-anti-blunder-compendium.md#2-lock-contention--process-stagnation-runbooks)
  - [3. Role Confinement & Boundary Violation Remediation](10-troubleshooting-and-anti-blunder-compendium.md#3-role-confinement--boundary-violation-remediation)
  - [4. Lease Expiration & Zombie Worker Recovery](10-troubleshooting-and-anti-blunder-compendium.md#4-lease-expiration--zombie-worker-recovery)
  - [5. Real-World Anti-Blunder Compendium](10-troubleshooting-and-anti-blunder-compendium.md#5-real-world-anti-blunder-compendium)
