import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  analyzeRunForensics,
  type ForensicsIncident,
  type RootCauseCategory,
} from "./meta-auditor.ts";
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
  private static readonly GLOBAL_SCOPE = "__global__";
  private static readonly DEFAULT_CURSOR: AuditorCursor = {
    lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
    lastInspectedEventIndex: -1,
  };

  public static resolveCursorPath(repoRoot: string): string {
    return join(resolveOltDir(repoRoot), "auditor-cursors.json");
  }

  private static parseCursorRecord(value: unknown): AuditorCursor | null {
    if (!value || typeof value !== "object") return null;
    if (!("lastInspectedTimestamp" in value) || !("lastInspectedEventIndex" in value)) return null;
    const rec = value as Record<string, unknown>;
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

  private static readAllCursors(repoRoot: string): Record<string, unknown> {
    const p = this.resolveCursorPath(repoRoot);
    if (!existsSync(p)) return {};
    try {
      const raw = readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Cursor identity is (auditorType, scopeKey) -- the observer AND what it observed. A cursor
   * keyed by auditorType alone ratchets forward against every capsule sharing that observer, so
   * a mark left on one capsule silently truncates the scan of the next one. scopeKey defaults to
   * a single shared slot only for callers that never scan capsule-relative event data.
   */
  public static loadCursor(
    repoRoot: string,
    auditorType: "mind" | "skill",
    scopeKey: string = AuditorCursorStore.GLOBAL_SCOPE,
  ): AuditorCursor {
    const allCursors = this.readAllCursors(repoRoot);
    const perType = allCursors[auditorType];
    if (perType && typeof perType === "object") {
      const parsed = this.parseCursorRecord((perType as Record<string, unknown>)[scopeKey]);
      if (parsed) return parsed;
    }
    return { ...this.DEFAULT_CURSOR };
  }

  public static saveCursor(
    repoRoot: string,
    auditorType: "mind" | "skill",
    cursor: AuditorCursor,
    scopeKey: string = AuditorCursorStore.GLOBAL_SCOPE,
  ): void {
    const p = this.resolveCursorPath(repoRoot);
    const allCursors = this.readAllCursors(repoRoot);
    const perTypeRaw = allCursors[auditorType];
    const perType: Record<string, unknown> =
      perTypeRaw && typeof perTypeRaw === "object"
        ? { ...(perTypeRaw as Record<string, unknown>) }
        : {};
    perType[scopeKey] = cursor;
    allCursors[auditorType] = perType;
    const dir = dirname(p);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(p, JSON.stringify(allCursors, null, 2) + "\n", "utf-8");
  }
}

export class MindAuditorEngine {
  private static activePulse(
    capsulePath: string,
    nowMs: number,
  ): { actor: string; deadlineMs: number } | null {
    try {
      const state = JSON.parse(readFileSync(join(capsulePath, "state.json"), "utf-8")) as unknown;
      if (!state || typeof state !== "object") return null;
      const pulse = (state as Record<string, unknown>)["pulse"];
      if (!pulse || typeof pulse !== "object") return null;
      const open = (pulse as Record<string, unknown>)["open"];
      if (!open || typeof open !== "object") return null;
      const actor = (open as Record<string, unknown>)["actor"];
      const deadlineAt = (open as Record<string, unknown>)["deadline_at"];
      const deadlineMs =
        typeof deadlineAt === "string" ? new Date(deadlineAt).getTime() : Number.NaN;
      if (typeof actor !== "string" || actor.length === 0 || !Number.isFinite(deadlineMs))
        return null;
      return deadlineMs > nowMs ? { actor, deadlineMs } : null;
    } catch {
      return null;
    }
  }

  public static resolveActivePulse(
    repoRoot: string,
    nowMs: number,
    capsuleRunRoot?: string | undefined,
  ): { actor: string; deadlineMs: number } | null {
    let active: { actor: string; deadlineMs: number } | null = null;
    const checkCandidate = (capsulePath: string): void => {
      const candidate = this.activePulse(capsulePath, nowMs);
      if (candidate && (active === null || candidate.deadlineMs > active.deadlineMs))
        active = candidate;
    };

    if (capsuleRunRoot && existsSync(capsuleRunRoot)) checkCandidate(capsuleRunRoot);
    checkCandidate(repoRoot);

    const capsulesDir = resolveCapsulesDir(repoRoot);
    for (const parent of [capsulesDir, join(repoRoot, ".capsules")]) {
      if (!existsSync(parent)) continue;
      try {
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) checkCandidate(join(parent, entry.name));
        }
      } catch {
        // Non-fatal: the latest valid active pulse from another capsule remains usable.
      }
    }
    return active;
  }

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

    // An open, unexpired pulse is an authoritative liveness lease. Its last_pulse snapshot is
    // intentionally written at pulse open and may therefore predate a long running pulse.
    const lastActiveMs = activePulse
      ? nowMs
      : pulseMs !== null
        ? pulseMs
        : nowMs - (threshold + 1) * 1000; // never pulsed => already stagnant

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
      agentId: activePulse?.actor ?? "mind-1",
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

// Skill compliance only ever routed these three of analyzeRunForensics' seven categories (the
// other four -- POLLING_WASTE, CONTEXT_OVERFLOW, GHOST_LEASE, STRAGGLER -- are the orchestrator's
// concern, not this auditor's). Kept as literal RootCauseCategory values imported from the same
// engine that defines them, never invented independently.
const SKILL_AUDIT_FORENSICS_CATEGORIES: ReadonlySet<RootCauseCategory> = new Set([
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
]);

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
        // Non-fatal
      }
    }

    const dotCapsules = join(repoRoot, ".capsules");
    if (existsSync(dotCapsules) && dotCapsules !== capsulesDir) {
      try {
        for (const entry of readdirSync(dotCapsules, { withFileTypes: true })) {
          if (entry.isDirectory()) addIfCapsule(join(dotCapsules, entry.name));
        }
      } catch {
        // Non-fatal
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
        // ignore; forensics below still runs against whatever parses
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

  public static auditSkillCompliance(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      capsuleRunRoot?: string | undefined;
      logDefects?: boolean | undefined;
      now?: string | undefined;
    },
  ): SkillAuditLiveResult {
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();
    const explicitRunRoot = options !== undefined ? options.capsuleRunRoot : undefined;

    // Mechanism (e): an omitted --run scans the default scope (every discoverable capsule),
    // never zero capsules.
    const capsuleRoots = explicitRunRoot
      ? [resolve(explicitRunRoot)]
      : SkillAuditorEngine.discoverCapsuleRoots(repoRoot);

    const incidents: ForensicsIncident[] = [];
    let eventsAnalyzed = 0;
    let rollupMaxSeq = -1;

    for (const capsuleRoot of capsuleRoots) {
      // Mechanism (c): cursor identity is (observer="skill", capsule=capsuleRoot). An explicit
      // cursor override only ever applies to the single explicitly-named capsule; auto-discovered
      // capsules always use their own persisted, capsule-scoped mark so one capsule's progress
      // can never suppress another's.
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

    const rollupCursor: AuditorCursor = {
      lastInspectedTimestamp: nowIso,
      lastInspectedEventIndex: rollupMaxSeq,
      lastAuditTimestamp: nowIso,
    };

    return {
      compliant: incidents.length === 0,
      incidents,
      defectsLogged,
      cursor: rollupCursor,
      eventsAnalyzed,
      timestamp: nowIso,
    };
  }
}
