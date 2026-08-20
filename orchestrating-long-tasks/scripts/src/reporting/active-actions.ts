import { LEASE_TOKEN, VALIDATION_TOKEN, type TaskView } from "./action-types.ts";
import { placeholder, pushArgv, registryArgv, type ArgvFlag } from "./registry-argv.ts";

/** The commands the agent holding the lease can still run: it owns the work until it submits. */
export function leasedActions(entrypoint: string, runRoot: string, task: TaskView): string[][] {
  const agent = task.owner!;
  const argv: string[][] = [];
  pushArgv(
    argv,
    registryArgv(entrypoint, "task:heartbeat", [
      ["run", runRoot],
      ["task", task.id],
      ["agent", agent],
      ["token", LEASE_TOKEN],
    ]),
  );
  pushArgv(
    argv,
    registryArgv(entrypoint, "task:submit", [
      ["run", runRoot],
      ["task", task.id],
      ["agent", agent],
      ["token", LEASE_TOKEN],
      ["summary", placeholder(`what-changed-in:${task.id}`)],
    ]),
  );
  return argv;
}

/**
 * A validator owes `minProbes` probe rounds before a pass is accepted at all, so the probe is named
 * ahead of the verdict whenever the recorded count is short. The verdict itself stays a hole: the
 * handoff says which command records the judgement, never what the judgement is.
 */
export function validationActions(
  entrypoint: string,
  runRoot: string,
  task: TaskView,
  minProbes: number,
): string[][] {
  const validator = task.validation!.validator_id;
  const argv: string[][] = [];
  if (task.probe_round < minProbes) {
    pushArgv(
      argv,
      registryArgv(entrypoint, "task:probe", [
        ["run", runRoot],
        ["task", task.id],
        ["validator", validator],
        ["token", VALIDATION_TOKEN],
        ["demand", placeholder(`what-${task.id}-must-prove`)],
      ]),
    );
  }
  // A pass is refused while any probe demand is still open, so the verdict line carries one
  // --resolve per open finding. The command id stays a hole: the harness reads the recorded exit
  // code, and only the run that answers the demand knows which command answered it.
  const resolutions: ArgvFlag[] = task.open_finding_ids.map((id) => [
    "resolve",
    `${id}=${placeholder(`command-id-answering:${id}`)}`,
  ]);
  pushArgv(
    argv,
    registryArgv(entrypoint, "task:review", [
      ["run", runRoot],
      ["task", task.id],
      ["validator", validator],
      ["token", VALIDATION_TOKEN],
      ["status", placeholder("pass-or-fail")],
      ...resolutions,
    ]),
  );
  return argv;
}
