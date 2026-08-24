import { createHash } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import { transact } from "../store/index.ts";

export interface CommandReceiptOptions {
  readonly taskId: string;
  readonly actor: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly updateState?: boolean;
}

export class AutoReceiptLogger {
  public static recordReceipt(capsuleRoot: string, opts: CommandReceiptOptions): void {
    const stdoutHash = createHash("sha256").update(opts.stdout).digest("hex");
    const payload: JsonObject = {
      task_id: opts.taskId,
      actor: opts.actor,
      command: opts.command,
      argv: [...opts.argv],
      exit_code: opts.exitCode,
      stdout_hash: stdoutHash,
    };

    let hasCapsuleLedger = false;
    if (opts.updateState === true) {
      hasCapsuleLedger = true;
    } else if (
      existsSync(join(capsuleRoot, "manifest.json")) &&
      existsSync(join(capsuleRoot, "state.json"))
    ) {
      hasCapsuleLedger = true;
    }

    if (hasCapsuleLedger) {
      try {
        transact(capsuleRoot, opts.actor, "command-executed", payload, (draft) => {
          let receipts: JsonObject = {};
          if (isJsonObject(draft.receipts)) {
            receipts = { ...draft.receipts };
          }
          const receiptKey = `${opts.taskId}:${Date.now()}`;
          receipts[receiptKey] = {
            ...payload,
            timestamp: new Date().toISOString(),
          };
          draft.receipts = receipts;
        });
        return;
      } catch {
        // Fall back to direct event append if transaction fails
      }
    }

    const receiptEvent = {
      type: "command-executed",
      timestamp: new Date().toISOString(),
      ...payload,
    };

    appendFileSync(join(capsuleRoot, "events.jsonl"), JSON.stringify(receiptEvent) + "\n");
  }
}
