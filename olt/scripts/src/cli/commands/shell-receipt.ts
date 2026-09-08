import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";

export interface ShellReceiptDependencies {
  readonly existsSync: typeof existsSync;
  readonly openSync: typeof openSync;
  readonly writeSync: typeof writeSync;
  readonly fsyncSync: typeof fsyncSync;
  readonly closeSync: typeof closeSync;
  readonly renameSync: typeof renameSync;
  readonly unlinkSync: typeof unlinkSync;
}

const defaultReceiptDependencies: ShellReceiptDependencies = {
  existsSync: (p) => existsSync(p),
  openSync: (p, flags, mode) => openSync(p, flags, mode),
  writeSync: (fd: number, buffer: unknown, ...args: unknown[]) =>
    (writeSync as Function)(fd, buffer, ...args),
  fsyncSync: (fd) => fsyncSync(fd),
  closeSync: (fd) => closeSync(fd),
  renameSync: (oldP, newP) => renameSync(oldP, newP),
  unlinkSync: (p) => unlinkSync(p),
};

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function persistStandaloneReceipt(
  evidenceDir: string,
  receiptPath: string,
  receiptBody: string,
  dependencies: ShellReceiptDependencies = defaultReceiptDependencies,
): void {
  const temporaryReceiptPath = join(evidenceDir, `.shell-receipt-${randomUUID()}.tmp`);
  let receiptFd: number | undefined;
  let evidenceDirFd: number | undefined;
  let renamed = false;

  try {
    receiptFd = dependencies.openSync(temporaryReceiptPath, "wx", 0o600);
    const receiptBytes = Buffer.from(receiptBody, "utf-8");
    let written = 0;
    while (written < receiptBytes.length) {
      const bytesWritten = dependencies.writeSync(
        receiptFd,
        receiptBytes,
        written,
        receiptBytes.length - written,
        written,
      );
      if (bytesWritten <= 0) {
        throw new HarnessError("INTEGRITY", "receipt persistence made no forward write progress");
      }
      written += bytesWritten;
    }
    dependencies.fsyncSync(receiptFd);
    dependencies.closeSync(receiptFd);
    receiptFd = undefined;

    dependencies.renameSync(temporaryReceiptPath, receiptPath);
    renamed = true;

    evidenceDirFd = dependencies.openSync(evidenceDir, "r");
    dependencies.fsyncSync(evidenceDirFd);
    dependencies.closeSync(evidenceDirFd);
    evidenceDirFd = undefined;

    if (!dependencies.existsSync(receiptPath)) {
      throw new HarnessError(
        "INTEGRITY",
        "atomic receipt rename did not produce its final evidence path",
      );
    }
  } catch (error) {
    if (receiptFd !== undefined) {
      try {
        dependencies.closeSync(receiptFd);
      } catch {
        // The original persistence error remains the authoritative failure.
      }
    }
    if (evidenceDirFd !== undefined) {
      try {
        dependencies.closeSync(evidenceDirFd);
      } catch {
        // The original persistence error remains the authoritative failure.
      }
    }

    if (!renamed) {
      let cleanupFailure = "";
      try {
        if (dependencies.existsSync(temporaryReceiptPath)) {
          dependencies.unlinkSync(temporaryReceiptPath);
        }
      } catch (cleanupError) {
        cleanupFailure = `; temporary receipt cleanup failed: ${failureMessage(cleanupError)}`;
      }
      throw new HarnessError(
        "INTEGRITY",
        `receipt persistence failed before atomic rename: ${failureMessage(error)}${cleanupFailure}`,
      );
    }

    throw new HarnessError(
      "INTEGRITY",
      `receipt persistence outcome uncertain after atomic rename: ${failureMessage(error)}`,
    );
  }
}
