import {
  TERMINAL_SUB_TASK_STATUSES,
  type BranchStatus,
  type BranchSubTaskStatus,
} from "../contracts/branch.ts";
import {
  mergeActions,
  LEASE_TOKEN,
  SUB_TASK_TOKEN,
  type BranchView,
  type NextActions,
} from "./action-types.ts";
import { placeholder, pushArgv, registryArgv } from "./registry-argv.ts";

// The projection carries statuses as plain strings, so the terminal set comes from the ledger's own
// constant — the one `branch:collect` enforces — rather than a second copy that could drift from it.
// The open set is written out but typed against `BranchStatus`, so a renamed status fails to compile
// here instead of quietly matching nothing.
const terminal: ReadonlySet<string> = new Set<BranchSubTaskStatus>(TERMINAL_SUB_TASK_STATUSES);
const stillOpen: ReadonlySet<string> = new Set<BranchStatus>(["open", "collecting"]);

/**
 * An open branch holds its parent's lease frozen, so a run cannot finish while one is uncollected.
 * The next command depends on where the sub-tasks are: an unclaimed one needs an agent, a claimed
 * one needs its submission, and a branch whose sub-tasks are all terminal needs the parent to
 * collect. Collect and abandon are the parent's own commands, taken under the parent's lease token.
 */
export function branchActions(
  entrypoint: string,
  runRoot: string,
  branch: BranchView,
): NextActions {
  const argv: string[][] = [];
  pushArgv(
    argv,
    registryArgv(entrypoint, "branch:status", [
      ["run", runRoot],
      ["branch", branch.id],
    ]),
  );
  for (const subTask of branch.sub_tasks) {
    if (subTask.status === "open") {
      pushArgv(
        argv,
        registryArgv(entrypoint, "branch:claim", [
          ["run", runRoot],
          ["branch", branch.id],
          ["sub-task", subTask.id],
          ["agent", placeholder(`sub-agent-for:${subTask.id}`)],
        ]),
      );
    }
    if (subTask.status === "claimed") {
      pushArgv(
        argv,
        registryArgv(entrypoint, "branch:submit", [
          ["run", runRoot],
          ["branch", branch.id],
          ["sub-task", subTask.id],
          ["agent", subTask.agent_id ?? placeholder(`sub-agent-for:${subTask.id}`)],
          ["token", SUB_TASK_TOKEN],
          ["summary", placeholder(`what-changed-in:${subTask.id}`)],
        ]),
      );
    }
  }
  const collectable = branch.sub_tasks.every((subTask) => terminal.has(subTask.status));
  if (collectable) {
    pushArgv(
      argv,
      registryArgv(entrypoint, "branch:collect", [
        ["run", runRoot],
        ["branch", branch.id],
        ["agent", branch.parent_agent_id],
        ["token", LEASE_TOKEN],
        ["summary", placeholder(`what-branch-${branch.id}-produced`)],
      ]),
    );
  }
  pushArgv(
    argv,
    registryArgv(entrypoint, "branch:abandon", [
      ["run", runRoot],
      ["branch", branch.id],
      ["agent", branch.parent_agent_id],
      ["token", LEASE_TOKEN],
      ["reason", placeholder(`why-branch-${branch.id}-was-abandoned`)],
    ]),
  );
  return { argv, unavailable: [] };
}

export function openBranchActions(
  entrypoint: string,
  runRoot: string,
  branches: readonly BranchView[],
): NextActions {
  const open = branches.filter(({ status }) => stillOpen.has(status));
  return mergeActions(...open.map((branch) => branchActions(entrypoint, runRoot, branch)));
}
