# Role-Targeted Sentinel Profiles (All 20 Canonical Roles)

> **Document:** `profiles.md`  
> **Master Plan:** `docs/planning/agent-scoped-live-sentinel-and-targeted-harness-doctor/PLAN.md`  
> **Tracking ID:** `fb-agent-scoped-live-sentinel-doctor-interlock`

---

## 1. Exhaustive Role-Targeted Monitoring Matrix

Every deployed agent is monitored exclusively against the invariants belonging to its specific canonical role. The sentinel evaluates live actions and state deltas using deterministic CLI probes (`bun harness.ts doctor:agent --role <role> --agent <id>`).

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             TIER 0: STRATEGIC SUPERVISORY ROLES                                  │
├──────────────────────┬────────────────────────────────────────┬──────────────────────────────────┤
│ Role                 │ Monitored Invariants & Checks          │ Interjection Triggers & Actions  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ mind                 │ • Zero source code edits (can_edit=0)  │ • Attempted code modification    │
│                      │ • Mathematical defect-first scoring    │ • Admitted feature before defect │
│                      │ • Dynamic concurrency (P >= 2)         │ • Serial P=1 single-worker lock  │
│                      │ • Periodic pulse health & cadence      │ • Missed pulse wake deadline     │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ mind-auditor         │ • Continuous candidate intake tracking │ • Failure to interject on drift  │
│                      │ • Mailbox starvation surveillance      │ • Unpolled inbox > 300s          │
│                      │ • 3 Hard Zeros (0 edits, 0 tests)      │ • Attempted shell or source edit │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ skill-auditor        │ • Monorepo LOC density (<= 300 LOC)    │ • Staged file > 300 LOC          │
│                      │ • Directory fanout (<= 10 files)       │ • Directory exceeds 10 files     │
│                      │ • Named facade exports (0 export *)    │ • Wildcard export * detected     │
│                      │ • Strict zero-any, zero-suppressions   │ • @ts-ignore or 'any' detected   │
└──────────────────────┴────────────────────────────────────────┴──────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         TIER 1 & TIER 2: ORCHESTRATION & COORDINATION                            │
├──────────────────────┬────────────────────────────────────────┬──────────────────────────────────┤
│ Role                 │ Monitored Invariants & Checks          │ Interjection Triggers & Actions  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ orchestrator         │ • Multi-round convergence criteria     │ • Premature round closure        │
│                      │ • Disjoint domain worktree isolation   │ • Root workspace modification    │
│                      │ • No direct implementer dispatch       │ • Bypassed coordinator tier      │
│                      │ • Multi-coordinator partitioning (>5)  │ • Single coordinator > 5 lanes   │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ coordinator          │ • Zero direct code edits (0 writes)    │ • Attempted source code write    │
│                      │ • Dynamic wave concurrency (P >= 2)    │ • Serial single-worker dispatch  │
│                      │ • Zero broad test suites (bun test)    │ • Executed whole-repo test suite │
│                      │ • 1-shot exact briefings (task:brief)  │ • Dispatched without task:brief  │
│                      │ • Mailbox starvation (< 300s unread)   │ • Lingering unread mailbox items │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ meta-auditor         │ • Post-wave behavioral forensics       │ • Rubber-stamped audit pass      │
│                      │ • 7 Behavioral heuristics detection    │ • Token burning / polling waste  │
│                      │ • Zero code edits, zero leases         │ • Attempted task:claim or edit   │
└──────────────────────┴────────────────────────────────────────┴──────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         TIER 3: IMPLEMENTATION & BRANCH WORKERS                                  │
├──────────────────────┬────────────────────────────────────────┬──────────────────────────────────┤
│ Role                 │ Monitored Invariants & Checks          │ Interjection Triggers & Actions  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ implementer          │ • Leased write scope confinement       │ • Modified file outside scope    │
│                      │ • Strict zero-any, zero-suppressions   │ • Introduced any or @ts-ignore   │
│                      │ • Fast file-scoped test verification   │ • task:submit without test run   │
│                      │ • Physical line budget (<= 300 LOC)    │ • File physical lines > 300      │
│                      │ • Turn 1 exact edits (0 probed reads)  │ • Spent > 2 turns exploratory    │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ sub-implementer      │ • Parent write scope strict sub-scope  │ • Modified parent's outer files  │
│                      │ • Zero test suite execution            │ • Executed whole test suites     │
│                      │ • In-lease return to parent            │ • Attempted task release to pool │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ sub-investigator     │ • Read-only diagnostic containment     │ • Attempted file write / edit    │
│                      │ • Confined to target symptom trace     │ • Attempted terminal run:exec    │
└──────────────────────┴────────────────────────────────────────┴──────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         TIER 3: VALIDATION, CRITIQUE & RELEASE                                   │
├──────────────────────┬────────────────────────────────────────┬──────────────────────────────────┤
│ Role                 │ Monitored Invariants & Checks          │ Interjection Triggers & Actions  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ validator            │ • Hardlock command ban (0 shell)       │ • Attempted run:exec or test     │
│ (cognitive)          │ • Mandatory Socratic critique / probe  │ • Approved without critique      │
│                      │ • Adversarial Gate Proof review        │ • Rubber-stamped task:review     │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ sub-validator        │ • Read-only evidence collection        │ • Attempted source code edit     │
│                      │ • Durable proof capture into evidence/ │ • Rendered verdict directly      │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ ui-headless-validator│ • Playwright headless execution pass   │ • Skipped Playwright run         │
│                      │ • 4-Viewport screenshot generation     │ • Missing required viewport image│
│                      │ • DOM touch target floors (>= 44pt)    │ • Touch target < 44pt detected   │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ ui-optical-validator │ • Mandatory view_file on image files   │ • Approved without view_file     │
│                      │ • 4 Viewport resolutions verified      │ • Skipped mobile or tablet image │
│                      │ • 8 Optical dimensions audited         │ • Boilerplate check approval     │
│                      │ • Zero command execution (0 shell)     │ • Attempted terminal run:exec    │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ completeness-critic  │ • Original prompt bytes compliance     │ • Approved partial completion    │
│                      │ • Canonical 8-Level Plan verification  │ • Ignored required level items   │
│                      │ • Zero code edits, zero leases         │ • Attempted file modification    │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ publisher            │ • 100% pre-push test suites passing    │ • git push with failing tests    │
│                      │ • Clean git index & reflog safety      │ • Unstaged dirty working tree    │
│                      │ • Modularity ratchet pre-push pass     │ • Modularity regression detected │
│                      │ • Canonical Conventional Commit format │ • Non-conventional commit msg    │
└──────────────────────┴────────────────────────────────────────┴──────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         PLANNING & GOVERNANCE ROLES                                              │
├──────────────────────┬────────────────────────────────────────┬──────────────────────────────────┤
│ Role                 │ Monitored Invariants & Checks          │ Interjection Triggers & Actions  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ independent-planner  │ • Decoupled pure-English blueprints    │ • Referenced transient code files│
│                      │ • 8-Vector epistemic completeness      │ • Omitted required plan vectors  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ independent-planner- │ • Socratic devil's advocate review     │ • Superficial design approval    │
│ audit                │ • Architectural fragility detection    │ • Approved without counter-proof │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ planner (in-run)     │ • Disjoint write scopes across tasks   │ • Created overlapping scopes     │
│                      │ • Strict DAG acyclicity & dependencies │ • Emitted cyclic dependencies    │
│                      │ • 1:1 Task-to-Implementer isolation    │ • Batched multi-subsystem tasks  │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ plan-validator       │ • Adversarial DAG topology audit       │ • Approved cyclic or overlapping │
│                      │ • Discriminating gate verification     │ • Approved generic gates         │
├──────────────────────┼────────────────────────────────────────┼──────────────────────────────────┤
│ owner                │ • Genesis bootstrapping authority      │ • Unauthorized privilege drop    │
│                      │ • Fatal recovery & circuit breaking    │ • Non-conforming charter updates │
└──────────────────────┴────────────────────────────────────────┴──────────────────────────────────┘
```
