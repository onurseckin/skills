# Module 4: Parallel Batch `invoke_subagent` Integration

**Document**: `docs/planning/gvui-execution-graph/10-module-4-batch.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Architectural Specification  
**Subsystem**: Multi-Agent Orchestration & Subagent Tool Protocol  

---

## 1. The Single-Batch Multi-Lane Invariant

When the Tier 2 Coordinator finishes dynamic scope partitioning and compiles the Repair Wave DAG, it **MUST NOT** serialize subagent dispatches or wait for one lane before starting another. 

### Core Invariant
> **All independent repair lanes must be dispatched simultaneously in a single, multi-entry `invoke_subagent` tool call.**

This ensures true OS-level concurrency, minimizes wall-clock turnaround, and leverages the underlying host's parallel processing capabilities.

---

## 2. Role Sanitization & Subagent Contract

The host's `invoke_subagent` schema requires:
- `TypeName`: Must be an available subagent definition (e.g. `"self"`).
- `Role`: A 2–5 word human-readable job title containing only letters, numbers, spaces, and hyphens (e.g., `"Repair Implementer: Edge Drawer"`).
- `Model`: Defaults to `"inherit"`.
- `Prompt`: A self-contained, unambiguous execution prompt with zero reliance on conversational memory.

---

## 3. Concrete Batch `invoke_subagent` JSON Payload

Below is the exact JSON structure passed to `invoke_subagent` by the Tier 2 Coordinator for a 2-lane repair wave:

```json
{
  "Subagents": [
    {
      "TypeName": "self",
      "Role": "Repair Implementer: Edge Drawer",
      "Model": "inherit",
      "Prompt": "You are the Dedicated Repair Implementer for task 'repair-R1-drawer'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- CLI Binary: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts\n- Task ID: repair-R1-drawer\n- Strict Write Scope: ['src/components/EdgeDetailDrawer']\n\n### ASSIGNED DEFECTS TO REMEDIATE:\n- Finding F-DRAWER-01: TypeScript TS2322 error on drawer toggle handler.\n  Remediation: Update EdgeDrawerProps to include optional onToggle callback.\n\n### PROTOCOL WORKFLOW:\n1. Claim task: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:claim --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-drawer --agent worker-repair-drawer\n2. Edit files ONLY within 'src/components/EdgeDetailDrawer/'.\n3. Run tests locally.\n4. Submit task: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:submit --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-drawer --agent worker-repair-drawer --token <TOKEN> --summary 'Remediated F-DRAWER-01'\n5. Send completion message back to parent."
    },
    {
      "TypeName": "self",
      "Role": "Repair Validator: Edge Drawer",
      "Model": "inherit",
      "Prompt": "You are the Independent Repair Validator for task 'repair-R1-drawer'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- CLI Binary: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts\n- Task ID: repair-R1-drawer\n\n### PROTOCOL WORKFLOW:\n1. Initiate validation: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:validate-start --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-drawer --validator validator-repair-drawer\n2. Execute authoritative gate proof:\n   bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts run:exec --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-drawer --actor validator-repair-drawer -- bun test tests\n3. Perform adversarial invariant review on 'src/components/EdgeDetailDrawer/'. Verify F-DRAWER-01 is completely resolved.\n4. Issue passing review:\n   bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:review --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-drawer --validator validator-repair-drawer --token <VAL_TOKEN> --status pass --summary 'Verified TS2322 fix and component tests pass with 0 errors'\n5. Send completion message back to parent."
    },
    {
      "TypeName": "self",
      "Role": "Repair Implementer: Layout Engine",
      "Model": "inherit",
      "Prompt": "You are the Dedicated Repair Implementer for task 'repair-R1-layout'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- CLI Binary: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts\n- Task ID: repair-R1-layout\n- Strict Write Scope: ['src/engine/layout']\n\n### ASSIGNED DEFECTS TO REMEDIATE:\n- Finding F-LAYOUT-01: Bounding box clamping fails on negative canvas coordinates.\n  Remediation: Clamp coordinates to 0 before layout projection.\n\n### PROTOCOL WORKFLOW:\n1. Claim task: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:claim --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-layout --agent worker-repair-layout\n2. Edit files ONLY within 'src/engine/layout/'.\n3. Run tests locally.\n4. Submit task: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:submit --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-layout --agent worker-repair-layout --token <TOKEN> --summary 'Remediated F-LAYOUT-01'\n5. Send completion message back to parent."
    },
    {
      "TypeName": "self",
      "Role": "Repair Validator: Layout Engine",
      "Model": "inherit",
      "Prompt": "You are the Independent Repair Validator for task 'repair-R1-layout'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- CLI Binary: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts\n- Task ID: repair-R1-layout\n\n### PROTOCOL WORKFLOW:\n1. Initiate validation: bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:validate-start --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-layout --validator validator-repair-layout\n2. Execute authoritative gate proof:\n   bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts run:exec --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-layout --actor validator-repair-layout -- bun test tests\n3. Perform adversarial invariant review on 'src/engine/layout/'. Verify F-LAYOUT-01 is completely resolved and coordinate clamping holds for all negative boundary inputs.\n4. Issue passing review:\n   bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts task:review --run /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan --task repair-R1-layout --validator validator-repair-layout --token <VAL_TOKEN> --status pass --summary 'Verified negative coordinate clamping and layout tests pass with 0 errors'\n5. Send completion message back to parent."
    }
  ]
}
```

---

## 4. Communication & Noise Suppression Protocol

1. **Subagent-to-Coordinator Messaging**:
   - Subagents communicate their lease tokens, exit codes, and test results back to the Tier 2 Coordinator using `send_message`.
   - Subagents do **NOT** communicate with the user.
2. **Coordinator-to-Parent Milestone Notifications**:
   - The Tier 2 Coordinator suppresses all fine-grained tool logs and emits a message to the user/parent **ONLY** when a milestone occurs:
     - 🚀 **Milestone 1: Repair Wave Dispatched** (`2 repair lanes dispatched: Drawer, Layout`)
     - ✅ **Milestone 2: Repair Wave Passed** (`All repair tasks passed validation barrier`)
     - 🏆 **Milestone 3: Run Sealed** (`Completeness Critic approved & capsule sealed`)
