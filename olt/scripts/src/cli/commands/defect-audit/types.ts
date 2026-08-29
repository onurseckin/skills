import type { GeneratedRegressionTest } from "../../../mind/defects/index.ts";

export type DefectStatus = "open" | "admitted" | "resolved" | "declined" | "ignored";

export interface RGBColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ApcaBadgeInfo {
  readonly label: string;
  readonly badge_text: string;
  readonly fg_color: string;
  readonly bg_color: string;
  readonly lc: number;
  readonly required_lc: number;
  readonly passes_apca: boolean;
}

export interface ApcaContrastCompliance {
  readonly compliant_badges: number;
  readonly total_badges: number;
  readonly min_lc_observed: number;
  readonly passes_apca: boolean;
  readonly badge_details: readonly ApcaBadgeInfo[];
}

export interface AuditedDefect {
  readonly id: string;
  readonly type: string;
  readonly severity: "critical" | "warning" | string;
  readonly timestamp: string;
  readonly pid: number;
  readonly ppid: number;
  readonly agent_id: string | null;
  readonly observation: string;
  readonly remediation: string;
  readonly context: {
    readonly cwd?: string | undefined;
    readonly indicators?: Readonly<Record<string, string>> | undefined;
    readonly [key: string]: unknown;
  };
  readonly status: DefectStatus;
  readonly source_capsule: string;
  readonly source_file: string;
  readonly candidate_id?: string | null | undefined;
  readonly resolution?: Record<string, unknown> | null | undefined;
}

export interface DefectAuditSummary {
  readonly total_defects: number;
  readonly open_count: number;
  readonly admitted_count: number;
  readonly resolved_count: number;
  readonly declined_count: number;
  readonly critical_count: number;
  readonly warning_count: number;
  readonly by_category: Readonly<Record<string, number>>;
  readonly by_capsule: Readonly<Record<string, number>>;
  readonly apca_contrast_compliance: ApcaContrastCompliance;
}

export interface DefectAuditCommandResult {
  readonly markdown: string;
  readonly capsules_dir: string;
  readonly run_root: string | null;
  readonly total_defects: number;
  readonly filtered_defects: readonly AuditedDefect[];
  readonly summary: DefectAuditSummary;
  readonly auto_admitted_count: number;
  readonly auto_admitted_candidates: readonly string[];
  readonly promoted_count?: number | undefined;
  readonly promoted_defects?: readonly string[] | undefined;
  readonly generated_tests?: readonly GeneratedRegressionTest[] | undefined;
  readonly generated_test_suite?: string | undefined;
  readonly [key: string]: unknown;
}

export interface DefectFileDiscovery {
  readonly capsuleName: string;
  readonly filePath: string;
}
