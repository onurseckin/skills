import { resolve } from "node:path";
import { resolveCompletedDefectsPath } from "../../../core/index.ts";
import { promoteResolvedDefects, type DefectEntry } from "../../../mind/defects/index.ts";
import type { AuditedDefect } from "./types.ts";

export interface PromotionResult {
  readonly promotedCount: number;
  readonly promotedDefects: string[];
}

export function handleDefectPromotion(
  allDefects: readonly AuditedDefect[],
  promoteFlag?: string,
  autoPromote?: boolean,
  completedFileFlag?: string,
  dryRun?: boolean,
): PromotionResult {
  let promotedCount = 0;
  const promotedDefects: string[] = [];

  if (autoPromote || promoteFlag !== undefined) {
    const targetCompletedFile = completedFileFlag
      ? resolve(completedFileFlag)
      : resolveCompletedDefectsPath();

    const toPromoteList: DefectEntry[] = [];
    for (const b of allDefects) {
      const matchesTarget =
        promoteFlag === undefined || promoteFlag === "all" || b.id === promoteFlag;
      if (matchesTarget && b.status === "resolved") {
        const resolution =
          typeof b.resolution === "object" && b.resolution !== null
            ? (b.resolution as unknown as DefectEntry["resolution"])
            : undefined;

        const bEntry: DefectEntry = {
          id: b.id,
          type: b.type,
          severity: b.severity as DefectEntry["severity"],
          timestamp: b.timestamp,
          pid: b.pid,
          agent_id: b.agent_id ?? undefined,
          observation: b.observation,
          remediation: b.remediation,
          context: b.context as DefectEntry["context"],
          status: b.status,
          ...(resolution !== undefined ? { resolution } : {}),
        };
        toPromoteList.push(bEntry);
      }
    }

    if (toPromoteList.length > 0 && !dryRun) {
      const promotionResult = promoteResolvedDefects(toPromoteList, {
        targetPath: targetCompletedFile,
      });
      promotedCount = promotionResult.promoted_count;
      promotedDefects.push(...promotionResult.promoted_defects.map((b) => b.id));
    } else if (toPromoteList.length > 0 && dryRun) {
      promotedCount = toPromoteList.length;
      promotedDefects.push(...toPromoteList.map((b) => b.id));
    }
  }

  return { promotedCount, promotedDefects };
}
