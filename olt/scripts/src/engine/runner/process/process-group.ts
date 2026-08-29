import { HarnessError } from "../../../core/errors/index";
import { readProcessIdentity } from "./process-identity";

type Kill = (pid: number, signal: NodeJS.Signals) => boolean;

export interface ProcessGroupIdentity {
  pid: number;
  group: number;
  birth: string;
}

interface ProcessGroupDependencies {
  inspect?: (pid: number) => ProcessGroupIdentity | undefined;
  kill?: Kill;
  wait?: (milliseconds: number) => Promise<unknown>;
  onSignal?: (signal: NodeJS.Signals) => void;
  signalsSent?: readonly NodeJS.Signals[];
}

function inspectProcessGroup(pid: number): ProcessGroupIdentity | undefined {
  return readProcessIdentity(pid);
}

export function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  kill: Kill = process.kill,
): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new HarnessError("INVALID_STATE", `unsafe process group identifier: ${pid}`);
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM")
      throw new HarnessError(
        "INVALID_STATE",
        `permission refused while signaling process group ${pid}`,
      );
    throw error;
  }
}

export async function terminateProcessGroup(
  pid: number,
  graceMs: number,
  exited: Promise<number>,
  expected: ProcessGroupIdentity | undefined,
  dependencies: ProcessGroupDependencies = {},
): Promise<NodeJS.Signals[]> {
  const inspect = dependencies.inspect ?? inspectProcessGroup;
  const wait =
    dependencies.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const kill = dependencies.kill ?? process.kill;
  const signal = (name: NodeJS.Signals): boolean => {
    const current = inspect(pid);
    if (
      !expected ||
      !current ||
      !Number.isSafeInteger(expected.pid) ||
      expected.pid <= 1 ||
      !Number.isSafeInteger(expected.group) ||
      expected.group <= 1 ||
      current.pid !== expected.pid ||
      current.birth !== expected.birth ||
      current.group !== expected.group ||
      current.pid !== current.group
    )
      return false;
    const delivered = signalProcessGroup(pid, name, kill);
    if (delivered) dependencies.onSignal?.(name);
    return delivered;
  };
  const signals: NodeJS.Signals[] = [];
  const previouslySent = new Set(dependencies.signalsSent ?? []);
  if (!previouslySent.has("SIGTERM") && !signal("SIGTERM")) {
    await Promise.race([exited.catch(() => undefined), wait(graceMs)]);
    return signals;
  }
  if (!previouslySent.has("SIGTERM")) signals.push("SIGTERM");
  await Promise.race([exited.catch(() => undefined), wait(graceMs)]);
  if (!previouslySent.has("SIGKILL") && signal("SIGKILL")) {
    signals.push("SIGKILL");
  }
  await Promise.race([exited.catch(() => undefined), wait(graceMs)]);
  return signals;
}
