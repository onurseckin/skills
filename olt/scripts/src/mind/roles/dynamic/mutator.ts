import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import { synthesizeDynamicRole } from "./synthesizer.ts";
import type {
  DefectRoleSynthesisParams,
  DynamicRoleContract,
  DynamicRoleSpec,
  DynamicRoleSynthesisPlan,
  RoleLineageEntry,
  RoleMutationFeedback,
  TaskRoleSynthesisParams,
} from "./types.ts";
import {
  formatDynamicRoleBody,
  formatDynamicRoleFrontmatter,
  validateDynamicRoleSpec,
} from "./validation.ts";
export function synthesizeRoleFromTaskRequirements(
  params: TaskRoleSynthesisParams,
): DynamicRoleSynthesisPlan {
  const domainTag = params.domain ?? "general";
  const isRepair = params.requiresRepair === true;

  const implementerRoleName = isRepair
    ? `repairer-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`
    : `implementer-${domainTag}-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  const validatorRoleName = `validator-${domainTag}-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  // Implementer synthesis
  const implementerRole = synthesizeDynamicRole({
    name: implementerRoleName,
    archetype: isRepair ? "tier_3_repairer" : "tier_3_implementer",
    domain: domainTag,
    title: isRepair
      ? `Specialized Repairer for Task ${params.taskId}`
      : `Specialized Implementer for Task ${params.taskId}`,
    summary: `Dedicated implementer executing task '${params.taskTitle}' within bounded write scope.`,
    writeScopePolicy: "lease_bounded",
    permittedActivities: [
      `Claim leased write scope for task ${params.taskId}`,
      `Edit files strictly within write scope: [${params.writeScope.join(", ")}]`,
      `Execute task verification gate: \`${params.gate}\``,
      "Submit task with deterministic command evidence",
    ],
    prohibitedActions: [
      "Touch any files outside leased write scope",
      "Introduce TypeScript `any`, @ts-ignore, or @ts-expect-error",
      "Perform self-validation or sign off on validator duties",
    ],
    cognitivePillars: [
      "Strict Zero-Any & Zero-Suppression TypeScript Discipline",
      `Confinement to write scope: [${params.writeScope.join(", ")}]`,
      "1:1 Task Isolation & Anti-Batching Integrity",
    ],
    metadata: {
      taskId: params.taskId,
      candidateId: params.candidateId,
      feedbackId: params.feedbackId,
    },
  });

  // Validator synthesis with Anti-Boundary-Leak enforcement
  const validatorRole = synthesizeDynamicRole({
    name: validatorRoleName,
    archetype: "tier_3_validator",
    domain: domainTag,
    title: `Independent Validator for Task ${params.taskId}`,
    summary: `Independent read-only validator evaluating task '${params.taskTitle}' against gate '${params.gate}'.`,
    writeScopePolicy: "forbidden",
    permittedActivities: [
      `Execute verification gate: \`${params.gate}\``,
      "Inspect code diffs against strict zero-any and zero-suppression rules",
      "Emit structured validation findings and pass/fail verdict",
    ],
    prohibitedActions: [
      "Claim code write leases, edit files, or modify repository code directly (Anti-Boundary-Leak Rule)",
      "Validate own code or execute implementer commands",
    ],
    cognitivePillars: [
      "Independent & Adversarial Verification",
      "Strict Read-Only Anti-Boundary-Leak Enforcement",
      "Zero False Positives & Deterministic Gate Evaluation",
    ],
    metadata: {
      taskId: params.taskId,
      validatedImplementer: implementerRoleName,
    },
  });

  return {
    taskId: params.taskId,
    implementerRole,
    validatorRole,
    validationSummary: `Synthesized 1:1 paired Implementer (${implementerRoleName}) and independent Validator (${validatorRoleName}) for task ${params.taskId}.`,
    antiBatchingCompliant: true,
    antiBoundaryLeakGuaranteed: true,
  };
}

/**
 * Synthesizes a specialized role from defect remediation context.
 */
export function synthesizeRoleFromDefectRemediation(
  params: DefectRoleSynthesisParams,
): DynamicRoleContract {
  const roleName = `remediator-defect-${params.defectId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  const defaultPillars = [
    `Remediation of Defect: ${params.defectType}`,
    `Root Cause Defense: ${params.rootCause}`,
    "Strict Anti-Regression Verification",
  ];

  const prohibitedActions = [
    "Touch files outside affected defect scope",
    "Re-introduce identical defect signature pattern",
    "Introduce TypeScript `any` or suppressions",
  ];

  const invariants = [
    `Remediation Target: ${params.defectId}`,
    `Action: ${params.correctiveAction}`,
    ...(params.requiredInvariants ?? []),
  ];

  return synthesizeDynamicRole({
    name: roleName,
    archetype: "tier_3_repairer",
    domain: "defect-investigation",
    title: `Defect Remediation Specialist: ${params.defectId}`,
    summary: `Specialized repairer synthesized to fix defect '${params.defectId}' (${params.defectType}) without regressions.`,
    writeScopePolicy: "lease_bounded",
    permittedActivities: [
      `Claim write scope for defect remediation: [${params.affectedScope.join(", ")}]`,
      `Apply corrective action: ${params.correctiveAction}`,
      "Run targeted regression test suite",
    ],
    prohibitedActions,
    invariants,
    cognitivePillars: defaultPillars,
    metadata: {
      defectId: params.defectId,
      defectType: params.defectType,
    },
  });
}

/**
 * Mutates an existing dynamic role with evolutionary feedback while maintaining lineage.
 */
export function mutateRoleWithFeedback(
  role: DynamicRoleContract,
  feedback: RoleMutationFeedback,
): DynamicRoleContract {
  const currentSpec = role.spec;
  const currentVersion = currentSpec.version ?? 1;
  const newVersion = currentVersion + 1;

  const updatedInvariants = [...currentSpec.invariants, ...(feedback.newInvariants ?? [])];

  const updatedPillars = [...currentSpec.cognitivePillars, ...(feedback.newPillars ?? [])];

  const removedCmdSet = new Set(feedback.removedCommands ?? []);
  const updatedCommands = [
    ...currentSpec.grantedCommands.filter((c) => !removedCmdSet.has(c)),
    ...(feedback.additionalCommands ?? []),
  ];

  const updatedProhibitions = [
    ...currentSpec.prohibitedActions,
    ...(feedback.additionalProhibitions ?? []),
  ];

  const changedFields: string[] = [];
  if (feedback.newInvariants?.length) changedFields.push("invariants");
  if (feedback.newPillars?.length) changedFields.push("cognitivePillars");
  if (feedback.additionalCommands?.length || feedback.removedCommands?.length)
    changedFields.push("grantedCommands");
  if (feedback.additionalProhibitions?.length) changedFields.push("prohibitedActions");

  const newLineageEntry: RoleLineageEntry = {
    version: currentVersion,
    timestamp: new Date().toISOString(),
    mutationReason: feedback.mutationReason,
    previousSha256: role.sha256,
    changedFields,
  };

  const updatedLineage = [...(currentSpec.lineage ?? []), newLineageEntry];

  const mutatedSpec: DynamicRoleSpec = {
    ...currentSpec,
    version: newVersion,
    parentRole: currentSpec.name,
    invariants: updatedInvariants,
    cognitivePillars: updatedPillars,
    grantedCommands: updatedCommands,
    prohibitedActions: updatedProhibitions,
    lineage: updatedLineage,
    metadata: {
      ...currentSpec.metadata,
      ...feedback.metadataUpdate,
      lastMutationReason: feedback.mutationReason,
    },
  };

  const validation = validateDynamicRoleSpec(mutatedSpec);
  if (!validation.valid) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Role mutation failed validation for '${mutatedSpec.name}': ${validation.errors.join("; ")}`,
      validation.errors,
    );
  }

  const rawFrontmatter = formatDynamicRoleFrontmatter(mutatedSpec);
  const rawBody = formatDynamicRoleBody(mutatedSpec);
  const markdown = `${rawFrontmatter}\n\n${rawBody}\n`;
  const bytes = new TextEncoder().encode(markdown);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    role: mutatedSpec.name,
    tier: mutatedSpec.tier,
    title: mutatedSpec.title,
    summary: mutatedSpec.summary,
    domain: mutatedSpec.domain,
    may: mutatedSpec.permittedActivities,
    must_not: mutatedSpec.prohibitedActions,
    commands: mutatedSpec.grantedCommands,
    spawns: mutatedSpec.spawns,
    cognitivePillars: mutatedSpec.cognitivePillars,
    writeScopePolicy: mutatedSpec.writeScopePolicy,
    spec: mutatedSpec,
    markdown,
    rawFrontmatter,
    rawBody,
    sha256,
  };
}

/**
 * Generates a RoleCheatSheet from a DynamicRoleContract or DynamicRoleSpec.
 */
