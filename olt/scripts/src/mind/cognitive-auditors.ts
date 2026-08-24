import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ForensicsIncident } from "./meta-auditor.ts";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../authority/verbatim-role-injector.ts";
import {
  resolveDefectsPath,
  resolveOltDir,
  resolveBacklogPath,
  resolveCapsulesDir,
} from "../core/shared/paths.ts";
import { SplitChannelDefectRouter } from "../reporting/split-channel-defect-router.ts";
import { readLastPulse } from "./last-pulse.ts";

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
            const rawTs = rec["lastInspectedTimestamp"];
            const lastTs =
              typeof rawTs === "string" && rawTs.length > 0 ? rawTs : "1970-01-01T00:00:00.000Z";
            const rawIdx = rec["lastInspectedEventIndex"];
            const lastIdx = typeof rawIdx === "number" ? rawIdx : -1;
            const rawAuditTs = rec["lastAuditTimestamp"];
            const lastAuditTs = typeof rawAuditTs === "string" ? rawAuditTs : undefined;
            return {
              lastInspectedTimestamp: lastTs,
              lastInspectedEventIndex: lastIdx,
              lastAuditTimestamp: lastAuditTs,
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
  public static resolveLatestPulseTimestamp(
    repoRoot: string,
    capsuleRunRoot?: string | undefined,
  ): number | null {
    let latestMs: number | null = null;

    const checkCandidate = (capsulePath: string): void => {
      const pulse = readLastPulse(capsulePath);
      if (pulse && typeof pulse.at === "string") {
        const ms = new Date(pulse.at).getTime();
        if (!isNaN(ms) && ms > 0) {
          if (latestMs === null) {
            latestMs = ms;
          } else if (ms > latestMs) {
            latestMs = ms;
          }
        }
      }
    };

    // 1. Explicit capsuleRunRoot
    if (capsuleRunRoot && existsSync(capsuleRunRoot)) {
      checkCandidate(capsuleRunRoot);
    }

    // 2. repoRoot itself (in case repoRoot is a capsule directory)
    checkCandidate(repoRoot);

    // 3. Capsules directory (.olt/capsules)
    const capsulesDir = resolveCapsulesDir(repoRoot);
    if (existsSync(capsulesDir)) {
      try {
        const entries = readdirSync(capsulesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            checkCandidate(join(capsulesDir, entry.name));
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // 4. Legacy .capsules directory if distinct
    const dotCapsules = join(repoRoot, ".capsules");
    if (existsSync(dotCapsules) && dotCapsules !== capsulesDir) {
      try {
        const entries = readdirSync(dotCapsules, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            checkCandidate(join(dotCapsules, entry.name));
          }
        }
      } catch {
        // Non-fatal
      }
    }

    return latestMs;
  }

  public static auditMindPulse(
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

    // 1. Determine last activity timestamp from cursor, last pulse, or fallback
    const cursorMs = new Date(cursor.lastInspectedTimestamp).getTime();
    const cursorValid =
      !isNaN(cursorMs) &&
      cursorMs > 0 &&
      cursor.lastInspectedTimestamp !== "1970-01-01T00:00:00.000Z";

    const pulseMs = MindAuditorEngine.resolveLatestPulseTimestamp(
      repoRoot,
      options !== undefined ? options.capsuleRunRoot : undefined,
    );

    let lastActiveMs: number;
    if (cursorValid && pulseMs !== null) {
      lastActiveMs = Math.max(cursorMs, pulseMs);
    } else if (cursorValid) {
      lastActiveMs = cursorMs;
    } else if (pulseMs !== null) {
      lastActiveMs = pulseMs;
    } else {
      lastActiveMs = nowMs - (threshold + 1) * 1000; // default to threshold exceeded if never inspected and no pulse
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
            conversationId: options !== undefined ? options.conversationId : undefined,
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
    const cursor =
      options !== undefined && options.cursor !== undefined
        ? options.cursor
        : AuditorCursorStore.loadCursor(repoRoot, "skill");
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();
    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let maxEventSeq = cursor.lastInspectedEventIndex;

    // Scan delta events in run or telemetry
    const runRoot = options !== undefined ? options.capsuleRunRoot : undefined;
    if (runRoot && existsSync(join(runRoot, "events.jsonl"))) {
      try {
        const lines = readFileSync(join(runRoot, "events.jsonl"), "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0);
        for (let i = 0; i < lines.length; i++) {
          if (i <= cursor.lastInspectedEventIndex) continue;
          eventsAnalyzed++;
          maxEventSeq = Math.max(maxEventSeq, i);
          const rawLine = lines[i];
          if (rawLine === undefined) continue;
          const evt = JSON.parse(rawLine) as Record<string, unknown>;
          let isBoundaryViolation = false;
          if (evt["type"] === "boundary_violation") isBoundaryViolation = true;
          if (evt["error_code"] === "ROLE_BOUNDARY_DEVIATION") isBoundaryViolation = true;
          if (evt["kind"] === "role_boundary_deviation") isBoundaryViolation = true;

          let isTokenBurning = false;
          if (evt["type"] === "token_burning") isTokenBurning = true;
          if (evt["error_code"] === "TOKEN_BURNING") isTokenBurning = true;
          if (evt["kind"] === "token_burning") isTokenBurning = true;

          let isFalseSerialization = false;
          if (evt["type"] === "false_serialization") isFalseSerialization = true;
          if (evt["error_code"] === "FALSE_SERIALIZATION") isFalseSerialization = true;
          if (evt["kind"] === "false_serialization") isFalseSerialization = true;

          if (isBoundaryViolation) {
            const rawMsg = evt["message"];
            const desc =
              typeof rawMsg === "string" && rawMsg.length > 0
                ? rawMsg
                : "Role boundary deviation in event stream";
            const rec = "Ensure supervisor roles execute zero direct file edits or test commands";
            const rawTs = evt["timestamp"];
            const ts = typeof rawTs === "string" && rawTs.length > 0 ? rawTs : nowIso;
            incidents.push({
              id: `inc-${Date.now()}-${i}`,
              category: "ROLE_BOUNDARY_DEVIATION",
              severity: "CRITICAL",
              title: `Skill Compliance Incident: ROLE_BOUNDARY_DEVIATION`,
              description: desc,
              observation: desc,
              remediation: rec,
              recommendation: rec,
              timestamp: ts,
              evidence:
                typeof evt["command_id"] === "string"
                  ? { command_id: evt["command_id"] }
                  : undefined,
            });
          } else if (isTokenBurning) {
            const rawMsg = evt["message"];
            const desc =
              typeof rawMsg === "string" && rawMsg.length > 0
                ? rawMsg
                : "Token burning detected: excessive exploratory browsing before write";
            const rec = "Provide exact file paths and anchors to minimize exploratory tool calls";
            const rawTs = evt["timestamp"];
            const ts = typeof rawTs === "string" && rawTs.length > 0 ? rawTs : nowIso;
            incidents.push({
              id: `inc-${Date.now()}-${i}`,
              category: "TOKEN_BURNING",
              severity: "HIGH",
              title: `Skill Compliance Incident: TOKEN_BURNING`,
              description: desc,
              observation: desc,
              remediation: rec,
              recommendation: rec,
              timestamp: ts,
              evidence:
                typeof evt["details"] === "object" && evt["details"] !== null
                  ? (evt["details"] as Record<string, unknown>)
                  : undefined,
            });
          } else if (isFalseSerialization) {
            const rawMsg = evt["message"];
            const desc =
              typeof rawMsg === "string" && rawMsg.length > 0
                ? rawMsg
                : "False serialization detected: disjoint tasks executed sequentially";
            const rec = "Dispatch independent tasks concurrently in parallel waves";
            const rawTs = evt["timestamp"];
            const ts = typeof rawTs === "string" && rawTs.length > 0 ? rawTs : nowIso;
            incidents.push({
              id: `inc-${Date.now()}-${i}`,
              category: "FALSE_SERIALIZATION",
              severity: "MEDIUM",
              title: `Skill Compliance Incident: FALSE_SERIALIZATION`,
              description: desc,
              observation: desc,
              remediation: rec,
              recommendation: rec,
              timestamp: ts,
              evidence:
                typeof evt["details"] === "object" && evt["details"] !== null
                  ? (evt["details"] as Record<string, unknown>)
                  : undefined,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    let defectsLogged = 0;
    let shouldLogDefects = true;
    if (options !== undefined && options.logDefects === false) {
      shouldLogDefects = false;
    }
    if (shouldLogDefects) {
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
