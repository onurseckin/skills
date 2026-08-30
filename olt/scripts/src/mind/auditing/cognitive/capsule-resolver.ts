import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCapsulesDir } from "../../../core/index.ts";
import { readLastPulse } from "../../lifecycle/pulse/index.ts";

export function activeMindGrant(capsulePath: string): { actor: string } | null {
  try {
    const state = JSON.parse(readFileSync(join(capsulePath, "state.json"), "utf-8")) as unknown;
    if (!state || typeof state !== "object") return null;
    const agents = (state as Record<string, unknown>)["agents"];
    if (!Array.isArray(agents)) return null;
    for (const agent of agents) {
      if (!agent || typeof agent !== "object") continue;
      const record = agent as Record<string, unknown>;
      if (
        record["status"] === "active" &&
        record["role"] === "mind" &&
        typeof record["id"] === "string" &&
        record["id"].trim().length > 0
      ) {
        return { actor: record["id"] };
      }
    }
  } catch {}
  return null;
}

export function activePulse(
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
    const deadlineMs = typeof deadlineAt === "string" ? new Date(deadlineAt).getTime() : Number.NaN;
    if (typeof actor !== "string" || actor.length === 0 || !Number.isFinite(deadlineMs))
      return null;
    return deadlineMs > nowMs ? { actor, deadlineMs } : null;
  } catch {
    return null;
  }
}

export function resolveActivePulse(
  repoRoot: string,
  nowMs: number,
  capsuleRunRoot?: string,
): { actor: string; deadlineMs: number } | null {
  if (capsuleRunRoot && existsSync(capsuleRunRoot)) {
    const pulse = activePulse(capsuleRunRoot, nowMs);
    if (pulse) return pulse;
  }

  const capsulesDir = resolveCapsulesDir(repoRoot);
  if (!existsSync(capsulesDir)) return null;

  try {
    const entries = readdirSync(capsulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pulse = activePulse(join(capsulesDir, entry.name), nowMs);
      if (pulse) return pulse;
    }
  } catch {}
  return null;
}

export function resolveActiveMindGrant(
  repoRoot: string,
  capsuleRunRoot?: string,
): { actor: string } | null {
  if (capsuleRunRoot && existsSync(capsuleRunRoot)) {
    const grant = activeMindGrant(capsuleRunRoot);
    if (grant) return grant;
  }

  const capsulesDir = resolveCapsulesDir(repoRoot);
  if (!existsSync(capsulesDir)) return null;

  try {
    const entries = readdirSync(capsulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const grant = activeMindGrant(join(capsulesDir, entry.name));
      if (grant) return grant;
    }
  } catch {}
  return null;
}

export function resolveLatestCapsule(repoRoot: string): string | null {
  const capsulesDir = resolveCapsulesDir(repoRoot);
  if (!existsSync(capsulesDir)) return null;

  try {
    const entries = readdirSync(capsulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));

    if (entries.length === 0) return null;
    return join(capsulesDir, entries[0]!);
  } catch {
    return null;
  }
}

export function resolveLatestPulseTimestamp(
  repoRoot: string,
  capsuleRunRoot?: string,
): number | null {
  const candidates: string[] = [];
  if (capsuleRunRoot && existsSync(capsuleRunRoot)) {
    candidates.push(capsuleRunRoot);
  }
  const latest = resolveLatestCapsule(repoRoot);
  if (latest && existsSync(latest)) {
    candidates.push(latest);
  }
  candidates.push(repoRoot);

  for (const targetCapsule of candidates) {
    try {
      const lastPulse = readLastPulse(targetCapsule);
      if (lastPulse && typeof lastPulse.at === "string") {
        const ms = new Date(lastPulse.at).getTime();
        if (Number.isFinite(ms)) return ms;
      }
    } catch {}
  }
  return null;
}
