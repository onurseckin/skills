import { resolve } from "node:path";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { PolicyDiscoveryEngine } from "../../engine/policy-discovery.ts";
import {
  planInitCommand as corePlanInit,
  planEnhanceCommand,
  planAddCommand,
  planCompileCommand,
} from "./plan.ts";
import { planBrainstormCommand } from "./plan-brainstorm.ts";
import { planAuditCommand } from "./plan-audit.ts";
import { planApplyCommand, planClaimCommand } from "./plan-apply.ts";
import { planValidateStartCommand, planReviewCommand } from "./plan-validate.ts";
import { planReplanCommand } from "./plan-replan.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export {
  planEnhanceCommand,
  planAddCommand,
  planCompileCommand,
  planBrainstormCommand,
  planAuditCommand,
  planApplyCommand,
  planClaimCommand,
  planValidateStartCommand,
  planReviewCommand,
  planReplanCommand,
};

export async function planInitCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot(repo);
  } catch {
    repoRoot = resolve(repo);
  }

  // Mandatory One-Time Policy Init Phase: inspect if .olt/policy.json exists; if missing or uncalibrated, calibrate
  PolicyDiscoveryEngine.ensurePolicyCalibrated(repoRoot);

  return corePlanInit(flags, context);
}
