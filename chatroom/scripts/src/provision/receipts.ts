import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chatroomHomeDir } from "../core/index.ts";
import { ProvisionError, type SupportedHost } from "./detect.ts";
import { verifyCronWiring } from "./cron.ts";

export interface ProvisionReceiptCron {
  readonly mechanism: "schedule" | "settings_hooks" | "notify_hook" | "self_watchdog";
  readonly expression: string | null;
  readonly cadence_seconds: number;
}

export interface ProvisionReceiptDaemon {
  readonly started_at: string;
  readonly pid: number;
}

export interface ProvisionReceipt {
  readonly v: 1;
  readonly host: SupportedHost;
  readonly member: string;
  readonly room: string;
  readonly agent_name: string;
  readonly agent_artifact: string;
  readonly cron: ProvisionReceiptCron;
  readonly daemon: ProvisionReceiptDaemon;
  readonly runtime_command: string;
  readonly created_at: string;
}

export interface VerifyReceiptOptions {
  readonly checkProcessAlive?: (pid: number) => boolean;
  readonly baseDir?: string;
  readonly repoRoot?: string;
  readonly homeDir?: string;
}

export interface VerifyReceiptResult {
  readonly valid: boolean;
  readonly code?: "PROVISION_DRIFT" | "INVALID_RECEIPT";
  readonly reason?: string;
}

function defaultCheckProcessAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getProvisionReceiptPath(
  room: string,
  host: string,
  member: string,
  baseDir?: string,
): string {
  const root = baseDir ?? chatroomHomeDir();
  return join(root, "rooms", room, "provision", `${host}.${member}.json`);
}

export function writeProvisionReceipt(receipt: ProvisionReceipt, baseDir?: string): string {
  const receiptPath = getProvisionReceiptPath(receipt.room, receipt.host, receipt.member, baseDir);
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return receiptPath;
}

function parseReceiptUnknown(parsed: unknown): ProvisionReceipt {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt content is not a JSON object");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.v !== 1) {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt version must be 1");
  }
  if (
    typeof rec.host !== "string" ||
    typeof rec.member !== "string" ||
    typeof rec.room !== "string"
  ) {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt missing required identification fields");
  }
  if (typeof rec.agent_name !== "string" || typeof rec.agent_artifact !== "string") {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt missing agent fields");
  }
  if (!rec.cron || typeof rec.cron !== "object" || Array.isArray(rec.cron)) {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt missing cron object");
  }
  if (!rec.daemon || typeof rec.daemon !== "object" || Array.isArray(rec.daemon)) {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt missing daemon object");
  }
  const cron = rec.cron as Record<string, unknown>;
  const daemon = rec.daemon as Record<string, unknown>;
  if (typeof cron.mechanism !== "string" || typeof cron.cadence_seconds !== "number") {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt cron object malformed");
  }
  if (typeof daemon.started_at !== "string" || typeof daemon.pid !== "number") {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt daemon object malformed");
  }
  if (typeof rec.runtime_command !== "string" || typeof rec.created_at !== "string") {
    throw new ProvisionError("INVALID_RECEIPT", "Receipt runtime or timestamp malformed");
  }
  return {
    v: 1,
    host: rec.host as SupportedHost,
    member: rec.member,
    room: rec.room,
    agent_name: rec.agent_name,
    agent_artifact: rec.agent_artifact,
    cron: {
      mechanism: cron.mechanism as ProvisionReceiptCron["mechanism"],
      expression: typeof cron.expression === "string" ? cron.expression : null,
      cadence_seconds: cron.cadence_seconds,
    },
    daemon: {
      started_at: daemon.started_at,
      pid: daemon.pid,
    },
    runtime_command: rec.runtime_command,
    created_at: rec.created_at,
  };
}

export function readProvisionReceipt(
  room: string,
  host: string,
  member: string,
  baseDir?: string,
): ProvisionReceipt {
  const receiptPath = getProvisionReceiptPath(room, host, member, baseDir);
  if (!existsSync(receiptPath)) {
    throw new ProvisionError("RECEIPT_NOT_FOUND", `Receipt file not found at ${receiptPath}`);
  }
  try {
    const content = readFileSync(receiptPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    return parseReceiptUnknown(parsed);
  } catch (error) {
    if (error instanceof ProvisionError) {
      throw error;
    }
    throw new ProvisionError("INVALID_RECEIPT", `Failed to parse receipt at ${receiptPath}`);
  }
}

export function verifyProvisionReceipt(
  receipt: ProvisionReceipt,
  options: VerifyReceiptOptions = {},
): VerifyReceiptResult {
  if (receipt.v !== 1) {
    return {
      valid: false,
      code: "INVALID_RECEIPT",
      reason: "Receipt version must be 1",
    };
  }

  if (!existsSync(receipt.agent_artifact)) {
    return {
      valid: false,
      code: "PROVISION_DRIFT",
      reason: `Agent artifact does not exist: ${receipt.agent_artifact}`,
    };
  }

  const cronOptions = {
    host: receipt.host,
    room: receipt.room,
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
  };
  const cronResult = {
    mechanism: receipt.cron.mechanism,
    expression: receipt.cron.expression,
    cadence_seconds: receipt.cron.cadence_seconds,
    configPath: null,
  };
  const cronValid = verifyCronWiring(cronResult, cronOptions);
  if (!cronValid) {
    return {
      valid: false,
      code: "PROVISION_DRIFT",
      reason: `Cron registration missing or invalid for mechanism ${receipt.cron.mechanism}`,
    };
  }

  const checkAlive = options.checkProcessAlive ?? defaultCheckProcessAlive;
  if (!checkAlive(receipt.daemon.pid)) {
    return {
      valid: false,
      code: "PROVISION_DRIFT",
      reason: `Daemon process PID ${receipt.daemon.pid} is not alive`,
    };
  }

  return { valid: true };
}
