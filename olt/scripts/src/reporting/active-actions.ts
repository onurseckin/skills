import { LEASE_TOKEN, VALIDATION_TOKEN, type TaskView } from "./action-types.ts";
import { placeholder, pushArgv, registryArgv, type ArgvFlag } from "./registry-argv.ts";

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

export function validationActions(
  entrypoint: string,
  runRoot: string,
  task: TaskView,
  minProbes: number,
  validator: string,
): string[][] {
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
