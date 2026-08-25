import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveDefectsPath, resolveSkillHomeRepo } from "../core/shared/paths.ts";

export type DefectDomain = "project" | "skill-framework";

export interface RouteDefectOptions {
  readonly currentRepoRoot: string;
  readonly domain: DefectDomain;
  readonly defect: {
    readonly id?: string | undefined;
    readonly error_code: string;
    readonly title: string;
    readonly description: string;
    readonly actor?: string | undefined;
    readonly timestamp?: string | undefined;
    readonly context?: Record<string, unknown> | undefined;
  };
}

export interface DefectRouteResult {
  readonly targetRepoRoot: string;
  readonly targetDefectsPath: string;
  readonly isMothership: boolean;
  readonly routed: boolean;
  readonly lastError?: string;
}

export class SplitChannelDefectRouter {
  public static routeDefect(options: RouteDefectOptions): DefectRouteResult {
    const homeRepo = resolveSkillHomeRepo(options.currentRepoRoot);
    const isSkillFramework = options.domain === "skill-framework";

    let targetRepoRoot = isSkillFramework ? homeRepo : resolve(options.currentRepoRoot);
    let isMothership = isSkillFramework;
    let targetDefectsPath = resolveDefectsPath(targetRepoRoot);

    const record = {
      id: options.defect.id ?? `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      domain: options.domain,
      error_code: options.defect.error_code,
      title: options.defect.title,
      description: options.defect.description,
      actor: options.defect.actor ?? "unknown",
      timestamp: options.defect.timestamp ?? new Date().toISOString(),
      source_repo: resolve(options.currentRepoRoot),
      ...(options.defect.context ? { context: options.defect.context } : {}),
    };

    const line = JSON.stringify(record) + "\n";
    let routed = false;
    let lastError: string | undefined;

    try {
      const dir = dirname(targetDefectsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(targetDefectsPath, line, "utf-8");
      routed = true;
    } catch (primaryWriteError) {
      // If writing to mothership failed, gracefully fall back to local project defects ledger
      console.error(
        `SplitChannelDefectRouter: failed to append defect to ${targetDefectsPath}`,
        primaryWriteError,
      );
      lastError =
        primaryWriteError instanceof Error ? primaryWriteError.message : String(primaryWriteError);
      if (isSkillFramework && targetRepoRoot !== resolve(options.currentRepoRoot)) {
        targetRepoRoot = resolve(options.currentRepoRoot);
        isMothership = false;
        targetDefectsPath = resolveDefectsPath(targetRepoRoot);
        try {
          const dir = dirname(targetDefectsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          appendFileSync(targetDefectsPath, line, "utf-8");
          routed = true;
        } catch (fallbackWriteError) {
          console.error(
            `SplitChannelDefectRouter: failed to append defect to ${targetDefectsPath}`,
            fallbackWriteError,
          );
          lastError =
            fallbackWriteError instanceof Error
              ? fallbackWriteError.message
              : String(fallbackWriteError);
          routed = false;
        }
      }
    }

    return {
      targetRepoRoot,
      targetDefectsPath,
      isMothership,
      routed,
      ...(routed ? {} : lastError !== undefined ? { lastError } : {}),
    };
  }
}
