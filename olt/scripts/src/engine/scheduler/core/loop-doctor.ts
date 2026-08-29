import type { DoctorErrorResolutionAudit } from "./types.ts";
import { isNonblank } from "../../../requirements/predicates.ts";
import { verifyIntegrity } from "../../store/index.ts";
import { boundedEvidenceCause } from "./tasks/tasks.ts";

export function probeDoctorErrorResolution(
  runRoot?: string,
  doctorResult?: Record<string, unknown>,
): DoctorErrorResolutionAudit {
  const details: string[] = [];
  const unresolvedErrors: string[] = [];
  const repairRecommendations: string[] = [];

  if (doctorResult !== undefined) {
    const issues = doctorResult.issues;
    if (doctorResult.healthy !== true || !Array.isArray(issues) || !issues.every(isNonblank)) {
      const msg = "Doctor evidence is unavailable, unhealthy, or malformed.";
      unresolvedErrors.push(msg);
      details.push(msg);
      repairRecommendations.push(
        `Run 'bun harness.ts doctor --run ${runRoot ?? "."}' to obtain a healthy doctor result.`,
      );
    } else {
      for (const issue of issues) {
        unresolvedErrors.push(issue);
        details.push(issue);
        repairRecommendations.push(
          `Run 'bun harness.ts doctor:repair --run ${runRoot ?? "."}' or resolve: ${issue}`,
        );
      }
    }
  } else if (runRoot !== undefined) {
    try {
      const integrity = verifyIntegrity(runRoot);
      for (const err of integrity) {
        const msg = `Integrity error: ${err.code} - ${err.message}`;
        unresolvedErrors.push(msg);
        details.push(msg);
        repairRecommendations.push(`Resolve capsule integrity issue at ${runRoot}: ${err.message}`);
      }
    } catch (error) {
      const msg = `Integrity verification unavailable: ${boundedEvidenceCause(error)}`;
      unresolvedErrors.push(msg);
      details.push(msg);
      repairRecommendations.push(`Repair or restore capsule integrity evidence at ${runRoot}.`);
    }
  }

  const passed = unresolvedErrors.length === 0;
  if (passed) {
    details.push("Doctor check passed with 0 unresolved errors.");
  }

  return {
    passed,
    totalIssues: unresolvedErrors.length,
    unresolvedErrors,
    repairRecommendations,
    details,
  };
}
