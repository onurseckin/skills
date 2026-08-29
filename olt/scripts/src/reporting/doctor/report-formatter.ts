import { classifyIssueSeverity } from "./facts.ts";
import {
  formatBehavioralRoleHealthSection,
  type BehavioralFinding,
} from "../behavioral-auditor/index.ts";
import type { TierConfinementFinding } from "./tier-confinement/index.ts";
import { formatSocraticAuditSection, type SocraticAuditReport } from "../socratic-validator.ts";
import type { LifecycleFinding } from "./state-machine-auditor.ts";

export interface DoctorReportFormatParams {
  runRoot: string;
  healthy: boolean;
  bunVersion: string;
  bunSupported: boolean;
  gitignored: boolean | null;
  issues: readonly string[];
  errors?: readonly string[] | undefined;
  warnings?: readonly string[] | undefined;
  infos?: readonly string[] | undefined;
  autoHealed?: readonly string[] | undefined;
  behavioralFindings?: readonly BehavioralFinding[] | readonly TierConfinementFinding[] | undefined;
  tierConfinementFindings?: readonly TierConfinementFinding[] | undefined;
  socraticReport?: SocraticAuditReport | undefined;
  lifecycleFindings?: readonly LifecycleFinding[] | undefined;
  remedialGuidance?: readonly string[] | undefined;
}

export function formatDoctorReport(params: DoctorReportFormatParams): string {
  const issues = params.issues;
  const findings = (params.tierConfinementFindings ??
    params.behavioralFindings ??
    []) as unknown as readonly BehavioralFinding[];

  const errors = params.errors ?? issues.filter((i) => classifyIssueSeverity(i) === "critical");
  const warnings = params.warnings ?? [];
  const infos = [
    ...(params.autoHealed ?? []).map((h) => `Auto-Healed: ${h}`),
    ...(params.infos ?? issues.filter((i) => classifyIssueSeverity(i) === "cosmetic")),
  ];

  const lines = [
    `### Capsule Doctor: \`${params.runRoot}\``,
    `- **Healthy**: ${params.healthy ? "yes" : "no"}`,
    `- **Bun**: ${params.bunVersion} (${params.bunSupported ? "supported" : "unsupported"})`,
    `- **Gitignored**: ${
      params.gitignored === true ? "yes" : params.gitignored === false ? "no" : "unknown"
    }`,
    ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
    ...issues.map((issue) => `  - ${issue}`),
    "",
    "### Doctor Findings:",
    `- **[ERROR]**:`,
    ...(errors.length > 0 ? errors.map((e) => `  - ${e}`) : ["  - none"]),
    `- **[WARN]**:`,
    ...(warnings.length > 0 ? warnings.map((w) => `  - ${w}`) : ["  - none"]),
    `- **[INFO]**:`,
    ...(infos.length > 0 ? infos.map((i) => `  - ${i}`) : ["  - none"]),
    "",
    formatBehavioralRoleHealthSection(findings),
    "",
    ...(params.socraticReport ? [formatSocraticAuditSection(params.socraticReport)] : []),
    ...(params.remedialGuidance && params.remedialGuidance.length > 0
      ? [
          "",
          "### Pre-Completion Remedial Guidance:",
          ...params.remedialGuidance.map((g) => `  - ${g}`),
        ]
      : []),
  ];
  return lines.join("\n");
}
