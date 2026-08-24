import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

export interface CommandReceiptOptions {
  readonly taskId: string;
  readonly actor: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
}

export class AutoReceiptLogger {
  public static recordReceipt(capsuleRoot: string, opts: CommandReceiptOptions): void {
    const stdoutHash = createHash("sha256").update(opts.stdout).digest("hex");
    const receiptEvent = {
      type: "command-executed",
      timestamp: new Date().toISOString(),
      task_id: opts.taskId,
      actor: opts.actor,
      command: opts.command,
      argv: opts.argv,
      exit_code: opts.exitCode,
      stdout_hash: stdoutHash,
    };

    appendFileSync(`${capsuleRoot}/events.jsonl`, JSON.stringify(receiptEvent) + "\n");
  }
}
