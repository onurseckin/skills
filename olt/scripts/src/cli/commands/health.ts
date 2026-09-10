import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { boolFlag, listFlag, textFlag, type Flags } from "../index.ts";

function existingDirectory(flags: Flags, name: string): string | undefined {
  const value = textFlag(flags, name, false);
  if (value === undefined) return undefined;
  const path = resolve(value);
  if (existsSync(path) === false) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} does not exist: ${path}`);
  }
  return path;
}

export async function healthCommand(flags: Flags): Promise<Record<string, unknown>> {
  const { ALL_CHECKS, defaultLayout, runHealthCheck } = await import("../../health/index.ts");
  const { renderHealthReport } = await import("../../health/report.ts");
  type HealthCheckId = (typeof ALL_CHECKS)[number];
  const isCheckId = (name: string): name is HealthCheckId =>
    (ALL_CHECKS as readonly string[]).includes(name);

  const scripts = existingDirectory(flags, "scripts");
  const consumer = existingDirectory(flags, "consumer");
  const base = defaultLayout(scripts);
  if (existsSync(resolve(base.scriptsRoot, "src")) === false) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `no src directory under ${base.scriptsRoot}; --scripts must name a harness scripts root`,
    );
  }
  const layout = consumer === undefined ? base : { ...base, consumerRoot: consumer };
  const requested = listFlag(flags, "check");
  let checksToRun: readonly HealthCheckId[] = ALL_CHECKS;
  if (requested !== undefined) {
    const unknown = requested.filter((name) => isCheckId(name) === false);
    if (unknown.length > 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `unknown --check: ${unknown.join(", ")}; known checks are ${ALL_CHECKS.join(", ")}`,
      );
    }
    checksToRun = requested.filter(isCheckId);
  }
  const report = runHealthCheck(layout, checksToRun);
  const isStrict = boolFlag(flags, "strict");
  if (isStrict && report.healthy === false) {
    throw new HarnessError(
      "INVALID_STATE",
      `semantic health check failed: ${report.failure_count} failure(s)`,
    );
  }
  return {
    ...report,
    run_root: layout.repoRoot,
    markdown: renderHealthReport(report, layout.repoRoot, boolFlag(flags, "all")),
  };
}
