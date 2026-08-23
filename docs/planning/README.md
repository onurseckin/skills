# Active Planning Index: Plan 92 & Plan 93

This directory contains the **active, un-implemented blueprints** ready for bootstrapping implementation.

---

## 🟡 Active Planning Blueprints

```text
docs/planning/
├── plan-92/
│   ├── PILLAR_3_MECHANICAL_RBAC_AND_READ_SCOPES.md  (Hybrid Deny-List, Universal Interlocks, Shell Gate)
│   └── PILLAR_4_MIND_OVERLOAD_AND_QUEUE_DRAINAGE.md (Mind Overload, FIFO Archival, Telemetry Stream)
│
└── plan-93/
    └── PLAN_93_OLT_CANONICAL_STORAGE_AND_CLEAN_TASK_SYSTEM.md (olt/ directory, clean taxonomy, outer capsules)
```

---

## 📋 Implementation Matrix

| Directive   | Subsystem                     | Target Files                                                                                                                   | Key Deliverables                                                                                                                                                                                    |
| :---------- | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan 92** | **RBAC & Interlocks**         | `src/policy/repo-policy.ts`<br>`src/policy/rbac-engine.ts`<br>`src/cli/commands/shell.ts`<br>`src/runtime/read-scope-guard.ts` | • `olt/policy.json` schema & auto-discovery<br>• Hybrid static + dynamic deny-list compiler<br>• Mandatory `harness.ts shell --actor <id>` gate<br>• Smart neighborhood read scope & `scope:expand` |
| **Plan 92** | **Mind Overload & FIFO**      | `src/mind/smart-task-manager.ts`<br>`src/mind/blunder-manager.ts`<br>`src/reporting/telemetry-stream.ts`                       | • Non-idle creative backlog overload ($P > 1$)<br>• Atomic FIFO drainage into `completed-*.jsonl`<br>• Visualizer telemetry stream                                                                  |
| **Plan 93** | **`olt/` Storage & Taxonomy** | `src/shared/paths.ts`<br>`src/cli/commands/todo.ts`<br>`.gitignore`                                                            | • Canonical `olt/` directory committed to git<br>• `capsules/` gitignored (internal layout untouched)<br>• Professional task taxonomy migration                                                     |

---

## 🚀 Dual Bootstrapping Swarm Strategy

Once approved by user, implementation will be executed by our **Custom Dual Bootstrapping Swarm**:

1. **Implementer (`self`)**: Surgical code & test author across disjoint files.
2. **Cognitive Auditor (`self`)**: Pure Socratic reviewer (0 commands, 0 writes) verifying 100% compliance.
