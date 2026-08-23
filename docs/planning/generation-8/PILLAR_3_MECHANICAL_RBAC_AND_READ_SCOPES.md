# Pillar 3: Hard-Coded Mechanical RBAC, Command Interlocks & Bounded Read Scopes

**Directive Reference**: `p92`  
**Status**: 🛠️ In Review & Adversarial Questioning  
**Location**: `docs/planning/generation-8/PILLAR_3_MECHANICAL_RBAC_AND_READ_SCOPES.md`

---

## 1. Problem Statement: The Prompt-Only Boundary Trap & File Wandering

1. **LLM Prompt Fragility**: Telling an LLM agent in markdown _"you must not run tests"_ or _"you must not edit files"_ is prone to context drift, hallucination, and boundary violations.
2. **Token-Burning File Wandering**: Unbounded subagents frequently read 20–50+ files across the repo during exploratory probing, burning massive token budgets before modifying 1 file.

---

## 2. Core Architecture: Code-Level Enforcement & Metadata Sandboxing

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                   METADATA-DRIVEN RBAC & HARD-CODED COMMAND INTERLOCKS                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ STEP 1: Metadata Registration (`runtime/agent-<id>.json`) ]                                   │
│  When spawned, every agent receives an immutable capabilities JSON record:                       │
│  {                                                                                               │
│    "agent_id": "val-cognition-4",                                                                │
│    "role": "validator",                                                                          │
│    "capabilities": ["read_diff", "socratic_critique", "task_probe", "task_review"],             │
│    "forbidden_commands": ["run:exec", "bun test", "tsc", "write_to_file"],                      │
│    "read_scope": ["src/mind/meta-auditor.ts", "tests/unit/mind/meta-auditor.test.ts"]           │
│  }                                                                                               │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 2: The Hard-Coded Interlock Gate (`harness.ts run:exec` & Tool Wrappers) ]               │
│  Checks caller metadata before executing any tool or command:                                    │
│                 ├── Authorized: Execute Command                                                  │
│                 └── Unauthorized: Instant Hard-Coded Rejection (0 LLM discretion)                │
│                                │                                                                 │
│                                ▼                                                                 │
│  [ STEP 3: Deterministic Error Codes for Instant Course-Correction ]                             │
│  • Cognitive Validator runs test  ==> [PERMISSION_DENIED] Role 'validator' locked out of CLI.   │
│  • Implementer runs whole-repo    ==> [INVALID_SCOPE] Must supply target file path.              │
│  • Supervisor edits source file   ==> [SUPERVISOR_WRITE_FORBIDDEN] Tier 0/1/2 cannot edit source.│
│  • Agent opens out-of-scope file  ==> [READ_SCOPE_EXCEEDED] File outside declared read_scope.    │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Currently Locked Decisions (Ready for Questioning)

1. **Decision 3.1 — Immutable Metadata Records**:
   - Every spawned agent is backed by `.capsules/run-*/runtime/agent-<id>.json` defining role, capabilities mask, write scope, and read scope.
2. **Decision 3.2 — Hard-Coded Command Interlock**:
   - `harness.ts run:exec` and tool wrappers intercept and mechanically block unauthorized commands before execution.
3. **Decision 3.3 — Bounded Read Scopes (Anti-Wandering ACL)**:
   - File read operations are bounded strictly to target files and direct imports, physically preventing out-of-scope repository wandering.
4. **Decision 3.4 — Structured Error Taxonomy**:
   - Return structured error codes (`PERMISSION_DENIED`, `INVALID_SCOPE`, `READ_SCOPE_EXCEEDED`, `WRITE_SCOPE_EXCEEDED`) with explicit remedies for instant LLM course-correction.
