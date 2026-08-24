import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ForensicsIncident } from "./meta-auditor.ts";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../authority/verbatim-role-injector.ts";
import { resolveDefectsPath, resolveOltDir, resolveBacklogPath } from "../core/shared/paths.ts";
import { SplitChannelDefectRouter } from "../reporting/split-channel-defect-router.ts";

export interface AuditorCursor {
  readonly lastInspectedTimestamp: string;
  readonly lastInspectedEventIndex: number;
  readonly lastAuditTimestamp?: string | undefined;
}

export interface MindAuditLiveResult {
  readonly stagnant: boolean;
  readonly idleDurationSeconds: number;
  readonly telemetry: StagnationTelemetry;
  readonly injectionPrompt?: string | undefined;
  readonly defectCreated?: boolean | undefined;
  readonly cursor: AuditorCursor;
  readonly timestamp: string;
}

export interface SkillAuditLiveResult {
  readonly compliant: boolean;
  readonly incidents: readonly ForensicsIncident[];
  readonly defectsLogged: number;
  readonly cursor: AuditorCursor;
  readonly eventsAnalyzed: number;
  readonly timestamp: string;
}

export interface StoredAuditorCursors {
  readonly mind?: AuditorCursor | undefined;
  readonly skill?: AuditorCursor | undefined;
}

export class AuditorCursorStore {
  public static resolveCursorPath(repoRoot: string): string {
    return join(resolveOltDir(repoRoot), "auditor-cursors.json");
  }

  public static loadCursor(repoRoot: string, auditorType: "mind" | "skill"): AuditorCursor {
    const p = this.resolveCursorPath(repoRoot);
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && auditorType in parsed) {
          const c = (parsed as Record<string, unknown>)[auditorType];
          if (
            c &&
            typeof c === "object" &&
            "lastInspectedTimestamp" in c &&
            "lastInspectedEventIndex" in c
          ) {
            const rec = c as Record<string, unknown>;
            return {
              lastInspectedTimestamp: String(
                rec["lastInspectedTimestamp"] || "1970-01-01T00:00:00.000Z",
              ),
              lastInspectedEventIndex:
                typeof rec["lastInspectedEventIndex"] === "number"
                  ? rec["lastInspectedEventIndex"]
                  : -1,
              lastAuditTimestamp:
                typeof rec["lastAuditTimestamp"] === "string"
                  ? rec["lastAuditTimestamp"]
                  : undefined,
            };
          }
        }
      } catch {
        // Fall back to default cursor
      }
    }
    return {
      lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
      lastInspectedEventIndex: -1,
    };
  }

  public static saveCursor(
    repoRoot: string,
    auditorType: "mind" | "skill",
    cursor: AuditorCursor,
  ): void {
    const p = this.resolveCursorPath(repoRoot);
    let allCursors: Record<string, unknown> = {};
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object") {
          allCursors = parsed as Record<string, unknown>;
        }
      } catch {
        allCursors = {};
      }
    }
    allCursors[auditorType] = cursor;
    const dir = dirname(p);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(p, JSON.stringify(allCursors, null, 2) + "\n", "utf-8");
  }
}

export class MindAuditorEngine {
  public static auditMindPulse(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      stagnationThresholdSeconds?: number | undefined;
      conversationId?: string | undefined;
      now?: string | undefined;
    },
  ): MindAuditLiveResult {
    const threshold = options?.stagnationThresholdSeconds ?? 120;
    const cursor = options?.cursor ?? AuditorCursorStore.loadCursor(repoRoot, "mind");
    const nowIso = options?.now ?? new Date().toISOString();
    const nowMs = new Date(nowIso).getTime();

    // 1. Determine last activity timestamp from cursor, last pulse, or backlog
    let lastActiveMs = new Date(cursor.lastInspectedTimestamp).getTime();
    if (isNaN(lastActiveMs) || lastActiveMs <= 0) {
      lastActiveMs = nowMs - (threshold + 1) * 1000; // default to threshold exceeded if never inspected
    }

    const idleDurationSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));
    const stagnant = idleDurationSeconds >= threshold;

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
    let unresolvedDefectCount = 0;
    const defectsPath = resolveDefectsPath(repoRoot);
    if (existsSync(defectsPath)) {
      try {
        const lines = readFileSync(defectsPath, "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0);
        unresolvedDefectCount = lines.length;
      } catch {
        // ignore
      }
    }

    const telemetry: StagnationTelemetry = {
      agentId: "mind-1",
      conversationId: options?.conversationId,
      role: "mind",
      idleDurationSeconds,
      pendingBacklogCount,
      pendingPlanCount: 0,
      unresolvedDefectCount,
      lastActiveTimestamp: new Date(lastActiveMs).toISOString(),
    };

    let injectionPrompt: string | undefined;
    let defectCreated = false;

    if (stagnant) {
      injectionPrompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: repoRoot,
        domain: "skill-framework",
        defect: {
          error_code: "LIVE_STAGNATION_DETECTED",
          title: "Tier 0 Mind Stagnation Detected (>120s Idle)",
          description: `Tier 0 Mind has been idle for ${idleDurationSeconds}s (threshold: ${threshold}s). Mode ${pendingBacklogCount === 0 ? "A" : "B"} injection synthesized.`,
          actor: "mind-auditor",
          context: {
            idleDurationSeconds,
            pendingBacklogCount,
            unresolvedDefectCount,
            conversationId: options?.conversationId,
          },
        },
      });
      defectCreated = true;
    }

    const updatedCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: cursor.lastInspectedEventIndex,
      lastAuditTimestamp: nowIso,
    };
    AuditorCursorStore.saveCursor(repoRoot, "mind", updatedCursor);

    return {
      stagnant,
      idleDurationSeconds,
      telemetry,
      injectionPrompt,
      defectCreated,
      cursor: updatedCursor,
      timestamp: nowIso,
    };
  }
}

export class SkillAuditorEngine {
  public static auditSkillCompliance(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      capsuleRunRoot?: string | undefined;
      logDefects?: boolean | undefined;
      now?: string | undefined;
    },
  ): SkillAuditLiveResult {
    const cursor = options?.cursor ?? AuditorCursorStore.loadCursor(repoRoot, "skill");
    const nowIso = options?.now ?? new Date().toISOString();
    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let maxEventSeq = cursor.lastInspectedEventIndex;

    // Scan delta events in run or telemetry
    const runRoot = options?.capsuleRunRoot;
    if (runRoot && existsSync(join(runRoot, "events.jsonl"))) {
      try {
        const lines = readFileSync(join(runRoot, "events.jsonl"), "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0);
        for (let i = 0; i < lines.length; i++) {
          if (i <= cursor.lastInspectedEventIndex) continue;
          eventsAnalyzed++;
          maxEventSeq = Math.max(maxEventSeq, i);
          const evt = JSON.parse(lines[i]!) as Record<string, unknown>;
          // Forensics invariant checks on delta events
          if (
            evt["type"] === "boundary_violation" ||
            evt["error_code"] === "ROLE_BOUNDARY_DEVIATION"
          ) {
            const desc = String(evt["message"] || "Role boundary deviation in event stream");
            const rec = "Ensure supervisor roles execute zero direct file edits or test commands";
            incidents.push({
              id: `inc-${Date.now()}-${i}`,
              category: "ROLE_BOUNDARY_DEVIATION",
              severity: "CRITICAL",
              title: `Skill Compliance Incident: ROLE_BOUNDARY_DEVIATION`,
              description: desc,
              observation: desc,
              remediation: rec,
              recommendation: rec,
              timestamp: String(evt["timestamp"] || nowIso),
              evidence:
                typeof evt["command_id"] === "string"
                  ? { command_id: evt["command_id"] }
                  : undefined,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    let defectsLogged = 0;
    if (options?.logDefects !== false) {
      for (const inc of incidents) {
        SplitChannelDefectRouter.routeDefect({
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
        defectsLogged++;
      }
    }

    const updatedCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: maxEventSeq,
      lastAuditTimestamp: nowIso,
    };
    AuditorCursorStore.saveCursor(repoRoot, "skill", updatedCursor);

    return {
      compliant: incidents.length === 0,
      incidents,
      defectsLogged,
      cursor: updatedCursor,
      eventsAnalyzed,
      timestamp: nowIso,
    };
  }
}
