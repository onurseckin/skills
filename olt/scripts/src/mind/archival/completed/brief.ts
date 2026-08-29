import { existsSync } from "node:fs";
import type { CompletedTaskRecord } from "./types.ts";
import { resolveCompletedTasksLedgerPath, withLedgerTransaction } from "./types.ts";
import { readCompletedTasksLedger, writeCompletedTasksLedgerUnlocked } from "./ledger.ts";

export function migrateCompletedTasksLedger(options: { sourcePath: string; targetPath?: string }): {
  migrated: boolean;
  count: number;
} {
  const target = resolveCompletedTasksLedgerPath(options.targetPath);
  if (!existsSync(options.sourcePath) || options.sourcePath === target) {
    return { migrated: false, count: 0 };
  }
  const records = readCompletedTasksLedger(options.sourcePath);
  if (records.length === 0) {
    return { migrated: false, count: 0 };
  }
  return withLedgerTransaction(target, () => {
    const existing = readCompletedTasksLedger(target);
    const map = new Map<string, CompletedTaskRecord>();
    for (const r of existing) map.set(r.id, r);
    for (const r of records) map.set(r.id, r);
    writeCompletedTasksLedgerUnlocked(Array.from(map.values()), target);
    return { migrated: true, count: records.length };
  });
}
