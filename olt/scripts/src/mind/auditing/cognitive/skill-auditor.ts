import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { dispatchPeerMessage } from "../../../communication/mailbox/index.ts";
import { resolveCapsulesDir } from "../../../core/shared/paths.ts";
import { SplitChannelDefectRouter } from "../../../reporting/split-channel-defect-router.ts";
import {
  analyzeRunForensics,
  discoverActiveTranscripts,
  type ForensicsIncident,
  type RootCauseCategory,
} from "../meta/index.ts";
import { AuditorCursorStore } from "./cursor.ts";
import type {
  AuditorCursor,
  SkillAuditLiveResult,
  SkillAuditOptions,
  SkillZeroDeltaResult,
} from "./types.ts";
export { discoverActiveTranscripts } from "../meta/index.ts";

const SKILL_AUDIT_FORENSICS_CATEGORIES: ReadonlySet<RootCauseCategory> = new Set([
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
]);
const INTERJECT_DIRECTIVE = "HALT_DIRECT_EDITS_AND_DISPATCH_SUBAGENTS";
const INTERJECT_INSTRUCTIONS =
  "Halt direct file modifications and serial execution immediately. Coordinators are pure dispatchers (SUPERVISOR_ZERO_CODE_EDITS). You must compile the task plan and dispatch ready tasks to Tier 3 Implementers and Validators in parallel via invoke_subagent.";

export class SkillAuditorEngine {
  public static readonly DEFAULT_CADENCE_INTERVAL_SECONDS = 60;
  public static readonly DEFAULT_CADENCE_INTERVAL_MS = 60_000;

  private static discoverCapsuleRoots(repoRoot: string): string[] {
    const roots = new Set<string>();
    if (existsSync(join(repoRoot, "events.jsonl"))) roots.add(resolve(repoRoot));
    for (const d of [resolveCapsulesDir(repoRoot), join(repoRoot, ".capsules")]) {
      if (!existsSync(d)) continue;
      try {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && existsSync(join(d, e.name, "events.jsonl"))) {
            roots.add(resolve(join(d, e.name)));
          }
        }
      } catch {}
    }
    return [...roots];
  }

  private static scanCapsuleForIncidents(
    capsuleRoot: string,
    cursor: AuditorCursor,
    nowIso: string,
    activeTranscripts?: readonly string[],
  ): { incidents: ForensicsIncident[]; eventsAnalyzed: number; updatedCursor: AuditorCursor } {
    const eventsPath = join(capsuleRoot, "events.jsonl");
    let eventsAnalyzed = 0;
    let maxEventSeq = cursor.lastInspectedEventIndex;
    const hasEvents = existsSync(eventsPath);
    if (hasEvents) {
      try {
        const lines = readFileSync(eventsPath, "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0);
        for (let i = 0; i < lines.length; i++) {
          if (i > cursor.lastInspectedEventIndex) {
            eventsAnalyzed++;
            maxEventSeq = Math.max(maxEventSeq, i);
          }
        }
      } catch {}
    }
    const incidents = hasEvents
      ? analyzeRunForensics({
          runRoot: capsuleRoot,
          inject: false,
          transcripts: activeTranscripts,
        }).incidents.filter((inc) => SKILL_AUDIT_FORENSICS_CATEGORIES.has(inc.category))
      : [];
    return {
      incidents,
      eventsAnalyzed,
      updatedCursor: {
        lastInspectedTimestamp: nowIso,
        lastInspectedEventIndex: maxEventSeq,
        lastAuditTimestamp: nowIso,
      },
    };
  }

  private static findActiveCoordinatorId(capsuleRoots: string[]): string | undefined {
    for (const root of capsuleRoots) {
      const statePath = join(root, "state.json");
      if (!existsSync(statePath)) continue;
      try {
        const raw = JSON.parse(readFileSync(statePath, "utf-8")) as {
          agents?: Array<{ id?: string; role?: string; status?: string }>;
        };
        for (const a of raw.agents ?? []) {
          if (
            a.status === "active" &&
            typeof a.id === "string" &&
            a.role?.toLowerCase().includes("coordinator")
          ) {
            return a.id;
          }
        }
      } catch {}
    }
    return undefined;
  }

  public static dispatchInterjection(
    repoRoot: string,
    inc: ForensicsIncident,
    capsuleRoots: string[],
  ): boolean {
    const rawAgent = inc.agentId ?? inc.agent_id;
    const target =
      rawAgent && rawAgent.toLowerCase().includes("coord")
        ? rawAgent
        : (SkillAuditorEngine.findActiveCoordinatorId(capsuleRoots) ?? "coordinator");
    try {
      dispatchPeerMessage({
        senderId: "skill-auditor",
        senderRole: "skill-auditor",
        recipientRoleOrId: target,
        messageType: "DEFECT_ESCALATION",
        payload: {
          action: "INTERJECT_HALT_DIRECT_EXECUTION",
          incident_id: inc.id,
          category: inc.category,
          severity: inc.severity,
          title: inc.title,
          directive: INTERJECT_DIRECTIVE,
          instructions: INTERJECT_INSTRUCTIONS,
          observation: inc.observation ?? inc.description ?? "Direct execution detected",
          remediation:
            inc.remediation ??
            inc.recommendation ??
            "Halt direct execution and dispatch subagents via invoke_subagent.",
        },
        correlationId: inc.id,
        baseDir: repoRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  public static compareSkillReportDelta(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): SkillZeroDeltaResult {
    const eventsDelta = current.eventsAnalyzed;
    if (!previous) {
      const counts = {
        incidentsDelta: current.incidents.length,
        defectsDelta: current.defectsLogged,
      };
      return {
        isZeroDelta: false,
        eventsDelta,
        ...counts,
        suppressed: false,
        summary: "Initial baseline skill compliance report established.",
      };
    }
    const incidentsDelta = current.incidents.length - previous.incidents.length;
    const defectsDelta = current.defectsLogged - previous.defectsLogged;
    const isZeroDelta =
      eventsDelta === 0 &&
      current.incidents.length === 0 &&
      previous.incidents.length === 0 &&
      current.compliant === previous.compliant;
    const summary = isZeroDelta
      ? "Zero-delta state detected: fleet converged at rest with 0 new events and 0 incidents."
      : `Delta detected: events=${eventsDelta}, incidents=${incidentsDelta > 0 ? `+${incidentsDelta}` : incidentsDelta}, defects=${defectsDelta > 0 ? `+${defectsDelta}` : defectsDelta}.`;
    const base = { isZeroDelta, eventsDelta, incidentsDelta, defectsDelta };
    return { ...base, suppressed: isZeroDelta, summary };
  }

  public static isZeroDeltaReport(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): boolean {
    return SkillAuditorEngine.compareSkillReportDelta(current, previous).isZeroDelta;
  }

  public static suppressZeroDeltaReport(
    current: SkillAuditLiveResult,
    previous?: SkillAuditLiveResult | null,
  ): SkillAuditLiveResult {
    const delta = SkillAuditorEngine.compareSkillReportDelta(current, previous);
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
      : SkillAuditorEngine.discoverCapsuleRoots(repoRoot);
    const activeTranscripts = options?.transcripts ?? discoverActiveTranscripts(repoRoot);
    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let rollupMaxSeq = -1;
    for (const capsuleRoot of capsuleRoots) {
      const scopedCursor =
        options?.cursor !== undefined && explicitRunRoot !== undefined
          ? options.cursor
          : AuditorCursorStore.loadCursor(repoRoot, "skill", capsuleRoot);
      const scan = SkillAuditorEngine.scanCapsuleForIncidents(
        capsuleRoot,
        scopedCursor,
        nowIso,
        activeTranscripts,
      );
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
    const delta = SkillAuditorEngine.compareSkillReportDelta(
      candidateResult,
      options?.previousReport,
    );
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
          SkillAuditorEngine.dispatchInterjection(repoRoot, inc, capsuleRoots)
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
