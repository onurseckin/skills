import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCapsulesDir } from "../../../core/shared/paths.ts";
import { readLastPulse } from "../../lifecycle/pulse/index.ts";
import { auditMindPulseHelper } from "./pulse-auditor.ts";
import type { AuditorCursor, MindAuditLiveResult } from "./types.ts";

export class MindAuditorEngine {
  private static activeMindGrant(capsulePath: string): { actor: string } | null {
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
    } catch {
      // A malformed or absent capsule is not native liveness evidence.
    }
    return null;
  }

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

  public static resolveActiveMindGrant(
    repoRoot: string,
    capsuleRunRoot?: string | undefined,
  ): { actor: string } | null {
    const candidates: string[] = [];
    if (capsuleRunRoot && existsSync(capsuleRunRoot)) candidates.push(capsuleRunRoot);
    candidates.push(repoRoot);
    const capsulesDir = resolveCapsulesDir(repoRoot);
    for (const parent of [capsulesDir, join(repoRoot, ".capsules")]) {
      if (!existsSync(parent)) continue;
      try {
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) candidates.push(join(parent, entry.name));
        }
      } catch {
        // A missing legacy capsule directory is non-fatal.
      }
    }
    for (const candidate of candidates) {
      const grant = this.activeMindGrant(candidate);
      if (grant) return grant;
    }
    return null;
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
    return auditMindPulseHelper(repoRoot, options);
  }
}
