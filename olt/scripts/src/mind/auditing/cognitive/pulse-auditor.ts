import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCapsulesDir,
  resolveSkillHomeRepo,
  resolveDefectsPath,
  resolveBacklogPath,
} from "../../../core/shared/paths.ts";
import { SplitChannelDefectRouter } from "../../../reporting/split-channel-defect-router.ts";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../../../authority/verbatim-role-injector.ts";
import { readLastPulse } from "../../lifecycle/pulse/index.ts";
import { AuditorCursorStore } from "./cursor.ts";
import { MindAuditorEngine } from "./engine.ts";
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

  // 1. Determine last activity timestamp from the pulse clock alone. The cursor below tracks
  // this auditor's OWN last invocation, which advances every time this function runs; folding
  // it into lastActiveMs (via Math.max or as a same-priority fallback) makes the auditor
  // measure its own polling cadence instead of the Mind's. Confirmed live in
  // .olt/defects.jsonl (MIND_AUDIT_LIVE_MEASURES_THE_AUDITOR_CADENCE_NOT_THE_MIND): idle time
  // tracked the gap between audit ticks, not Mind activity, so a Mind silent for 4h05m read as
  // healthy whenever the auditor happened to run twice within the threshold.
  const pulseMs = MindAuditorEngine.resolveLatestPulseTimestamp(
    repoRoot,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );
  const activePulse = MindAuditorEngine.resolveActivePulse(
    repoRoot,
    nowMs,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );
  const activeMindGrant = MindAuditorEngine.resolveActiveMindGrant(
    repoRoot,
    options !== undefined ? options.capsuleRunRoot : undefined,
  );

  // An open, unexpired pulse is an authoritative liveness lease. Its last_pulse snapshot is
  // intentionally written at pulse open and may therefore predate a long running pulse.
  const lastActiveMs = activePulse
    ? nowMs
    : pulseMs !== null
      ? pulseMs
      : nowMs - (threshold + 1) * 1000; // never pulsed => already stagnant

  const idleDurationSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));
  // An active harness grant alone is not native Codex liveness. Require both a live grant and
  // prior pulse evidence before declaring a Mind stagnant; otherwise provide deployment or
  // reconciliation guidance without manufacturing a LIVE_STAGNATION defect.
  const hasNativeMindEvidence =
    activePulse !== null || (activeMindGrant !== null && pulseMs !== null);
  const stagnant = hasNativeMindEvidence && idleDurationSeconds >= threshold;
  const remediation = activePulse
    ? "none"
    : activeMindGrant === null
      ? "deploy_mind"
      : pulseMs === null
        ? "reconcile_native_mind"
        : stagnant
          ? "wake_mind"
          : "none";

  // 2. Query pending backlog count
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
    } catch {
      // ignore
    }
  }

  // 3. Query unresolved defect count
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

  const telemetry: StagnationTelemetry = {
    agentId: activePulse?.actor ?? activeMindGrant?.actor ?? "unknown",
    conversationId: options !== undefined ? options.conversationId : undefined,
    role: "mind",
    idleDurationSeconds,
    pendingBacklogCount,
    pendingPlanCount: 0,
    unresolvedDefectCount,
    lastActiveTimestamp: new Date(lastActiveMs).toISOString(),
  };

  let injectionPrompt: string | undefined;
  let defectCreated = false;

  const stagnationSignature = `${telemetry.agentId}|${pulseMs ?? "none"}|${threshold}`;
  if (stagnant) {
    injectionPrompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);
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
    defectCreated,
    localDefectCount,
    cursor: updatedCursor,
    timestamp: nowIso,
  };
}
