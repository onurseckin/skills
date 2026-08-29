import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { boolFlag, listFlag, textFlag, type Flags } from "../../cli/options.ts";
import {
  certifyHarnessDoctor,
  type DoctorCertificationReport,
  type MutationKind,
} from "./adversarial-doctor/index.ts";

const VALID_MUTATION_KINDS: ReadonlySet<string> = new Set([
  "syntax_error",
  "assertion_flip",
  "return_override",
  "empty_file",
  "exception_injection",
]);

function loadStateOrNull(runRoot: string): Record<string, unknown> | null {
  try {
    return loadRun(runRoot).state as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assertCertifiableWriteScope(writeScope: readonly string[]): void {
  const rejected = writeScope.filter(
    (path) => !path.endsWith(".test.ts") && !path.endsWith(".spec.ts"),
  );
  if (rejected.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--write-scope must name a .test.ts or .spec.ts file so the default runner can execute it; got: ${rejected.join(", ")}`,
    );
  }
}

export async function doctorCertifyCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const writeScope = listFlag(flags, "write-scope") ?? [];
  assertCertifiableWriteScope(writeScope);

  const mutationKindRaw = textFlag(flags, "mutation-kind", false);
  if (mutationKindRaw !== undefined && !VALID_MUTATION_KINDS.has(mutationKindRaw)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--mutation-kind must be one of: ${[...VALID_MUTATION_KINDS].join(", ")}`,
    );
  }
  const mutationKind = mutationKindRaw as MutationKind | undefined;

  const repoRoot = findRepoRoot(run);
  const state = loadStateOrNull(run);
  const strict = boolFlag(flags, "strict");

  const report: DoctorCertificationReport = await certifyHarnessDoctor({
    runRoot: run,
    repoRoot,
    state,
    writeScope,
    runAdversarialChecks: writeScope.length > 0,
    ...(mutationKind !== undefined ? { mutationKind } : {}),
  });

  if (strict && !report.certified) {
    throw new HarnessError(
      "INVALID_STATE",
      `harness doctor certification failed: ${report.criticalIssues.length} critical issue(s) across ${report.totalChecks} check(s)`,
    );
  }

  return { ...report };
}
