import type { UnifiedAgentModel } from "../manifest-parser.ts";
import { loadUnifiedAgentModel, normalizeRoleName } from "../manifest-parser.ts";
import { STANDING_CHECKLIST_DEFINITIONS } from "./checklists.ts";
import { DECISION_PROTOCOLS } from "./constants.ts";
import { evaluateRulesBatch1 } from "./eval-rules-1.ts";
import { evaluateRulesBatch2 } from "./eval-rules-2.ts";
import type {
  ChecklistItemEvaluation,
  PersonaViolation,
  PersonaViolationSeverity,
  SupervisoryReminderEvaluationContext,
  SupervisoryStateEvaluation,
} from "./types.ts";

export function evaluateSupervisoryState(
  context: SupervisoryReminderEvaluationContext,
  unifiedModel?: UnifiedAgentModel,
): SupervisoryStateEvaluation {
  const role = normalizeRoleName(context.role);
  const model = unifiedModel ?? loadUnifiedAgentModel(role);
  const tier = model.tier;

  const violations: PersonaViolation[] = [];
  const correctiveDirectives: string[] = [];

  const relevantChecklists = STANDING_CHECKLIST_DEFINITIONS.filter(
    (def) =>
      def.targetRoles.includes(role) ||
      (def.targetRoles.includes("validator") && role.startsWith("validator")),
  );

  const checklistEvaluations: ChecklistItemEvaluation[] = [];
  const leases = context.activeLeases ?? [];

  // Run invariant check batches
  evaluateRulesBatch1(role, tier, model, context, leases, violations, correctiveDirectives);
  evaluateRulesBatch2(role, tier, context, leases, violations, correctiveDirectives);

  // Map violations to checklist items
  for (const def of relevantChecklists) {
    const matchingViolation = violations.find(
      (v) =>
        (def.protocolKey && v.code.toLowerCase().includes(def.protocolKey.toLowerCase())) ||
        v.message.toLowerCase().includes(def.title.toLowerCase()),
    );

    if (matchingViolation) {
      checklistEvaluations.push({
        id: def.id,
        category: def.category,
        title: def.title,
        status: "violated",
        reason: matchingViolation.message,
        correctiveDirective: matchingViolation.correctiveDirective,
      });
    } else {
      checklistEvaluations.push({
        id: def.id,
        category: def.category,
        title: def.title,
        status: "completed",
        evidence: `Compliant with standing mandate: ${def.mandate}`,
      });
    }
  }

  // Compute severity and drift score
  let maxSeverity: PersonaViolationSeverity = "none";
  let driftScore = 0;

  for (const v of violations) {
    if (v.severity === "critical") {
      maxSeverity = "critical";
      driftScore += 0.5;
    } else if (v.severity === "high" && maxSeverity !== "critical") {
      maxSeverity = "high";
      driftScore += 0.3;
    } else if (v.severity === "medium" && maxSeverity !== "critical" && maxSeverity !== "high") {
      maxSeverity = "medium";
      driftScore += 0.15;
    } else if (v.severity === "low" && maxSeverity === "none") {
      maxSeverity = "low";
      driftScore += 0.05;
    }
  }

  driftScore = Math.min(1.0, Math.round(driftScore * 100) / 100);
  const compliant = violations.length === 0;

  const applicableProtocols = Object.values(DECISION_PROTOCOLS).filter((proto) =>
    proto.applicableTiers.includes(tier),
  );

  const summary = compliant
    ? `Agent ${role.toUpperCase()} (Tier ${tier}) is fully compliant with 0 boundary violations and all responsibility checklists verified.`
    : `Agent ${role.toUpperCase()} (Tier ${tier}) exhibits ${maxSeverity.toUpperCase()} boundary drift (drift score: ${driftScore}). ${violations.length} violation(s) detected.`;

  return {
    role,
    tier,
    compliant,
    driftScore,
    severity: maxSeverity,
    checklist: checklistEvaluations,
    violations,
    correctiveDirectives,
    applicableDecisionProtocols: applicableProtocols,
    summary,
  };
}
