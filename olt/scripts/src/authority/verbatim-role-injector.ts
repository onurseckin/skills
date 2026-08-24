import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ErrorCode } from "../core/errors/codes.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

export interface StagnationTelemetry {
  readonly agentId: string;
  readonly conversationId?: string | undefined;
  readonly role: string;
  readonly idleDurationSeconds: number;
  readonly pendingBacklogCount: number;
  readonly pendingPlanCount: number;
  readonly unresolvedDefectCount: number;
  readonly lastActiveTimestamp?: string | undefined;
}

export class VerbatimRoleInjector {
  public static resolveManifestPath(repoRoot: string, role: string): string {
    const candidates = [
      join(repoRoot, "olt", "agents", `${role}.yaml`),
      join(repoRoot, "olt", "agents", `${role}.yml`),
      join(repoRoot, "agents", `${role}.yaml`),
      join(repoRoot, "agents", `${role}.yml`),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return resolve(p);
    }
    throw new HarnessError(
      // Bridge incompatible ErrorCode union with SSoT NOT_FOUND code
      "NOT_FOUND" as unknown as ErrorCode,
      `Agent manifest for role '${role}' not found at candidates: ${candidates.join(", ")}`,
    );
  }

  public static loadVerbatimManifestContent(repoRoot: string, role: string): string {
    const p = this.resolveManifestPath(repoRoot, role);
    return readFileSync(p, "utf-8");
  }

  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string {
    const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);
    const isModeA = role === "mind" && telemetry.pendingBacklogCount === 0;

    const mandateHeader = isModeA
      ? "MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE (Backlog Queue Empty)"
      : "MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE";

    const instructions = isModeA
      ? `You have been stagnant/idle for ${telemetry.idleDurationSeconds}s with an empty backlog.
Under Plan 20 and AGENTS.md, you MUST NOT remain idle or terminate.
IMMEDIATE MANDATES:
1. Execute non-idle creative task discovery across the codebase.
2. Scan for TypeScript \`any\` or compiler suppression violations.
3. Audit Charter invariants, historical blunders in .olt/defects.jsonl, and edge case resilience.
4. Admit new self-evolution candidate tasks via \`mind:admit\` with Brent Work/Span ($P = W/S$) analysis.
5. Never pause admitted tasks; dispatch immediately to Orchestrators.`
      : `You have been stagnant/idle for ${telemetry.idleDurationSeconds}s with ${telemetry.pendingBacklogCount} pending backlog items.
IMMEDIATE MANDATES:
1. Decompose and admit pending backlog items into execution waves.
2. Calculate Brent concurrency $P = \\lceil W / S \\rceil$ and dispatch disjoint lanes in parallel.
3. Supervise active runs and enforce 1-hop micro-cycle repairs.`;

    return `[LIVE_STAGNATION_WAKEUP_INJECTION]
================================================================================
CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>120s Idle)
Role: ${telemetry.role} | Agent: ${telemetry.agentId} | Idle Duration: ${telemetry.idleDurationSeconds}s
Pending Backlog: ${telemetry.pendingBacklogCount} | Unresolved Defects: ${telemetry.unresolvedDefectCount}
================================================================================

${mandateHeader}

${instructions}

================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/${role}.yaml) ===
================================================================================
${manifestContent}
================================================================================
Execute your verbatim role instructions immediately.`;
  }
}
