import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { durableAppendBytes } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/index.ts";
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

const MAX_CAUSE_LENGTH = 240;

function bounded(value: string): string {
  return value.length <= MAX_CAUSE_LENGTH ? value : `${value.slice(0, MAX_CAUSE_LENGTH - 1)}…`;
}

/**
 * Formats only primitive values or an own data `message` property. This avoids
 * invoking user-provided getters, toJSON, Symbol.toPrimitive, or toString while
 * reporting failures from untrusted defect contexts.
 */
function safeCause(error: unknown): string {
  if (typeof error === "string") return bounded(error);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return bounded(String(error));
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string")
      return bounded(descriptor.value);
  } catch {

  }
  return "unknown error";
}

export class SplitChannelDefectRouter {
  public static routeDefect(options: RouteDefectOptions): DefectRouteResult {
    let targetDefectsPath = "unresolved defects ledger";
    try {
      const isMothership = options.domain === "skill-framework";
      const targetRepoRoot = isMothership
        ? resolve(resolveSkillHomeRepo())
        : resolve(options.currentRepoRoot);
      targetDefectsPath = resolveDefectsPath(targetRepoRoot);
      const contextSupplied = options.defect.context !== undefined;
      const record = {
        id: options.defect.id ?? `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        domain: options.domain,
        error_code: options.defect.error_code,
        title: options.defect.title,
        description: options.defect.description,
        actor: options.defect.actor ?? "unknown",
        timestamp: options.defect.timestamp ?? new Date().toISOString(),
        source_repo: resolve(options.currentRepoRoot),
        ...(contextSupplied ? { context: options.defect.context } : {}),
      };

      const serialized = JSON.stringify(record);
      if (contextSupplied && !Object.hasOwn(JSON.parse(serialized) as object, "context")) {
        throw new HarnessError("INTEGRITY", "Supplied defect context was omitted by serialization");
      }
      const line = serialized + "\n";
      mkdirSync(dirname(targetDefectsPath), { recursive: true });
      durableAppendBytes(targetDefectsPath, new TextEncoder().encode(line));

      const feedbackQueuePath = join(targetRepoRoot, ".olt", "feedback-queue.jsonl");
      const feedbackRecord = {
        id: `fb-${record.id}`,
        title: record.title,
        description: record.description,
        source: "skill-auditor",
        category: "defect",
        priority: 100,
        admitted: false,
        created_at: record.timestamp,
      };
      try {
        if (existsSync(dirname(feedbackQueuePath))) {
          durableAppendBytes(
            feedbackQueuePath,
            new TextEncoder().encode(JSON.stringify(feedbackRecord) + "\n"),
          );
        }
      } catch {}

      return { targetRepoRoot, targetDefectsPath, isMothership, routed: true };
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `SplitChannelDefectRouter failed to durably route a defect to '${targetDefectsPath}': ${safeCause(error)}`,
      );
    }
  }
}
