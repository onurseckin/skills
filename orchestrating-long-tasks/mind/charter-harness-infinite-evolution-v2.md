# Master Infinite Mind Charter: Behavioral Role Segregation, True System Health, 40-Agent Concurrency & Zero-Blunder Step Machine

## Identity

The Master Infinite Mind Subsystem within `orchestrating-long-tasks` is the supreme autonomous engine for perpetual capability improvement, invariant enforcement, and zero-blunder orchestration. It mandates continuous infinite cadence loops across all runs, verifies strict behavioral role boundaries (0 coordinator code writing, 0 orchestrator task implementations), isolates all final repository commits, pushes, and global deployments to Tier 1 background orchestrators with zero main-thread spillover, maximizes parallelization up to 40 agents, and hardens CLI step-machine outputs.

## Goals

- G1: Enforce behavioral role segregation and true system health auditing in `doctor` (detecting coordinator code writing, orchestrator implementation, and boundary violations).
- G2: Provide topological ASCII DAG visualization in `dag:view` with active agent coordinate badges, wave lanes, and dependency justifications.
- G3: Implement automated false-dependency decoupling and concurrency scaling supporting up to 40 parallel agents.
- G4: Enforce infinite autonomous mind cadence (Rule 17), prohibiting agents from killing schedulers or terminating pulses.
- G5: Isolate all final release operations (git commit, git push, global sync) to dedicated background Tier 1 Orchestrator threads, maintaining zero main-thread spillover.

## Non-Goals

- Allowing agents or coordinators to kill supervisory schedulers or terminate pulse execution.
- Spilling git commits, git pushes, or release tasks onto the main interactive user thread.
- Allowing coordinators to write or edit code directly on their own threads.

## Repo Roots

- `/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts`

## Stability

- `bun test` -> exit 0
- `bun run typecheck` -> exit 0

## Budgets

- pulses_per_day: 288
- wall_clock_ms_per_day: 86400000
- max_agents_in_flight: 40
- max_rounds_per_objective: 10
- base_interval_ms: 300000
- max_interval_ms: 3600000
- max_pause_interval_ms: 1800000
- pulse_deadline_ms: 1200000
- max_open_proposals: 10
- quiet_hours: null

## Prohibitions

NEVER, unattended, at any tier:

- git push --force, merge or rebase onto a default branch without passing all quality gates
- any write outside charter.repo_roots, any delete outside a leased write scope
- package publish, external cloud production deploy, or destructive data drops
- secrets reading, printing, or moving credentials
- self-modification of CHARTER.md or role contracts
