import { resolve } from "node:path";
import { SplitChannelDefectRouter } from "../../../reporting/split-channel-defect-router.ts";
import { discoverActiveTranscripts, type ForensicsIncident } from "../meta/index.ts";
import { AuditorCursorStore } from "./types.ts";
import type {
  AuditorCursor,
  SkillAuditLiveResult,
  SkillAuditOptions,
  SkillZeroDeltaResult,
} from "./types.ts";
import {
  attachLiveHostMonitors,
  compareSkillReportDelta,
  dispatchInterjection,
  discoverCapsuleRoots,
  scanCapsuleForIncidents,
} from "./skill-auditor-helpers.ts";

export { discoverActiveTranscripts } from "../meta/index.ts";

export class SkillAuditorEngine {
  public static readonly DEFAULT_CADENCE_INTERVAL_SECONDS = 60;
  public static readonly DEFAULT_CADENCE_INTERVAL_MS = 60_000;

  public static compareSkillReportDelta(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): SkillZeroDeltaResult {
    return compareSkillReportDelta(current, previous);
  }

  public static isZeroDeltaReport(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): boolean {
    return compareSkillReportDelta(current, previous).isZeroDelta;
  }

  public static suppressZeroDeltaReport(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): SkillAuditLiveResult {
    const delta = compareSkillReportDelta(current, previous);
    const summary = delta.isZeroDelta
      ? "Suppressed duplicate zero-delta skill compliance report."
      : delta.summary;
    const flags = {
      zero_delta: delta.isZeroDelta,
      suppressed: delta.isZeroDelta,
      delta_summary: summary,
    };
    return { ...current, ...flags };
  }

  public static auditSkillCompliance(
    repoRoot: string,
    options?: SkillAuditOptions,
  ): SkillAuditLiveResult {
    const nowIso = options?.now ?? new Date().toISOString();
    const explicitRunRoot = options?.capsuleRunRoot;
    const capsuleRoots = explicitRunRoot
      ? [resolve(explicitRunRoot)]
      : discoverCapsuleRoots(repoRoot);
    const activeTranscripts = options?.transcripts ?? discoverActiveTranscripts(repoRoot);

    attachLiveHostMonitors(repoRoot, activeTranscripts, capsuleRoots);

    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let rollupMaxSeq = -1;
    for (const capsuleRoot of capsuleRoots) {
      const scopedCursor =
        options?.cursor !== undefined && explicitRunRoot !== undefined
          ? options.cursor
          : AuditorCursorStore.loadCursor(repoRoot, "skill", capsuleRoot);
      const scan = scanCapsuleForIncidents(capsuleRoot, scopedCursor, nowIso, activeTranscripts);
      incidents.push(...scan.incidents);
      eventsAnalyzed += scan.eventsAnalyzed;
      AuditorCursorStore.saveCursor(repoRoot, "skill", scan.updatedCursor, capsuleRoot);
      rollupMaxSeq = Math.max(rollupMaxSeq, scan.updatedCursor.lastInspectedEventIndex);
    }
    const rollupCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: rollupMaxSeq,
      lastAuditTimestamp: nowIso,
    };
    AuditorCursorStore.saveCursor(repoRoot, "skill", rollupCursor);
    const candidateResult: SkillAuditLiveResult = {
      compliant: incidents.length === 0,
      incidents,
      defectsLogged: 0,
      interjectionsSent: 0,
      cursor: rollupCursor,
      eventsAnalyzed,
      timestamp: nowIso,
    };
    const delta = compareSkillReportDelta(candidateResult, options?.previousReport);
    const shouldSuppress =
      (options?.suppressZeroDelta === true || options?.previousReport !== undefined) &&
      delta.isZeroDelta;
    let defectsLogged = 0;
    if (options?.logDefects !== false && !shouldSuppress) {
      for (const inc of incidents) {
        const routeResult = SplitChannelDefectRouter.routeDefect({
          currentRepoRoot: repoRoot,
          domain: "skill-framework",
          defect: {
            error_code: inc.category,
            title: `Skill Compliance Incident: ${inc.category}`,
            description: inc.description,
            actor: "skill-auditor",
            context: {
              incidentId: inc.id,
              severity: inc.severity,
              mitigationSuggestion: inc.recommendation,
            },
          },
        });
        if (routeResult.routed) defectsLogged++;
      }
    }
    let interjectionsSent = 0;
    if (options?.interject !== false && !shouldSuppress) {
      for (const inc of incidents) {
        if (
          (inc.category === "FALSE_SERIALIZATION" || inc.category === "ROLE_BOUNDARY_DEVIATION") &&
          dispatchInterjection(repoRoot, inc, capsuleRoots)
        ) {
          interjectionsSent++;
        }
      }
    }
    return {
      ...candidateResult,
      defectsLogged,
      interjectionsSent,
      zero_delta: delta.isZeroDelta,
      suppressed: shouldSuppress,
      delta_summary: delta.summary,
    };
  }
}
