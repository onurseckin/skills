import { packetSecret, placeholder, type PacketView, type TaskView } from "./action-types.ts";

export function leasedActions(
  prefix: string[],
  runRoot: string,
  task: TaskView,
  packets: PacketView[],
): string[][] {
  const packet = packets.find(
    (entry) =>
      entry.task_id === task.id &&
      entry.agent_id === task.owner &&
      entry.role === task.role &&
      entry.attempt === task.attempt,
  );
  const token = packetSecret(packet);
  const commands: string[][] = [];
  if (!packet)
    commands.push([
      ...prefix,
      "packet",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--role",
      task.role!,
      "--agent",
      task.owner!,
      "--token",
      token,
      "--id",
      `${task.id}-${task.role}-${task.attempt ?? 1}`,
    ]);
  commands.push(
    [
      ...prefix,
      "heartbeat",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--agent",
      task.owner!,
      "--token",
      token,
    ],
    [
      ...prefix,
      "submit",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--agent",
      task.owner!,
      "--token",
      token,
      "--report",
      placeholder(`submission-json-for:${task.id}`),
    ],
  );
  return commands;
}

export function validationActions(
  prefix: string[],
  runRoot: string,
  task: TaskView,
  packets: PacketView[],
): string[][] {
  const validator = task.validation!.validator_id;
  const packet = packets.find(
    (entry) =>
      entry.task_id === task.id && entry.role === "validator" && entry.agent_id === validator,
  );
  const token = packetSecret(packet);
  const commands: string[][] = [];
  if (!packet)
    commands.push([
      ...prefix,
      "packet",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--role",
      "validator",
      "--agent",
      validator,
      "--token",
      token,
      "--id",
      `${task.id}-validator-${task.validation!.attempt}`,
    ]);
  commands.push([
    ...prefix,
    "review",
    "--run",
    runRoot,
    "--task",
    task.id,
    "--validator",
    validator,
    "--token",
    token,
    "--review",
    placeholder(`review-json-for:${task.id}`),
  ]);
  return commands;
}
