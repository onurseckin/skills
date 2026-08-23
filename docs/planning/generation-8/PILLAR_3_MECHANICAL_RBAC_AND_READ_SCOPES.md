# Pillar 3: Hard-Coded Mechanical RBAC, Command Interlocks & Bounded Read Scopes

**Directive Reference**: `p92`  
**Status**: ✅ **APPROVED & LOCKED BY USER**  
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
│    "tier": 3,                                                                                    │
│    "capabilities": ["read_diff", "socratic_critique", "task_probe", "task_review"],             │
│    "forbidden_commands": ["run:exec", "bun test", "tsc", "write_to_file", "replace_file_content"],│
│    "write_scope": [],                                                                            │
│    "read_scope": [                                                                               │
│      "orchestrating-long-tasks/scripts/src/mind/meta-auditor.ts",                                │
│      "tests/unit/mind/meta-auditor.test.ts"                                                      │
│    ]                                                                                             │
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

## 3. Approved & Locked Decisions

### ✅ Decision 3.1 — Immutable Metadata Records (`runtime/agent-<id>.json`)

- Every spawned subagent is backed by a deterministic JSON metadata file generated at spawn time (`agent:register`), specifying its exact role, tier, capabilities mask, write scope, and read scope.

### ✅ Decision 3.2 — Hard-Coded Command Interlock Gate

- All command executions (`bun harness.ts run:exec`) and filesystem mutations pass through the code-level authorization gate before execution.
- If a Cognitive Validator attempts `bun test` or `run:exec`, the harness mechanically exits with `PERMISSION_DENIED` (0 LLM leeway).

### ✅ Decision 3.3 — Bounded Read Scopes (Anti-Wandering ACL)

- File read operations (`view_file`, `grep_search`, `read_url_content`) are bounded strictly to the files declared in `read_scope`.
- Unauthorized file reading triggers `READ_SCOPE_EXCEEDED`, cutting token-burning exploration by 70%.

### ✅ Decision 3.4 — Deterministic Error Taxonomy

- Structured, human-readable error messages allow the LLM agent to instantly recognize its boundary and self-correct on the next step without spinning in loops.
