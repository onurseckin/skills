export type AgentTier = 0 | 1 | 2 | 3 | "independent";

export type AgentTierCategory = "governance" | "orchestration" | "execution" | "quality";

export interface ToolBoundaryDefinition {
  readonly canWriteCode: boolean;
  readonly canExecuteCommands: boolean;
  readonly canSpawnSubagents: boolean;
  readonly canClaimLeases: boolean;
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
}

export interface CertifiedDeliverable {
  readonly type: string;
  readonly description: string;
  readonly evidenceRequired: boolean;
}

export interface AgentOperationalContract {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly tier: AgentTier;
  readonly category: AgentTierCategory;
  readonly aliases: readonly string[];
  readonly toolBoundaries: ToolBoundaryDefinition;
  readonly permissions: {
    readonly may: readonly string[];
    readonly mustNot: readonly string[];
    readonly allowedCommands: readonly string[];
    readonly forbiddenCommands: readonly string[];
    readonly allowedSpawns: readonly string[];
  };
  readonly invariants: readonly string[];
  readonly certifiedDeliverables: readonly CertifiedDeliverable[];
  readonly isHeadfulReviewer?: boolean;
  readonly isHeadlessDebugger?: boolean;
  readonly isSourceCodeBlind?: boolean;
  readonly manifestPath?: string;
}

export const OPTICAL_DIMENSIONS_8 = [
  "visual_hierarchy",
  "optical_spacing_rhythm",
  "typography_font_rendering",
  "clipping_overflow",
  "apca_contrast",
  "theme_harmony",
  "z_index_overlays",
  "touch_target_bounds_44px",
] as const;

export type OpticalDimension = (typeof OPTICAL_DIMENSIONS_8)[number];

export const MANDATORY_VIEWPORTS_4 = [
  { name: "desktop_wide", width: 1920, height: 1080, label: "Desktop-Wide (1920x1080)" },
  { name: "desktop", width: 1440, height: 900, label: "Desktop (1440x900)" },
  { name: "tablet", width: 768, height: 1024, label: "Tablet (768x1024)" },
  { name: "mobile", width: 390, height: 844, label: "Mobile (390x844)" },
] as const;

export const SYNTHETIC_STATES_4 = ["empty", "error", "loading", "extreme_overflow"] as const;

export type SyntheticState = (typeof SYNTHETIC_STATES_4)[number];
