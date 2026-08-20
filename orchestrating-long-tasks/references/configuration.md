# Harness configuration

Behaviour is customised by a `harness.config.json` or `.harness.config.json` in the repository root,
or a `config.json` / `harness.config.json` inside the capsule. Repository settings win over capsule
settings, and anything unset keeps its default.

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4
}
```

| Key                      | Default    | What it governs                                                                                                                                                                       |
| :----------------------- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `min_adversarial_probes` | `1`        | Probe rounds a task must record before `task:review --status pass` is allowed.                                                                                                        |
| `max_repair_rounds`      | `6`        | Repair rounds before a task transitions to `escalated`. Probes do not consume this budget.                                                                                            |
| `max_branch_depth`       | `5`        | Escalation tripwire on branch nesting. Termination is guaranteed by the proper-subset rule on write scopes, so crossing this reads as a mis-scoped task a human should look at.        |
| `max_agents`             | `100`      | Grants a run may mint. `agent:register` and `branch:open` are refused once the budget is spent, rather than the run silently growing without bound.                                    |
| `max_output_bytes`       | `10485760` | Maximum stdout/stderr captured per command execution (10 MiB).                                                                                                                        |
| `default_lease_seconds`  | `1800`     | Default lease duration for a **branch sub-task** claim (`branch:claim`). It does not govern `task:claim` or `queue:pop`, whose lease is 1,200 seconds unless a lease flag says otherwise. |
| `default_max_parallel`   | `4`        | Wave size cap used by `queue:wave` and the scheduler.                                                                                                                                 |

Mandatory gate coverage and independent-validator checks are not configurable — they are enforced
unconditionally by the graph compiler and the completion checks, not gated behind a knob.

These values are read by the harness, never inferred: a config key nobody set keeps the default
above, and the default is what the code enforces. The semantics each key protects are in
[`protocol.md`](protocol.md); the ledgers they bound are in [`state-model.md`](state-model.md).
