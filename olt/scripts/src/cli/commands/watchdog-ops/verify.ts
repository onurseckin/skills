import { loadWatchdogStore, verifyWatchdogLifecycle } from "../../../authority/watchdog/index.ts";
import { enforceLineLimit } from "../../formatters/index.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../../index.ts";

export function watchdogVerifyCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "run",
    "capsules-dir",
    "generation",
    "pulse-id",
    "phase",
    "all",
    "now",
    "json",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);
  const genVal = integerFlag(flags, "generation");

  const target = run ?? capsulesDir;
  const res = verifyWatchdogLifecycle(nowRaw !== undefined ? { now: nowRaw } : undefined, target);

  let filteredViolations = res.violations;
  if (genVal !== undefined) {
    const store = loadWatchdogStore(target);
    const genWatchdogs = new Set(
      store.watchdogs.filter((w) => w.generation === genVal).map((w) => w.id),
    );
    filteredViolations = res.violationDetails
      .filter((v) => !v.watchdog_id || genWatchdogs.has(v.watchdog_id))
      .map((v) => v.message);
  }

  const isValid = filteredViolations.length === 0;

  const lines: string[] = [
    `### Watchdog Lifecycle Verification: ${isValid ? "PASSED ✅" : "FAILED ❌"}`,
    `- **Target Root**: \`${target !== undefined ? target : "default"}\``,
    `- **Active Monitors**: ${res.activeCount}`,
    `- **Total Records**: ${res.totalCount}`,
    `- **Violations Count**: ${filteredViolations.length}`,
  ];

  if (filteredViolations.length > 0) {
    lines.push("");
    lines.push("#### Invariant Violations:");
    for (const v of filteredViolations) {
      lines.push(`- ⚠️ ${v}`);
    }
  }

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    valid: isValid,
    violations: filteredViolations,
    violation_details: res.violationDetails,
    active_count: res.activeCount,
    total_count: res.totalCount,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}
