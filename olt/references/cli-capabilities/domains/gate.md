# CLI Capability Manifest — gate

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `gate:prove`

Prove a compiled task's gate can actually fail, on a disposable scratch copy.

Copies the repository's tracked and not-ignored files into a throwaway directory, reverts the task's write scope there back to --base (default HEAD), and runs the task's compiled gate against that reverted copy. Falsifiable means the gate exits non-zero once the task's own work is gone — the property this project's own forensics found missing (docs/planning/coordinator-conformance/FORENSICS.md, DESIGN.md's C3): ten tasks sharing one whole-repo `bun run typecheck` gate that passed whether the task did its work or nothing at all. Only runs post-compile, against a task's already-compiled gate and write scope — at plan:compile time the task's work does not exist yet, so reverting it would yield a scratch copy identical to the current tree, and every verdict would degenerate to 'not falsifiable'; gate:prove is a deliberate later step, not something plan:compile runs for you. The verdict is recorded as a gate-proved capsule event via `appendGateProof`, readable back by graph/plan-audit.ts's `auditPlan` through `latestGateProof` when a caller supplies the run's state: A3-gate-discrimination and A6-whole-suite-gate treat a matching falsifiable:true proof as satisfying the invariant instead of refusing on the static heuristic alone. It never touches the real repository, since every read and write happens inside the scratch copy, deleted before this command returns. Exits 0 whether the verdict is falsifiable or not — a negative verdict is real information for the audit to act on, not a gate:prove failure; only a setup problem (no compiled gate for the task, no Git history to revert against, an unreadable repository) throws.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Compiled task id whose gate is being proved. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--base` | string | no | no | `the claimed base sha, else HEAD` | Git ref the task's write scope is reverted to before the gate runs. Defaults to the sha task:claim recorded on the task's latest attempt, so the revert lands before that attempt's own commits; falls back to HEAD only when no such sha was recorded. |
| `--timeout-ms` | int | no | no | - | Wall-clock budget for the gate command against the scratch copy; default 300000. |
| `--max-files` | int | no | no | - | Refuses to copy a tree larger than this many tracked/untracked files, so an unexpectedly huge repository fails loudly instead of proving slowly; default 50000. |

```bash
bun harness.ts gate:prove --run .olt/capsules/<run-id> --task task-1 --actor coordinator
bun harness.ts gate:prove --run .olt/capsules/<run-id> --task task-1 --actor coordinator --base HEAD~1
```
