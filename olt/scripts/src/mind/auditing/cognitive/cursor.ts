import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOltDir } from "../../../core/shared/paths.ts";
import type { AuditorCursor, StoredAuditorCursors } from "./types.ts";

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
