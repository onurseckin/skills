import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOltDir } from "../../../core/shared/index.ts";
import type { ForensicsIncident } from "../meta/index.ts";
import type { StagnationTelemetry } from "../../../authority/verbatim-role-injector.ts";
import type { AntiStagnationResult } from "../anti-stagnation-engine.ts";

export interface AuditorCursor {
  readonly lastInspectedTimestamp: string;
  readonly lastInspectedEventIndex: number;
  readonly lastAuditTimestamp?: string | undefined;
  readonly lastStagnationSignature?: string | undefined;
}

export interface MindAuditLiveResult {
  readonly stagnant: boolean;
  readonly idleDurationSeconds: number;
  readonly telemetry: StagnationTelemetry;
  readonly remediation: "deploy_mind" | "reconcile_native_mind" | "wake_mind" | "none";
  readonly injectionPrompt?: string | undefined;
  readonly cognitiveChallengePrompt?: string | undefined;
  readonly defectCreated?: boolean | undefined;
  readonly localDefectCount: number;
  readonly parallelismProvocation?: AntiStagnationResult | undefined;
  readonly cursor: AuditorCursor;
  readonly timestamp: string;
}

export interface SkillAuditLiveResult {
  readonly compliant: boolean;
  readonly incidents: readonly ForensicsIncident[];
  readonly defectsLogged: number;
  readonly interjectionsSent?: number | undefined;
  readonly cursor: AuditorCursor;
  readonly eventsAnalyzed: number;
  readonly timestamp: string;
  readonly zero_delta?: boolean | undefined;
  readonly suppressed?: boolean | undefined;
  readonly delta_summary?: string | undefined;
}

export interface StoredAuditorCursors {
  readonly mind?: AuditorCursor | undefined;
  readonly skill?: AuditorCursor | undefined;
}

export interface SkillAuditOptions {
  readonly cursor?: AuditorCursor | undefined;
  readonly capsuleRunRoot?: string | undefined;
  readonly logDefects?: boolean | undefined;
  readonly interject?: boolean | undefined;
  readonly now?: string | undefined;
  readonly previousReport?: SkillAuditLiveResult | null | undefined;
  readonly suppressZeroDelta?: boolean | undefined;
  readonly transcripts?: readonly string[] | undefined;
}

export interface SkillZeroDeltaResult {
  readonly isZeroDelta: boolean;
  readonly eventsDelta: number;
  readonly incidentsDelta: number;
  readonly defectsDelta: number;
  readonly suppressed: boolean;
  readonly summary: string;
}

export type {
  OpticalDimension,
  OpticalViewport,
  OpticalViewportSpec,
  CognitiveUiFinding,
  ParsedUiCritique,
  ActionableDesignIteration,
  ParseCritiqueOptions,
  DesignIterationOptions,
} from "./critique-parser.ts";

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
    if (!value) return null;
    if (typeof value !== "object") return null;
    if (!("lastInspectedTimestamp" in value)) return null;
    if (!("lastInspectedEventIndex" in value)) return null;
    const rec = value as Record<string, unknown>;
    const rawTs = rec["lastInspectedTimestamp"];
    const lastTs =
      typeof rawTs === "string" && rawTs.length > 0 ? rawTs : "1970-01-01T00:00:00.000Z";
    const rawIdx = rec["lastInspectedEventIndex"];
    const lastIdx = typeof rawIdx === "number" ? rawIdx : -1;
    const rawAuditTs = rec["lastAuditTimestamp"];
    const lastAuditTs = typeof rawAuditTs === "string" ? rawAuditTs : undefined;
    const rawStagnationSignature = rec["lastStagnationSignature"];
    const lastStagnationSignature =
      typeof rawStagnationSignature === "string" ? rawStagnationSignature : undefined;
    return {
      lastInspectedTimestamp: lastTs,
      lastInspectedEventIndex: lastIdx,
      lastAuditTimestamp: lastAuditTs,
      lastStagnationSignature,
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
