export class CommandExecutionError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(code: string, message: string, exitCode = 70) {
    super(message);
    this.name = "CommandExecutionError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export { ackCommand } from "./ack.ts";
export { daemonCommand } from "./daemon.ts";
export { doctorCommand } from "./doctor.ts";
export { readCommand } from "./read.ts";
export { sayCommand } from "./say.ts";
export { watchCommand } from "./watch.ts";
export { initCommand, inviteCommand, joinCommand, roomsCommand } from "./lifecycle/index.ts";
export { inspectCommand } from "./inspect.ts";
export { onCommand } from "./on.ts";
export { offCommand } from "./off.ts";
