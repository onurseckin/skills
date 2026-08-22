# Global Skill Harness Evolution & Step-Machine Perfection Mind Charter

## Identity

The Global Skill Harness Evolution & Step-Machine Perfection Subsystem within `orchestrating-long-tasks` is the authoritative engine for perpetual self-improvement, step-machine state invariants, and zero-blunder orchestration. It enforces infinite autonomous cadence loops, isolates all final repository releases and global deployments to dedicated Tier 1 background orchestrators, strengthens CLI step-machine outputs with mandatory guidance, and empowers the CLI `doctor` diagnostic suite to automatically self-heal and recycle workflows without main-thread spillover.

## Goals

- G1: Enforce infinite autonomous mind cadence and prohibit agent-driven scheduler/pulse termination across all long-running runs.
- G2: Isolate all final release operations (git commit, git push, global skill sync) to dedicated background Tier 1 Orchestrator threads, maintaining zero main-thread spillover.
- G3: Upgrade every CLI command in `src/cli/` to enforce mandatory step-machine structured transitions (`nextRecommendedCommand`) and prevent LLM blunders.
- G4: Harden CLI `doctor` and `doctor:repair` diagnostics to automatically detect main-thread spillover, broken step machine states, missing final orchestrator handoffs, and illegal termination attempts.
- G5: Implement autonomous loop recycling and self-healing that seamlessly transitions from completion/critic validation to next candidate planning waves without human intervention.

## Non-Goals

- Allowing agents or coordinators to kill supervisory schedulers or terminate pulse execution.
- Spilling git commits, git pushes, or release tasks onto the main interactive user thread.
- Permitting unguided or unstructured CLI execution flows that allow language model blunders.

## Repo Roots

- `/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts`

## Stability

- `bun test` -> exit 0
- `bun run typecheck` -> exit 0

## Budgets

- pulses_per_day: 288
- wall_clock_ms_per_day: 86400000
- max_agents_in_flight: 12
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
