import { gateProveCommand } from "../commands/gate-prove.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const GATE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "gate:prove",
    aliases: [],
    domain: "gate",
    summary: "Prove a compiled task's gate can actually fail, on a disposable scratch copy.",
    description:
      "Copies the repository's tracked and not-ignored files into a throwaway directory, reverts the task's write scope there back to --base (default HEAD), and runs the task's compiled gate against that reverted copy. Falsifiable means the gate exits non-zero once the task's own work is gone — the property this project's own forensics found missing (docs/planning/coordinator-conformance/FORENSICS.md, DESIGN.md's C3): ten tasks sharing one whole-repo `bun run typecheck` gate that passed whether the task did its work or nothing at all. Only runs post-compile, against a task's already-compiled gate and write scope — at plan:compile time the task's work does not exist yet, so reverting it would yield a scratch copy identical to the current tree, and every verdict would degenerate to 'not falsifiable'; gate:prove is a deliberate later step, not something plan:compile runs for you. The verdict is recorded as a gate-proved capsule event via `appendGateProof`, readable back by graph/plan-audit.ts's `auditPlan` through `latestGateProof` when a caller supplies the run's state: A3-gate-discrimination and A6-whole-suite-gate treat a matching falsifiable:true proof as satisfying the invariant instead of refusing on the static heuristic alone. It never touches the real repository, since every read and write happens inside the scratch copy, deleted before this command returns. Exits 0 whether the verdict is falsifiable or not — a negative verdict is real information for the audit to act on, not a gate:prove failure; only a setup problem (no compiled gate for the task, no Git history to revert against, an unreadable repository) throws.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("task", "string", "Compiled task id whose gate is being proved."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      optionalFlag(
        "base",
        "string",
        "Git ref the task's write scope is reverted to before the gate runs. Defaults to the sha " +
          "task:claim recorded on the task's latest attempt, so the revert lands before that " +
          "attempt's own commits; falls back to HEAD only when no such sha was recorded.",
        "the claimed base sha, else HEAD",
      ),
      optionalFlag(
        "timeout-ms",
        "int",
        "Wall-clock budget for the gate command against the scratch copy; default 300000.",
      ),
      optionalFlag(
        "max-files",
        "int",
        "Refuses to copy a tree larger than this many tracked/untracked files, so an unexpectedly huge repository fails loudly instead of proving slowly; default 50000.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts gate:prove --run .olt/capsules/<run-id> --task task-1 --actor coordinator",
      "bun harness.ts gate:prove --run .olt/capsules/<run-id> --task task-1 --actor coordinator --base HEAD~1",
    ],
    handler: gateProveCommand,
  },
];
