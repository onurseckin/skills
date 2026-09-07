import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { dispatchPeerMessage } from "../../../communication/mailbox/index.ts";
import { resolveCapsulesDir } from "../../../core/shared/index.ts";
import {
  analyzeRunForensics,
  extractToolCallsFromTranscripts,
  type ForensicsIncident,
  type RootCauseCategory,
} from "../meta/index.ts";
import {
  SentinelMonitorRegistry,
  LiveStrategyMonitorImpl,
} from "../../../sentinel/monitor/index.ts";
import type { AuditorCursor, SkillAuditLiveResult, SkillZeroDeltaResult } from "./types.ts";

export const SKILL_AUDIT_FORENSICS_CATEGORIES: ReadonlySet<RootCauseCategory> = new Set([
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
]);
export const INTERJECT_DIRECTIVE = "HALT_DIRECT_EDITS_AND_DISPATCH_SUBAGENTS";
export const INTERJECT_INSTRUCTIONS =
  "Halt direct file modifications and serial execution immediately. Coordinators are pure dispatchers (SUPERVISOR_ZERO_CODE_EDITS). You must compile the task plan and dispatch ready tasks to Tier 3 Implementers and Validators in parallel via invoke_subagent.";

export function discoverCapsuleRoots(repoRoot: string): string[] {
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

export function scanCapsuleForIncidents(
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

export function findActiveCoordinatorId(capsuleRoots: string[]): string | undefined {
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

export function dispatchInterjection(
  repoRoot: string,
  inc: ForensicsIncident,
  capsuleRoots: string[],
): boolean {
  const rawAgent = inc.agentId ?? inc.agent_id;
  const target =
    rawAgent && rawAgent.toLowerCase().includes("coord")
      ? rawAgent
      : (findActiveCoordinatorId(capsuleRoots) ?? "coordinator");
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

export function attachLiveHostMonitors(
  repoRoot: string,
  transcripts: readonly string[],
  capsuleRoots: string[],
): void {
  for (const t of transcripts) {
    const agentId = `skill-auditor-host-${t}`;
    if (SentinelMonitorRegistry.get(agentId)) continue;

    const monitor = new LiveStrategyMonitorImpl({
      agentId,
      role: "coordinator",
      transcriptPath: t,
      repoRoot,
    });

    monitor.onLineParsed = (line: string) => {
      const calls = extractToolCallsFromTranscripts([line]);
      for (const call of calls) {
        if (call.isWrite) {
          const inc: ForensicsIncident = {
            id: `live-strike-${Date.now()}`,
            category: "ROLE_BOUNDARY_DEVIATION",
            severity: "CRITICAL",
            title: "Live Strike: Role Boundary Deviation",
            description: `Direct file mutation (${call.name}) detected in unbuffered host transcript.`,
            agentId: "coordinator",
            observation: `Direct file mutation (${call.name}) detected in unbuffered host transcript.`,
            remediation: INTERJECT_INSTRUCTIONS,
            recommendation: INTERJECT_INSTRUCTIONS,
          };
          dispatchInterjection(repoRoot, inc, capsuleRoots);
        } else if (
          (call.name === "run_command" || call.name === "execute_command") &&
          (call.waitMsBeforeAsync === 0 || call.waitMsBeforeAsync === undefined)
        ) {
          const inc: ForensicsIncident = {
            id: `live-strike-${Date.now()}`,
            category: "FALSE_SERIALIZATION",
            severity: "HIGH",
            title: "Live Strike: False Serialization",
            description: `Synchronous execution of tool (${call.name}) detected in unbuffered host transcript.`,
            agentId: "coordinator",
            observation: `Synchronous execution of tool (${call.name}) detected in unbuffered host transcript.`,
            remediation: INTERJECT_INSTRUCTIONS,
            recommendation: INTERJECT_INSTRUCTIONS,
          };
          dispatchInterjection(repoRoot, inc, capsuleRoots);
        }
      }
    };

    SentinelMonitorRegistry.register(monitor);
  }
}

export function compareSkillReportDelta(
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
