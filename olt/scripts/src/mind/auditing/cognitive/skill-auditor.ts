const SKILL_AUDIT_FORENSICS_CATEGORIES: ReadonlySet<RootCauseCategory> = new Set([
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
]);

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeRunForensics,
  type ForensicsIncident,
  type RootCauseCategory,
} from "../meta/index.ts";
import {
  resolveBacklogPath,
  resolveCapsulesDir,
  resolveSkillHomeRepo,
  resolveDefectsPath,
} from "../../../core/shared/paths.ts";
import { dispatchPeerMessage } from "../../../communication/mailbox/index.ts";
import { SplitChannelDefectRouter } from "../../../reporting/split-channel-defect-router.ts";
import { AuditorCursorStore } from "./cursor.ts";
import type { AuditorCursor, SkillAuditLiveResult } from "./types.ts";

export class SkillAuditorEngine {
  /**
   * Every capsule this repo can see, used when the caller omits --run. Omitting --run asks for
   * the default scope, not zero scope (see skill-audit-live.ts / cli-capabilities.md); mirrors
   * MindAuditorEngine.resolveLatestPulseTimestamp's own repoRoot / .olt/capsules / .capsules walk.
   */
  private static discoverCapsuleRoots(repoRoot: string): string[] {
    const roots = new Set<string>();
    const addIfCapsule = (p: string): void => {
      if (existsSync(join(p, "events.jsonl"))) roots.add(resolve(p));
    };

    addIfCapsule(repoRoot);

    const capsulesDir = resolveCapsulesDir(repoRoot);
    if (existsSync(capsulesDir)) {
      try {
        for (const entry of readdirSync(capsulesDir, { withFileTypes: true })) {
          if (entry.isDirectory()) addIfCapsule(join(capsulesDir, entry.name));
        }
      } catch {

      }
    }

    const dotCapsules = join(repoRoot, ".capsules");
    if (existsSync(dotCapsules) && dotCapsules !== capsulesDir) {
      try {
        for (const entry of readdirSync(dotCapsules, { withFileTypes: true })) {
          if (entry.isDirectory()) addIfCapsule(join(dotCapsules, entry.name));
        }
      } catch {

      }
    }

    return [...roots];
  }

  /**
   * TOKEN_BURNING / FALSE_SERIALIZATION / ROLE_BOUNDARY_DEVIATION are cross-event heuristics
   * (read/write ratios, task write-scope overlap, agent-role-vs-tool-call mismatches); no single
   * event line carries any of them as a tag, so per-line predicate matching against evt.type /
   * evt.error_code / evt.kind can never fire -- `type` and `error_code` are not keys the harness
   * event envelope has at all, and `kind` never carries these values (verified against 1241 live
   * events across 20 capsules: 0 matches; `boundary_violation` etc. occur only as
   * DefectCategory/category values already written to defects.jsonl, never as an event
   * type/kind/error_code). analyzeRunForensics is the engine orchestrator/companion-auditor.ts
   * already trusts to derive these same three categories from real tool-call and task-state
   * signal; reuse it instead of re-deriving a second, structurally-unreachable copy.
   */
  private static scanCapsuleForIncidents(
    capsuleRoot: string,
    cursor: AuditorCursor,
    nowIso: string,
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
          if (i <= cursor.lastInspectedEventIndex) continue;
          eventsAnalyzed++;
          maxEventSeq = Math.max(maxEventSeq, i);
        }
      } catch {

      }
    }

    const incidents = hasEvents
      ? analyzeRunForensics({ runRoot: capsuleRoot, inject: false }).incidents.filter((inc) =>
          SKILL_AUDIT_FORENSICS_CATEGORIES.has(inc.category),
        )
      : [];

    const updatedCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: maxEventSeq,
      lastAuditTimestamp: nowIso,
    };

    return { incidents, eventsAnalyzed, updatedCursor };
  }

  private static findActiveCoordinatorId(capsuleRoots: string[]): string | undefined {
    for (const root of capsuleRoots) {
      const statePath = join(root, "state.json");
      if (existsSync(statePath)) {
        try {
          const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
          if (raw && Array.isArray(raw.agents)) {
            const coord = raw.agents.find(
              (a: { id?: string; role?: string; status?: string }) =>
                a.status === "active" &&
                typeof a.role === "string" &&
                a.role.toLowerCase().includes("coordinator"),
            );
            if (coord && typeof coord.id === "string") return coord.id;
          }
        } catch {}
      }
    }
    return undefined;
  }

  public static dispatchInterjection(
    repoRoot: string,
    inc: ForensicsIncident,
    capsuleRoots: string[],
  ): boolean {
    const rawAgent = inc.agentId ?? inc.agent_id;
    let target = "coordinator";
    if (rawAgent && rawAgent.toLowerCase().includes("coord")) {
      target = rawAgent;
    } else {
      const activeCoord = SkillAuditorEngine.findActiveCoordinatorId(capsuleRoots);
      if (activeCoord) target = activeCoord;
    }

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
          directive: "HALT_DIRECT_EDITS_AND_DISPATCH_SUBAGENTS",
          instructions:
            "Halt direct file modifications and serial execution immediately. Coordinators are pure dispatchers (SUPERVISOR_ZERO_CODE_EDITS). You must compile the task plan and dispatch ready tasks to Tier 3 Implementers and Validators in parallel via invoke_subagent.",
          observation: inc.observation ?? inc.description,
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

  public static auditSkillCompliance(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      capsuleRunRoot?: string | undefined;
      logDefects?: boolean | undefined;
      interject?: boolean | undefined;
      now?: string | undefined;
    },
  ): SkillAuditLiveResult {
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();
    const explicitRunRoot = options !== undefined ? options.capsuleRunRoot : undefined;

    const capsuleRoots = explicitRunRoot
      ? [resolve(explicitRunRoot)]
      : SkillAuditorEngine.discoverCapsuleRoots(repoRoot);

    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let rollupMaxSeq = -1;

    for (const capsuleRoot of capsuleRoots) {
      const scopedCursor =
        options !== undefined && options.cursor !== undefined && explicitRunRoot !== undefined
          ? options.cursor
          : AuditorCursorStore.loadCursor(repoRoot, "skill", capsuleRoot);

      const scan = SkillAuditorEngine.scanCapsuleForIncidents(capsuleRoot, scopedCursor, nowIso);
      incidents.push(...scan.incidents);
      eventsAnalyzed += scan.eventsAnalyzed;
      AuditorCursorStore.saveCursor(repoRoot, "skill", scan.updatedCursor, capsuleRoot);
      if (scan.updatedCursor.lastInspectedEventIndex > rollupMaxSeq) {
        rollupMaxSeq = scan.updatedCursor.lastInspectedEventIndex;
      }
    }

    let defectsLogged = 0;
    let shouldLogDefects = true;
    if (options !== undefined && options.logDefects === false) {
      shouldLogDefects = false;
    }
    if (shouldLogDefects) {
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
        if (routeResult.routed) {
          defectsLogged++;
        }
      }
    }

    let interjectionsSent = 0;
    const shouldInterject = options === undefined || options.interject !== false;
    if (shouldInterject) {
      for (const inc of incidents) {
        if (inc.category === "FALSE_SERIALIZATION" || inc.category === "ROLE_BOUNDARY_DEVIATION") {
          const sent = SkillAuditorEngine.dispatchInterjection(repoRoot, inc, capsuleRoots);
          if (sent) interjectionsSent++;
        }
      }
    }

    const rollupCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: rollupMaxSeq,
      lastAuditTimestamp: nowIso,
    };
    AuditorCursorStore.saveCursor(repoRoot, "skill", rollupCursor);

    return {
      compliant: incidents.length === 0,
      incidents,
      defectsLogged,
      interjectionsSent,
      cursor: rollupCursor,
      eventsAnalyzed,
      timestamp: nowIso,
    };
  }
}
