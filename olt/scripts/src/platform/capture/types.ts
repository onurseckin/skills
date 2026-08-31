import type {
  CaptureAuthConfig,
  CaptureCookie,
  CaptureUserConfig,
  CaptureViewport,
} from "../../capture/index.ts";
import type {
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaConfig,
  UserPersonaRole,
} from "../../policy/types/index.ts";

export type ResponsiveViewportTier = "desktop-wide" | "desktop" | "tablet" | "mobile";

export interface ResponsiveViewportSpec {
  readonly name: string;
  readonly tier: ResponsiveViewportTier;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly aspectRatio: string;
  readonly description: string;
  readonly minTouchTargetPx: number;
  readonly minApcaContrast: number;
}

export interface PersonaGovernanceRecord {
  readonly role: UserPersonaRole;
  readonly email: string;
  readonly passwordEnvVar: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  readonly mockSessionCookie?: string | undefined;
}

export interface PersonaGovernanceSyncResult {
  readonly synchronized: boolean;
  readonly syncedPersonas: readonly PersonaGovernanceRecord[];
  readonly driftDetected: boolean;
  readonly diffs: readonly string[];
}

export interface ViewportGovernanceSyncResult {
  readonly valid: boolean;
  readonly viewports: readonly ResponsiveViewportSpec[];
  readonly coveredTiers: readonly ResponsiveViewportTier[];
  readonly missingTiers: readonly ResponsiveViewportTier[];
}

export interface CaptureGovernanceReport {
  readonly compliant: boolean;
  readonly viewportStatus: ViewportGovernanceSyncResult;
  readonly personaStatus: PersonaGovernanceSyncResult;
  readonly violations: readonly string[];
  readonly timestamp: string;
}

export interface GovernanceSyncOptions {
  readonly repoRoot?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly config?: {
    readonly viewports?: Readonly<Record<string, CaptureViewport>> | undefined;
    readonly auth?: CaptureAuthConfig | undefined;
  } | undefined;
}

export type {
  CaptureAuthConfig,
  CaptureCookie,
  CaptureUserConfig,
  CaptureViewport,
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaConfig,
  UserPersonaRole,
};
