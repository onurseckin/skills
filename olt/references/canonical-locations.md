# Canonical location decisions — where runtime data, scratch files and cadence values live

Two location questions produced conflicting documentation and misled agents in practice. This
section is the single resolution every hard rule and reference above defers to; there is no
`olt/docs/` or ADR convention in this repository, so the ruling lives here instead of a new file.

## `.olt/` (dotted) vs `olt/` (undotted) governance storage

**Decision: `.olt/` is authoritative for every runtime and governance artifact — `policy.json`,
`backlog.jsonl`, `completed-tasks.jsonl`, `defects.jsonl`, `completed-defects.jsonl`,
`telemetry.jsonl`, and `capsules/`.** The undotted `olt/` directory is the versioned skill package
(`SKILL.md`, `agents/`, `checklists/`, `references/`, `scripts/`) — static definition checked into
git, never a runtime write target.

Verified against the code, not assumed: `olt/scripts/src/core/shared/paths.ts` hard-codes
`OLT_DIR_NAME = ".olt"`, and every resolver built on it (`resolvePolicyPath`, `resolveBacklogPath`,
`resolveCompletedTasksPath`, `resolveDefectsPath`, `resolveCompletedDefectsPath`,
`resolveTelemetryPath`, `resolveCapsulesRoot`) joins against that constant — no code path writes to
an undotted `<repo-root>/olt/*.jsonl` ledger or a bare `capsules/` directory off repo root.
`olt/scripts/src/mind/completed-tasks.ts`
still exports legacy string constants named for the undotted path (e.g.
`CANONICAL_DEFECTS_FILE = "olt/defects.jsonl"`), but nothing dereferences them for path
resolution — the functions that actually resolve paths (`resolveCanonicalDefectsPath` and
siblings, lines 57–91) hard-code `join(root, ".olt", "defects.jsonl")` and ignore those constants
entirely. Git history confirms the move was deliberate, not accidental:
`2db78df8 feat(olt): rename skill directory to olt and governance storage to .olt`. On disk today,
`.olt/defects.jsonl` is the live ledger (hundreds of KB, still receiving uncommitted writes) while
`olt/defects.jsonl` is a 0-byte vestige last touched by a purge commit
(`f1c1e52d chore(defects): purge defect registries for clean mind test run`) and never written to
since.

This ambiguity is not academic: it produced a real incident this session — a Tier 0 auditor
checked candidate ledger paths, missed `.olt/defects.jsonl`, and filed a false CRITICAL defect
claiming the ledger was empty.

## Scratch and temporary files: system `/tmp` vs repo-local `.tmp/`

**Decision: the system temp directory (`/tmp`, `$TMPDIR`, anything `mktemp -t` produces on macOS)
is banned absolutely — it is invisible to the repo, other agents, and post-hoc audit.** Repo-local
ephemeral scratch is not banned. It has three acceptable, non-exclusive homes depending on what is
being stored: `<repo-root>/.olt/capsules/<run>/evidence/` for run-scoped evidence tied to a
specific harness run, and `<repo-root>/.tmp/` or `<repo-root>/scratch/` for scratch not tied to any
run. Pick whichever fits the artifact; none of the three is the sole exclusive location.

Verified, not assumed: `.gitignore` (`/.tmp/`) and `olt/AGENTS.md` ("Temporary testing artifacts
must be directed to designated `.tmp/` or scratch directories") both already treat `.tmp/` as
sanctioned, and `.tmp/` is in live use in this repo. A prior draft of the hard rules and
anti-pattern list banned `/tmp` and `.tmp/` in the same breath, silently contradicting both of
those sources — that conflict is the defect this section closes.

## Supervisory cadence: resolved at runtime, never hardcoded

**Decision: no cadence interval — no cron literal, no "N-minute" prose — is hardcoded anywhere in
this skill's docs or manifests.** Every supervisory scheduler cadence (mind pulse, orchestrator
round watchdog, coordinator wave watchdog) is resolved at runtime via `resolveSupervisoryCadence`
(`olt/scripts/src/core/config/cadence.ts`), which returns `arm_interval_seconds` alongside an
`arm_interval_source` provenance field recording where that number came from
(`config_override`, `host_discovered`, `assumed_default`, or `unreadable`).

Multiple divergent literal cadence values were previously hardcoded in parallel across this
skill's own docs, `agents/mind.yaml`, and the `mind:pulse` command's default arm duration, with no
single source of truth between them — that divergence is the defect this section closes.

**This round does not set a concrete default.** This round (`t3-cadence-and-policy-docs`) only
removes the hardcoded numbers from `olt/SKILL.md`, `olt/AGENTS.md`, `olt/agents/coordinator.yaml`,
and `olt/agents/mind.yaml`, and points every former hardcoded site at the resolver and its
`arm_interval_source` provenance field instead. The concrete numeric default actually fed into
`resolveSupervisoryCadence` at each call site is lane cand-11's in-flight work, not this round's.
