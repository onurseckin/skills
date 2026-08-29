import { HarnessError } from "../../core/errors/index.ts";
import { getAllCognitivePillars, getPillarAuditQuestions } from "../pillars.ts";
import { DEFAULT_HEARTBEAT_CADENCE_MS } from "../watchdog-manager.ts";
import { SUPERVISORY_ROLE_BOUNDARIES } from "./constants.ts";
import { evaluateReflexiveSelfAudit } from "./evaluator.ts";
import { normalizeSupervisoryRole, parseNowMs } from "./profiles.ts";
import type {
  ReflexiveAuditContext,
  ReflexiveAuditEvaluation,
  SupervisoryRole,
  WatchdogAuditPromptOptions,
  WatchdogGroundingInjection,
  WatchdogPersonaGroundingOptions,
} from "./types.ts";
import { clearManifestCache } from "../manifest-parser.ts";

export function generateWatchdogPersonaGrounding(
  options: WatchdogPersonaGroundingOptions,
): WatchdogGroundingInjection {
  const supervisoryRole = normalizeSupervisoryRole(options.role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot generate persona grounding for non-supervisory role '${options.role}'`,
    );
  }

  const roleBoundaries = SUPERVISORY_ROLE_BOUNDARIES[supervisoryRole];
  const cadenceMs = options.cadenceMs ?? DEFAULT_HEARTBEAT_CADENCE_MS;
  const nowMs = parseNowMs(options.now);
  const startedAtMs = options.startedAt !== undefined ? parseNowMs(options.startedAt) : nowMs;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  let tickNumber = options.tickNumber;
  if (tickNumber === undefined) {
    tickNumber = Math.max(1, Math.floor(elapsedMs / cadenceMs) + 1);
  }

  const timestamp = new Date(nowMs).toISOString();
  const id = `grounding-${supervisoryRole}-tick${tickNumber}-${nowMs.toString(36)}`;
  const pillars = getAllCognitivePillars();
  const reflexiveAuditQuestions = getPillarAuditQuestions(supervisoryRole);

  const lines: string[] = [];
  lines.push(`### 🛡️ Autonomic Watchdog 3-Minute Persona Grounding [Tick #${tickNumber}]`);
  lines.push(`- **Role**: \`${supervisoryRole.toUpperCase()}\` (Tier ${roleBoundaries.tier})`);
  lines.push(`- **Archetype**: ${roleBoundaries.archetype}`);
  lines.push(`- **Timestamp**: \`${timestamp}\` (Cadence: ${Math.round(cadenceMs / 1000)}s)`);
  if (options.runId) {
    lines.push(`- **Run ID**: \`${options.runId}\``);
  }
  if (options.pulseId) {
    lines.push(`- **Pulse ID**: \`${options.pulseId}\``);
  }
  lines.push("");

  lines.push("#### 🚫 Invariant Boundaries & Absolute Confinement");
  for (const inv of roleBoundaries.roleInvariants) {
    lines.push(`- 🔴 ${inv}`);
  }
  lines.push("");

  lines.push("#### 🧠 The 7 Cognitive Pillars Reflexive Grounding");
  for (const p of pillars) {
    const roleMandate = p.supervisoryImplications[supervisoryRole];
    lines.push(`- **Pillar ${p.id} (${p.title})**: ${p.shortSummary}`);
    lines.push(`  *Mandate*: ${roleMandate}`);
    lines.push(`  *Reflexive Question*: "${p.selfAuditQuestion}"`);
  }
  lines.push("");

  lines.push("#### 🔍 Role-Specific Reflexive Self-Audit Questions");
  for (const q of roleBoundaries.reflexiveQuestions) {
    lines.push(`- ❓ ${q}`);
  }
  lines.push("");

  lines.push(
    "> [!IMPORTANT]\n> Supervisory threads must NEVER write code, stage files, or execute direct task repairs. Maintain pure delegation and topological observability.",
  );

  const formattedMarkdown = lines.join("\n");

  const compactLines: string[] = [
    `[WATCHDOG GROUNDING Tick #${tickNumber}]: Role=${supervisoryRole.toUpperCase()} (Tier ${roleBoundaries.tier}).`,
    `Mandate: ${roleBoundaries.coreMandate}`,
    `Invariants: (1) Zero direct file edits; (2) Strict tier hierarchy; (3) 5-min schedule & dag:view; (4) Quantitative proof only.`,
    `Reflexive Check: Evaluate progress against role invariants, subordinate fulfillment, and behavioral drift before next action.`,
  ];
  const compactPrompt = compactLines.join(" ");

  return {
    id,
    role: supervisoryRole,
    tier: roleBoundaries.tier,
    tickNumber,
    timestamp,
    cadenceMs,
    elapsedMs,
    runId: options.runId ?? null,
    pulseId: options.pulseId ?? null,
    pillars,
    roleBoundaries,
    reflexiveAuditQuestions,
    formattedMarkdown,
    compactPrompt,
  };
}

export function buildWatchdogAuditPrompt(
  role: SupervisoryRole | string,
  options?: WatchdogAuditPromptOptions,
): string {
  const supervisoryRole = normalizeSupervisoryRole(role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${role}' is not a supervisory role (mind, orchestrator, coordinator)`,
    );
  }

  const grounding = generateWatchdogPersonaGrounding({
    role: supervisoryRole,
    tickNumber: options?.tickNumber,
    runId: options?.runId,
    now: options?.now,
  });

  return grounding.formattedMarkdown;
}

export function formatReflexiveAuditEvaluation(evaluation: ReflexiveAuditEvaluation): string {
  return evaluation.markdownReport;
}

export function createWatchdogTickReminder(
  role: SupervisoryRole | string,
  tickNumber: number,
  context?: ReflexiveAuditContext,
): string {
  const supervisoryRole = normalizeSupervisoryRole(role);
  if (!supervisoryRole) {
    throw new HarnessError("INVALID_ARGUMENT", `role '${role}' is not a supervisory role`);
  }

  const grounding = generateWatchdogPersonaGrounding({
    role: supervisoryRole,
    tickNumber,
    now: context?.now,
    runId: context?.runId,
  });

  const fallbackContext: ReflexiveAuditContext = {
    role: supervisoryRole,
  };
  const evaluation = evaluateReflexiveSelfAudit(context ?? fallbackContext);

  const lines: string[] = [];
  lines.push(grounding.formattedMarkdown);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(evaluation.markdownReport);

  return lines.join("\n");
}

/**
 * Invalidates persona verification caches cleanly when session roles transition.
 */
export function invalidatePersonaVerificationCaches(): void {
  clearManifestCache();
}
