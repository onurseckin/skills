# OLT Quickstart & Execution Guide

---

[⏮️ Previous: Reference Index](index.md) | [📂 Reference Index](index.md) | [📚 All Chapters Index](../architecture/index.md) | [⏭️ Next: Health & Status](health-and-status.md)
---

Welcome to the **OLT Quickstart Guide**. This reference manual provides concise, copy-pasteable operator instructions for running OLT in both **Single-Task Mode** and **Mind Supervisor Mode**.

---

## ⚡ Mode A: Single-Task Execution Workflow

Use Single-Task Mode to execute an isolated, prompt-driven engineering objective with deterministic wave scheduling and adversarial validation.

### 1. Initialize Capsule & Ingest Prompt

```bash
# Initialize run capsule
bun harness.ts run:init --slug feature-auth --title "Implement JWT Authentication"

# Ingest and freeze user prompt (mode 0444)
bun harness.ts plan:init --run feature-auth --prompt "Add JWT authentication to the login service with refresh tokens and rate limiting."
```

### 2. Derive Requirements & Compile DAG

```bash
# Derive requirements from prompt lines
bun harness.ts plan:enhance --run feature-auth --auto-derive

# Compile Directed Acyclic Graph (DAG) with Brent Work/Span metrics
bun harness.ts plan:compile --run feature-auth

# Independent plan validation review
bun harness.ts plan:validate-review --run feature-auth --reviewer plan-validator --status approved
```

### 3. Claim Tasks & Execute

```bash
# Open topological execution wave
bun harness.ts queue:wave --run feature-auth

# Implementer claims task lease (monotonic token issued)
bun harness.ts task:claim --run feature-auth --task task-1 --agent implementer_auth_1

# Make edits strictly within declared write scope
# Execute Subdomain Git Staging Invariant immediately upon milestone completion
git add -A

# Submit task completion with summary
bun harness.ts task:submit --run feature-auth --task task-1 --agent implementer_auth_1 --summary "Implemented JWT token issuance and verify middleware"
```

### 4. Adversarial Review & Gate Proof

```bash
# Cognitive validator reviews implementation (0 mutating commands)
bun harness.ts task:review --run feature-auth --task task-1 --agent validator_auth_1 --status pass --evidence-class class_1_compiler

# Falsifiable gate proof execution
bun harness.ts gate:prove --run feature-auth --proof-type unit_test --command "bun test tests/unit/auth/"

# Seal run upon 9-point completion checklist satisfaction
bun harness.ts run:complete --run feature-auth
```

---

## 🧠 Mode B: Infinite Autonomous Mind Mode

Use Mind Mode for continuous, multi-round autonomous repository governance, preplanning, and strategic execution.

### 1. Initialize Mind Capsule

```bash
# Initialize primary Mind supervisor capsule
bun harness.ts mind:init --slug mind-primary
```

### 2. Launch Background Pulse Loop

```bash
# Launch infinite autonomous pulse runner
./olt/scripts/pulse.sh --run mind-primary --interval 60 --max-rounds 100
```

### 3. Manual Operator Interventions

```bash
# Ingest candidate task into triage queue
bun harness.ts mind:candidate --run mind-primary --title "Refactor Database Connection Pool" --category performance --priority 80

# Admit candidate through 6 admission gates (G1..G6)
bun harness.ts mind:admit --run mind-primary --candidate-id cand-101

# Trigger immediate supervisor wake & pulse
bun harness.ts mind:wake --run mind-primary
```

---

## 🧭 Related Architecture Chapters

- For graph theory, cycle breaking, and wave math: [Chapter 06: Topological DAG Scheduler](../architecture/06-topological-scheduler-dags/index.md)
- For leasing, heartbeats, and worker isolation: [Chapter 07: Distributed Leasing & Execution](../architecture/07-distributed-leasing-execution/index.md)
- For infinite Mind autonomous loop mechanics: [Chapter 03: Mind Product Owner](../architecture/03-mind-product-owner/index.md)
- For complete CLI dictionary: [Chapter 14: Harness CLI & Command Engine](../architecture/14-harness-cli-and-command-engine/index.md)

---

[⏮️ Previous: Reference Index](index.md) | [📂 Reference Index](index.md) | [📚 All Chapters Index](../architecture/index.md) | [⏭️ Next: Health & Status](health-and-status.md)
---
