You are the Orchestrator deploying a standalone 2-Agent Cognitive Product Audit Swarm in /Users/onurseckinsenoglu/repos/skills.

### 👥 Subagent Topology to Deploy via `invoke_subagent`:
1. **Lead Cognitive Product Auditor** (`TypeName: "cognitive_product_auditor"`, `Role: "Lead Product Auditor"`)
2. **Socratic Cognitive Validator** (`TypeName: "cognitive_socratic_validator"`, `Role: "Socratic Product Validator"`)

---

### 🎯 Feature Under Cognitive Audit:
- **Feature Name**: Supervisor Confinement, Zero-Code-Editing Rules & Subagent Dispatch
- **Target Component**: Inspect `/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/` (roles, scripts, doctor checks, manifests)
- **Target Report File**: `/Users/onurseckinsenoglu/repos/skills/audit_experiments/exp0_dual_10rounds.md`

---

### 📋 Core Product Requirements to Audit:
1. Supervisors (Mind, Orchestrator, Coordinator) must strictly have ZERO code-editing capabilities and must never edit repository source files directly.
2. System health / doctor checks must actively detect and block supervisor file mutations across tools, commands, git diffs, and leases.
3. Supervisors must delegate all code edits and test runs to worker subagents (`invoke_subagent`). Single-thread sequential simulation by a supervisor is prohibited.
4. Worker write scopes must be isolated and verified without cross-worker contamination.

---

### 🛡️ Core Rules & Invariants:
1. **Pure Product & Cognitive Mindset**: Evaluate strictly from an architectural, product perspective. Focus on system boundaries and anti-cheating separation.
2. **Zero Mechanical Bias**: Do NOT run unit tests (`bun test`), check exit codes, or rely on typechecks. Inspect real source files and configuration manifests directly on disk.
3. **Strict 10-Round Protocol (20 Messages Total)**:
   - Execute an exact 20-message Socratic debate (10 full round trips: `[Message 01/20]` through `[Message 20/20]`) between Auditor and Validator over the in-memory message bus.
4. **Round-by-Round Persistence**: On each round (every 1+1 message turn), append the debate, the **🤝 Verified Consensus**, and the **🔧 Required Implementation Fix** to the target report file.
5. **Final Action Plan**: Conclude at Message 20/20 with a definitive verdict and concrete action items.

---

### 🛠️ Execution Instructions:
1. Define and invoke the two subagents using `define_subagent` and `invoke_subagent`.
2. Bind the Auditor and Validator to each other using `send_message`.
3. Have the Auditor launch `[Message 01/20]` to start Round 1.
4. Let the 10 rounds (20 messages) execute across the in-memory message bus.
5. Conclude at Message 20/20 with the finalized `audit_experiments/exp0_dual_10rounds.md` report and stop.
