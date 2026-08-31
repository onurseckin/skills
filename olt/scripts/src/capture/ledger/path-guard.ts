import { normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";

export function assertSafeLedgerPath(targetPath: string): void {
  const normalized = normalize(resolve(targetPath));
  const cwd = normalize(process.cwd());
  const sysTmp = normalize(tmpdir());

  const dotTmp = normalize(resolve(cwd, ".tmp"));
  const oltCapsules = normalize(resolve(cwd, ".olt/capsules"));
  const oltScratch = normalize(resolve(cwd, ".olt/scratch"));

  const isUnderDotTmp = normalized.startsWith(dotTmp);
  const isUnderOltCapsules = normalized.startsWith(oltCapsules);
  const isUnderOltScratch = normalized.startsWith(oltScratch);
  const isUnderSysTmp = normalized.startsWith(sysTmp);

  if (!isUnderDotTmp && !isUnderOltCapsules && !isUnderOltScratch && !isUnderSysTmp) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Event ledger path safety violation: '${targetPath}' is outside allowed storage roots (.tmp/, .olt/capsules/, .olt/scratch/, tmpdir)`,
    );
  }
}

export function resolveDefaultLedgerPath(options?: {
  readonly runId?: string | undefined;
  readonly capsuleDir?: string | undefined;
}): string {
  if (options?.capsuleDir && options.capsuleDir.trim().length > 0) {
    return resolve(options.capsuleDir.trim(), "ledger", "capture-events.jsonl");
  }
  if (options?.runId && options.runId.trim().length > 0) {
    return resolve(resolveCapsulesDir(), options.runId.trim(), "ledger", "capture-events.jsonl");
  }
  return resolve(process.cwd(), ".tmp", "capture-ledger", "capture-events.jsonl");
}
