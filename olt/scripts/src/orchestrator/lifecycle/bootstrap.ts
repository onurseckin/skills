import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createDefaultCollectors,
  detectActiveHost,
  isPlatformMatchingHost,
  resolveMeasuredQuotaPercentage,
  setTelemetryQuotaProvider,
  type TelemetryCollector,
} from "../../telemetry/index.ts";

let activeTelemetryCollector: TelemetryCollector | undefined;
let cachedQuotaPercentage: number | undefined;

export function setActiveTelemetryCollector(collector: TelemetryCollector | undefined): void {
  activeTelemetryCollector = collector;
}

export function getActiveTelemetryCollector(): TelemetryCollector | undefined {
  return activeTelemetryCollector;
}

export function updateCachedTelemetryQuota(quota: number | null | undefined): void {
  if (typeof quota === "number" && !Number.isNaN(quota) && Number.isFinite(quota)) {
    cachedQuotaPercentage = Math.max(0, Math.min(100, quota));
  } else if (quota === null || quota === undefined) {
    cachedQuotaPercentage = undefined;
  }
}

export function getCachedTelemetryQuota(): number | undefined {
  return cachedQuotaPercentage;
}

export function extractQuotaFromCollector(collector: unknown): number | undefined {
  if (collector === undefined || collector === null) {
    return undefined;
  }
  if (typeof collector === "function") {
    try {
      const res = (collector as () => unknown)();
      return resolveMeasuredQuotaPercentage(res);
    } catch {
      return undefined;
    }
  }
  if (typeof collector === "object") {
    const col = collector as Record<string, unknown>;
    if (typeof col["readCurrentQuota"] === "function") {
      try {
        const res = (col["readCurrentQuota"] as () => unknown)();
        const resolved = resolveMeasuredQuotaPercentage(res);
        if (resolved !== undefined) return resolved;
      } catch {
        return undefined;
      }
    }
    if (typeof col["currentQuota"] === "number") {
      return resolveMeasuredQuotaPercentage(col["currentQuota"]);
    }
    if (typeof col["quotaPercentage"] === "number") {
      return resolveMeasuredQuotaPercentage(col["quotaPercentage"]);
    }
    if (typeof col["quota"] === "number") {
      return resolveMeasuredQuotaPercentage(col["quota"]);
    }
    if (typeof col["latestQuota"] === "number") {
      return resolveMeasuredQuotaPercentage(col["latestQuota"]);
    }
    if (typeof col["getQuotaPercentage"] === "function") {
      try {
        const res = (col["getQuotaPercentage"] as () => unknown)();
        const resolved = resolveMeasuredQuotaPercentage(res);
        if (resolved !== undefined) return resolved;
      } catch {
        return undefined;
      }
    }
    if (col["latestResult"] !== undefined) {
      const resolved = resolveMeasuredQuotaPercentage(col["latestResult"]);
      if (resolved !== undefined) return resolved;
    }
    if (col["lastResult"] !== undefined) {
      const resolved = resolveMeasuredQuotaPercentage(col["lastResult"]);
      if (resolved !== undefined) return resolved;
    }
    if (col["latestReport"] !== undefined) {
      const resolved = resolveMeasuredQuotaPercentage(col["latestReport"]);
      if (resolved !== undefined) return resolved;
    }
    if (col["report"] !== undefined) {
      const resolved = resolveMeasuredQuotaPercentage(col["report"]);
      if (resolved !== undefined) return resolved;
    }
    if (Array.isArray(col["metrics"])) {
      const resolved = resolveMeasuredQuotaPercentage({ metrics: col["metrics"] });
      if (resolved !== undefined) return resolved;
    }
    return resolveMeasuredQuotaPercentage(col);
  }
  return undefined;
}

function readStorageQuotaSynchronously(): number | undefined {
  try {
    const home = homedir();
    const candidates = [
      join(home, ".gemini/antigravity-cli/state.json"),
      join(home, ".gemini/antigravity-cli/quota.json"),
      join(home, ".gemini/state.json"),
      join(home, ".gemini/quota.json"),
      join(home, ".config/antigravity/state.json"),
      join(home, ".config/antigravity/quota.json"),
      join(home, ".cursor/quota.json"),
      join(home, ".claude/usage.json"),
    ];
    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const resolved = resolveMeasuredQuotaPercentage(parsed);
        if (resolved !== undefined) return resolved;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function readCurrentQuota(): number | undefined {
  if (activeTelemetryCollector !== undefined) {
    const fromCollector = extractQuotaFromCollector(activeTelemetryCollector);
    if (fromCollector !== undefined) {
      return fromCollector;
    }
  }
  if (cachedQuotaPercentage !== undefined) {
    return cachedQuotaPercentage;
  }
  return readStorageQuotaSynchronously();
}

export async function sampleTelemetryQuota(
  collector?: TelemetryCollector,
): Promise<number | undefined> {
  let target = collector ?? activeTelemetryCollector;
  if (!target) {
    const detected = detectActiveHost();
    const activeHost = typeof detected === "string" ? detected : "unknown";
    const collectors = createDefaultCollectors();
    const matched = collectors.find((c) => isPlatformMatchingHost(c.platformId, activeHost));
    target = matched ?? collectors[0];
  }
  if (!target) return undefined;
  const result = await target.probe();
  const quota = resolveMeasuredQuotaPercentage(result);
  if (quota !== undefined) {
    updateCachedTelemetryQuota(quota);
  }
  return quota;
}

export function bootstrapTelemetryQuota(collector?: TelemetryCollector): void {
  if (collector !== undefined) {
    setActiveTelemetryCollector(collector);
  }
  setTelemetryQuotaProvider(() => readCurrentQuota());
}
