import {
  resolveLatestPulseTimestamp,
  resolveActivePulse,
  resolveActiveMindGrant,
} from "./capsule-resolver.ts";
import { auditRepositoryGovernanceHelper } from "./governance-auditor.ts";
import { existsSync, readFileSync } from "node:fs";
import {
  resolveSkillHomeRepo,
  resolveDefectsPath,
  resolveBacklogPath,
} from "../../../core/shared/paths.ts";
import { SplitChannelDefectRouter } from "../../../reporting/split-channel-defect-router.ts";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../../../authority/verbatim-role-injector.ts";
import { executeStagnationShockRecovery } from "../stagnation-recovery-interlock.ts";
import { AuditorCursorStore } from "./cursor.ts";
import { CognitiveChallengePromptGenerator } from "./challenge-generator.ts";
import type { AuditorCursor, MindAuditLiveResult } from "./types.ts";

export function auditMindPulseHelper(
  repoRoot: string,
  options?: {
    cursor?: AuditorCursor | undefined;
    stagnationThresholdSeconds?: number | undefined;
    conversationId?: string | undefined;
    now?: string | undefined;
    capsuleRunRoot?: string | undefined;
  },
): MindAuditLiveResult {
  const threshold =
    options !== undefined && typeof options.stagnationThresholdSeconds === "number"
      ? options.stagnationThresholdSeconds
      : 120;
  const cursor =
    options !== undefined && options.cursor !== undefined
      ? options.cursor
      : AuditorCursorStore.loadCursor(repoRoot, "mind");
  const nowIso =
    options !== undefined && typeof options.now === "string"
      ? options.now
      : new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const pulseMs = resolveLatestPulseTimestamp(
    repoRoot,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );
  const activePulse = resolveActivePulse(
    repoRoot,
    nowMs,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );
  const activeMindGrant = resolveActiveMindGrant(
    repoRoot,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );

  let lastActiveMs: number;
  if (activePulse !== null) {
    lastActiveMs = nowMs;
  } else if (pulseMs !== null) {
    lastActiveMs = pulseMs;
  } else if (
    options !== undefined &&
    options.cursor !== undefined &&
    typeof options.cursor.lastInspectedTimestamp === "string"
  ) {
    lastActiveMs = new Date(options.cursor.lastInspectedTimestamp).getTime();
  } else {
    lastActiveMs = nowMs - (threshold + 1) * 1000;
  }

  const idleDurationSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));
  const gov = auditRepositoryGovernanceHelper(
    repoRoot,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );

  let hasNativeMindEvidence = false;
  if (activePulse !== null) {
    hasNativeMindEvidence = true;
  } else if (activeMindGrant !== null && pulseMs !== null) {
    hasNativeMindEvidence = true;
  } else if (
    options !== undefined &&
    options.cursor !== undefined &&
    typeof options.cursor.lastInspectedTimestamp === "string"
  ) {
    hasNativeMindEvidence = true;
  }

  let stagnant = false;
  if (hasNativeMindEvidence && idleDurationSeconds >= threshold) {
    stagnant = true;
  } else if (gov.simulatedExecutionDetected) {
    stagnant = true;
  }

  let remediation: "deploy_mind" | "reconcile_native_mind" | "wake_mind" | "none";
  if (activePulse !== null && !gov.simulatedExecutionDetected) {
    remediation = "none";
  } else if (activeMindGrant === null) {
    remediation = "deploy_mind";
  } else if (pulseMs === null) {
    remediation = "reconcile_native_mind";
  } else if (gov.simulatedExecutionDetected) {
    remediation = "reconcile_native_mind";
  } else if (!gov.policyValid) {
    remediation = "deploy_mind";
  } else if (stagnant) {
    remediation = "wake_mind";
  } else {
    remediation = "none";
  }

  let pendingBacklogCount = 0;
  const backlogPath = resolveBacklogPath(repoRoot);
  if (existsSync(backlogPath)) {
    try {
      const lines = readFileSync(backlogPath, "utf-8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const item = JSON.parse(line) as Record<string, unknown>;
        if (
          item["status"] !== "COMPLETED" &&
          item["status"] !== "PROCESSED" &&
          item["status"] !== "DECLINED"
        ) {
          pendingBacklogCount++;
        }
      }
    } catch {}
  }

  const countDefectLines = (defectsPath: string): number => {
    if (!existsSync(defectsPath)) return 0;
    try {
      return readFileSync(defectsPath, "utf-8")
        .split("\n")
        .filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  };
  const mothershipDefectsPath = resolveDefectsPath(resolveSkillHomeRepo());
  const localDefectsPath = resolveDefectsPath(repoRoot);
  const unresolvedDefectCount = countDefectLines(mothershipDefectsPath);
  const localDefectCount =
    localDefectsPath !== mothershipDefectsPath ? countDefectLines(localDefectsPath) : 0;

  let agentId = "unknown";
  if (activePulse !== null && activePulse.actor !== undefined) {
    agentId = activePulse.actor;
  } else if (activeMindGrant !== null && activeMindGrant.actor !== undefined) {
    agentId = activeMindGrant.actor;
  }

  const telemetry: StagnationTelemetry = {
    agentId,
    conversationId: options !== undefined ? options.conversationId : undefined,
    role: "mind",
    idleDurationSeconds,
    pendingBacklogCount,
    pendingPlanCount: 0,
    unresolvedDefectCount,
    lastActiveTimestamp: new Date(lastActiveMs).toISOString(),
  };

  let injectionPrompt: string | undefined = undefined;
  let cognitiveChallengePrompt: string | undefined = undefined;
  let defectCreated = false;

  if (pendingBacklogCount === 0) {
    cognitiveChallengePrompt = CognitiveChallengePromptGenerator.generateZeroDeltaChallengePrompt(
      repoRoot,
      {
        cycleIndex: cursor.lastInspectedEventIndex,
        now: nowIso,
      },
    );
  }

  const pulseSig = pulseMs !== null ? String(pulseMs) : "none";
  const stagnationSignature = `${telemetry.agentId}|${pulseSig}|${threshold}`;

  if (stagnant) {
    executeStagnationShockRecovery(repoRoot, {
      idleDurationSeconds,
      stagnationThresholdSeconds: threshold,
      pendingBacklogCount,
      now: nowIso,
    });
    const baseInjection = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);
    if (pendingBacklogCount === 0 && cognitiveChallengePrompt !== undefined) {
      injectionPrompt = `${baseInjection}\n\n${cognitiveChallengePrompt}`;
    } else {
      injectionPrompt = baseInjection;
    }

    if (cursor.lastStagnationSignature !== stagnationSignature) {
      const routeResult = SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: repoRoot,
        domain: "skill-framework",
        defect: {
          error_code: "LIVE_STAGNATION_DETECTED",
          title: "Tier 0 Mind Stagnation Detected",
          description: `Tier 0 Mind has been idle for ${idleDurationSeconds}s (threshold: ${threshold}s). Mode ${pendingBacklogCount === 0 ? "A" : "B"} wakeup injection synthesized.`,
          actor: "mind-auditor",
          context: {
            idleDurationSeconds,
            pendingBacklogCount,
            unresolvedDefectCount,
            conversationId: options !== undefined ? options.conversationId : undefined,
          },
        },
      });
      defectCreated = routeResult.routed;
    }
  }

  const updatedCursor: AuditorCursor = {
    lastInspectedTimestamp: nowIso,
    lastInspectedEventIndex: cursor.lastInspectedEventIndex,
    lastAuditTimestamp: nowIso,
    ...(stagnant ? { lastStagnationSignature: stagnationSignature } : {}),
  };
  AuditorCursorStore.saveCursor(repoRoot, "mind", updatedCursor);

  return {
    stagnant,
    idleDurationSeconds,
    telemetry,
    remediation,
    injectionPrompt,
    cognitiveChallengePrompt,
    defectCreated,
    localDefectCount,
    cursor: updatedCursor,
    timestamp: nowIso,
  };
}
