import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { atomicWriteBytes } from "../core/durable-write.ts";
import type {
  DefectPromotionJournal,
  DefectPromotionPersistenceStage,
  StrictDefectLedgerEntry,
} from "./types.ts";
import {
  assertRegularDefectLog,
  replaceDefectLogFileUnlocked,
  requiredNoFollowFlag,
} from "./lock.ts";
import {
  hashLedger,
  readStrictLedgerUnlocked,
  serializedRawEntries,
  strictLedgerIntegrity,
  withDefectLedgerTransaction,
} from "./transaction.ts";

let defectPromotionPersistenceHook: ((stage: DefectPromotionPersistenceStage) => void) | undefined;

/** @internal deterministic crash seam for transaction recovery tests. */
export function __setDefectPromotionPersistenceTestHook(
  hook: ((stage: DefectPromotionPersistenceStage) => void) | undefined,
): void {
  defectPromotionPersistenceHook = hook;
}

export function observeDefectPromotionStage(stage: DefectPromotionPersistenceStage): void {
  defectPromotionPersistenceHook?.(stage);
}

export function promotionJournalPath(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.defect-promotion.journal.json`);
}

export function writePromotionJournal(path: string, journal: DefectPromotionJournal): void {
  atomicWriteBytes(path, new TextEncoder().encode(`${JSON.stringify(journal)}\n`), { mode: 0o600 });
}

export function readPromotionJournal(path: string): DefectPromotionJournal | undefined {
  if (!existsSync(path)) return undefined;
  assertRegularDefectLog(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw strictLedgerIntegrity(`defect promotion journal is malformed: ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).version !== 1 ||
    ((parsed as Record<string, unknown>).state !== "PREPARED" &&
      (parsed as Record<string, unknown>).state !== "COMMITTED") ||
    !Array.isArray((parsed as Record<string, unknown>).ids)
  ) {
    throw strictLedgerIntegrity(`defect promotion journal is invalid: ${path}`);
  }
  return parsed as DefectPromotionJournal;
}

export function verifyPromotionJournal(
  journal: DefectPromotionJournal,
  source: readonly StrictDefectLedgerEntry[],
  target: readonly StrictDefectLedgerEntry[],
): void {
  if (
    !/^[a-f0-9]{64}$/.test(journal.sourceHash) ||
    !/^[a-f0-9]{64}$/.test(journal.targetHash) ||
    journal.ids.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(journal.ids).size !== journal.ids.length
  ) {
    throw strictLedgerIntegrity("defect promotion journal hashes or ids are invalid");
  }
  const sourceIds = new Set(source.map((entry) => entry.id));
  const targetIds = new Set(target.map((entry) => entry.id));
  const targetContainsAll = journal.ids.every((id) => targetIds.has(id));
  const sourceContainsAll = journal.ids.every((id) => sourceIds.has(id));
  if (!targetContainsAll && !sourceContainsAll) {
    throw strictLedgerIntegrity("defect promotion journal records are missing from both ledgers");
  }
}

/** Deterministically finishes an interrupted promotion without duplicating IDs. */
export function recoverDefectPromotion(sourcePath: string, targetPath: string): void {
  const journalPath = promotionJournalPath(targetPath);
  withDefectLedgerTransaction([sourcePath, targetPath, journalPath], () => {
    const journal = readPromotionJournal(journalPath);
    if (!journal) return;
    if (
      resolve(journal.sourcePath) !== resolve(sourcePath) ||
      resolve(journal.targetPath) !== resolve(targetPath)
    ) {
      throw strictLedgerIntegrity(`defect promotion journal targets do not match: ${journalPath}`);
    }
    const ids = new Set(journal.ids);
    const source = readStrictLedgerUnlocked(sourcePath);
    const target = readStrictLedgerUnlocked(targetPath);
    verifyPromotionJournal(journal, source, target);
    const targetIds = new Set(target.map((entry) => entry.id));
    if ([...ids].some((id) => !targetIds.has(id))) {
      if (journal.state === "COMMITTED") {
        throw strictLedgerIntegrity(
          `committed promotion journal is missing target records: ${journalPath}`,
        );
      }
      unlinkSync(journalPath);
      return;
    }
    const remaining = source.filter((entry) => !ids.has(entry.id));
    replaceDefectLogFileUnlocked(sourcePath, serializedRawEntries(remaining));
    if (journal.state === "PREPARED") {
      writePromotionJournal(journalPath, { ...journal, state: "COMMITTED" });
    }
    unlinkSync(journalPath);
    const directoryDescriptor = openSync(
      dirname(targetPath),
      constants.O_RDONLY | constants.O_DIRECTORY | requiredNoFollowFlag(),
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  });
}

export function promoteDefectLedgerRecords(
  sourcePath: string,
  targetPath: string,
  ids: readonly string[],
): void {
  if (resolve(sourcePath) === resolve(targetPath)) {
    throw strictLedgerIntegrity("active and completed defect ledgers must be distinct");
  }
  const selected = [...new Set(ids)];
  if (selected.length === 0) return;
  const journalPath = promotionJournalPath(targetPath);
  if (existsSync(journalPath)) recoverDefectPromotion(sourcePath, targetPath);
  withDefectLedgerTransaction([sourcePath, targetPath, journalPath], () => {
    if (readPromotionJournal(journalPath)) {
      throw strictLedgerIntegrity(
        `defect promotion journal appeared during mutation: ${journalPath}`,
      );
    }
    const source = readStrictLedgerUnlocked(sourcePath);
    const target = readStrictLedgerUnlocked(targetPath);
    const sourceById = new Map(source.map((entry) => [entry.id, entry]));
    const missing = selected.find((id) => !sourceById.has(id));
    if (missing !== undefined) {
      throw strictLedgerIntegrity(`active defect '${missing}' is absent`);
    }
    const targetById = new Map(target.map((entry) => [entry.id, entry]));
    const additions = selected.map((id) => sourceById.get(id)!);
    const merged = [...target, ...additions.filter((entry) => !targetById.has(entry.id))];
    const journal: DefectPromotionJournal = {
      version: 1,
      state: "PREPARED",
      sourcePath: resolve(sourcePath),
      targetPath: resolve(targetPath),
      ids: selected,
      sourceHash: hashLedger(serializedRawEntries(source)),
      targetHash: hashLedger(serializedRawEntries(merged)),
    };
    writePromotionJournal(journalPath, journal);
    observeDefectPromotionStage("PREPARED");
    replaceDefectLogFileUnlocked(targetPath, serializedRawEntries(merged));
    observeDefectPromotionStage("TARGET_DURABLE");
    replaceDefectLogFileUnlocked(
      sourcePath,
      serializedRawEntries(source.filter((entry) => !selected.includes(entry.id))),
    );
    observeDefectPromotionStage("SOURCE_DURABLE");
    writePromotionJournal(journalPath, { ...journal, state: "COMMITTED" });
    observeDefectPromotionStage("COMMITTED");
    unlinkSync(journalPath);
  });
}
