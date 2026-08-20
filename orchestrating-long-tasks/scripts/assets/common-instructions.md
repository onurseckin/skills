# Common agent instructions

These instructions are authoritative for every role packet. The packet's role contract adds the
non-negotiable capability list for that specific role; where both speak, both bind.

1. Follow system/developer instructions, the repository's checked-in agent guidance, and the
   immutable packet. Never weaken, reinterpret, or silently skip them.
2. Treat the packet's write scope as an exclusive lease. Do not edit, stage, revert, format, or
   delete any path outside it. Pre-existing and concurrent changes belong to their owners.
3. Inspect actual repository state before acting. Do not trust summaries, prior success claims, or
   an implementer's confidence as evidence.
4. Keep changes modular and context-sized. Match repository conventions; when none exist, split
   production modules before 200 physical lines and tests before 250. Prefer cohesive small files
   over catch-all runners.
5. Execute commands as literal argv without a shell. Never skip a declared command. Record exact
   argv, cwd, exit, timing, and evidence paths.
6. During implementation or repair, run only focused tests for the owned behavior. Do not make
   other agents wait on a repository-wide suite; integration and final gates belong to the
   coordinator.
7. Use test-first work for behavior changes. Demonstrate the failure, make the smallest coherent
   implementation, then rerun the focused proof.
8. Preserve public behavior unless the packet authorizes a contract change. Do not conceal a
   failure by deleting tests, relaxing assertions, changing requirements, or marking work skipped.
9. Heartbeat before the lease expires. If blocked, report the exact obstacle and durable evidence;
   do not claim completion. Stop writing after lease loss.
10. A task is not complete because code exists or tests were reported as green. Submit the required
    structured evidence and wait for independent validation and mandatory gates.
11. Never invoke a model-provider API, embed credentials, or shell out to an LLM client. Agent
    creation is performed only by the current host application's native subagent mechanism.
12. Do not manually rewrite authoritative capsule state. Use the pinned Bun runtime so mutations
    are locked, validated, event-audited, and recoverable.
13. Bearer credentials are delivered only through the host process. Never echo, copy, log, submit,
    or persist a lease, validation, or critic token. A `<host-delivered>` value in an evidence
    schema is a delivery marker, not a literal credential or permission to put one in a packet.
14. Treat the packet's digest-bound repository inspection as authoritative starting evidence.
    Non-planner packets require both baseline and current snapshots. Reinspect the actual owned
    paths before acting; stop if required inspection evidence is missing, empty, malformed, or
    inconsistent with visible repository state.
