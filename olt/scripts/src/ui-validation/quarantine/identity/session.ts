import type { PersonaDefinition } from "../parameters/index.ts";
import type {
  SessionDegradationInspectionParams,
  SessionDegradationResult,
  ReauthExecutionPlan,
  PersonaSessionContext,
} from "./types.ts";

export function detectSessionDegradation(
  this: any,

  params: SessionDegradationInspectionParams,
): SessionDegradationResult {
  const {
    currentUrl,
    statusCode,
    pageTitle,
    domSnippet,
    activePersona,
    token,
    loginPathPatterns = [
      "/login",
      "/auth",
      "/signin",
      "/session-expired",
      "?error=session_expired",
    ],
  } = params;

  // 1. Status Code 401
  if (statusCode === 401) {
    return {
      degraded: true,
      cause: "STATUS_401",
      confidence: 1.0,
      targetPersona: activePersona.role,
      detectedAtUrl: currentUrl,
      recommendedAction: "RE_AUTHENTICATE",
      reason: "HTTP 401 Unauthorized encountered during navigation or API call.",
    };
  }

  // 2. Status Code 403
  if (statusCode === 403) {
    return {
      degraded: true,
      cause: "STATUS_403",
      confidence: 0.95,
      targetPersona: activePersona.role,
      detectedAtUrl: currentUrl,
      recommendedAction: "SWITCH_PERSONA",
      reason:
        "HTTP 403 Forbidden encountered: persona lacks required permissions or session revoked.",
    };
  }

  // 3. Status Code 419 (Laravel / session expired)
  if (statusCode === 419) {
    return {
      degraded: true,
      cause: "STATUS_419",
      confidence: 1.0,
      targetPersona: activePersona.role,
      detectedAtUrl: currentUrl,
      recommendedAction: "RE_AUTHENTICATE",
      reason: "HTTP 419 Page / Session Expired encountered.",
    };
  }

  // 4. Redirect to login page
  const lowerUrl = currentUrl.toLowerCase();
  for (const pattern of loginPathPatterns) {
    if (lowerUrl.includes(pattern.toLowerCase())) {
      return {
        degraded: true,
        cause: "REDIRECT_TO_LOGIN",
        confidence: 0.9,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "RE_AUTHENTICATE",
        reason: `Navigation was redirected to login path matching pattern '${pattern}'.`,
      };
    }
  }

  // 5. Visual/DOM unauthorized banners or messages
  if (domSnippet || pageTitle) {
    const combined = `${pageTitle ?? ""} ${domSnippet ?? ""}`.toLowerCase();
    const unauthorizedClues = [
      "session expired",
      "please log in",
      "please sign in",
      "you have been logged out",
      "token expired",
      "authentication required",
      "unauthorized access",
      "access denied: session invalid",
    ];

    for (const clue of unauthorizedClues) {
      if (combined.includes(clue)) {
        return {
          degraded: true,
          cause: "VISUAL_UNAUTHORIZED_BANNER",
          confidence: 0.85,
          targetPersona: activePersona.role,
          detectedAtUrl: currentUrl,
          recommendedAction: "RE_AUTHENTICATE",
          reason: `DOM / Title contains explicit session degradation cue: "${clue}".`,
        };
      }
    }
  }

  // 6. Expired JWT check
  if (token && this.isTokenExpired(token)) {
    return {
      degraded: true,
      cause: "EXPIRED_JWT",
      confidence: 1.0,
      targetPersona: activePersona.role,
      detectedAtUrl: currentUrl,
      recommendedAction: "REFRESH_TOKEN",
      reason: "Session JWT token has passed its expiration timestamp (exp).",
    };
  }

  // No degradation detected
  return {
    degraded: false,
    cause: "NONE",
    confidence: 0.0,
    targetPersona: activePersona.role,
    detectedAtUrl: currentUrl,
    recommendedAction: "IGNORE",
    reason: "Session is active and intact.",
  };
}

/**
 * Execute graceful autonomous re-authentication protocol
 */
export function executeAutonomousReauthentication(
  this: any,

  degradation: SessionDegradationResult,
  persona: PersonaDefinition,
  options?: {
    readonly baseUrl?: string | undefined;
    readonly resumeUrl?: string | undefined;
  },
): ReauthExecutionPlan {
  const baseUrl = options?.baseUrl ?? "http://localhost:3000";
  const resumeUrl = options?.resumeUrl ?? degradation.detectedAtUrl;

  const freshContext = this.createPersonaSessionContext(persona, { baseUrl });

  const injectionSteps: string[] = [
    `1. Generate fresh JWT auth token for persona '${persona.role}' (${persona.email})`,
    `2. Prepare ${freshContext.cookies.length} session cookies and storage state for domain '${new URL(baseUrl).hostname}'`,
    `3. Inject fresh browser cookies and localStorage into active browser context`,
    `4. Verify session integrity against '${baseUrl}/api/auth/me'`,
    `5. Seamlessly resume optical validation navigation to target route '${resumeUrl}'`,
  ];

  return {
    persona,
    freshContext,
    resumeUrl,
    injectionSteps,
    success: true,
    diagnostics: `Autonomous re-authentication completed for persona '${persona.role}'. Cause: ${degradation.cause}. Resume: ${resumeUrl}`,
  };
}

/**
 * Multi-role permission boundary simulator (cross-persona audit)
 */
