import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ErrorCode } from "../core/errors/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { resolveSkillHomeRepo } from "../core/index.ts";

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

export interface MindInitializationOptions {
  readonly mindId?: string | undefined;
  readonly generation?: number | undefined;
  readonly runRoot?: string | undefined;
  readonly charterSourcePath?: string | undefined;
  readonly pendingBacklogCount?: number | undefined;
  readonly mode?: "A" | "B" | undefined;
}

export interface RoleInitializationOptions {
  readonly agentId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly taskId?: string | undefined;
  readonly mode?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SubagentSystemPromptOptions {
  readonly customInstructions?: string | undefined;
  readonly policyPath?: string | undefined;
}

export interface SubagentDispatchPromptOptions {
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly exactAnchorBriefing?: string | undefined;
}

export class VerbatimRoleInjector {
  public static resolveManifestPath(repoRoot: string, role: string): string {
    const candidates = [
      join(repoRoot, "olt", "agents", `${role}.yaml`),
      join(repoRoot, "olt", "agents", `${role}.yml`),
      join(repoRoot, "agents", `${role}.yaml`),
      join(repoRoot, "agents", `${role}.yml`),
      join(homedir(), ".agents", "skills", "olt", "agents", `${role}.yaml`),
      join(homedir(), ".agents", "skills", "olt", "agents", `${role}.yml`),
      join(resolveSkillHomeRepo(repoRoot), "olt", "agents", `${role}.yaml`),
      join(resolveSkillHomeRepo(repoRoot), "olt", "agents", `${role}.yml`),
      resolve(import.meta.dir, "../../../agents", `${role}.yaml`),
      resolve(import.meta.dir, "../../../agents", `${role}.yml`),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return resolve(p);
    }
    throw new HarnessError(
      "NOT_FOUND",
      `Agent manifest for role '${role}' not found at candidates: ${candidates.join(", ")}`,
    );
  }

  public static loadVerbatimManifestContent(repoRoot: string, role: string): string {
    const p = this.resolveManifestPath(repoRoot, role);
    return readFileSync(p, "utf-8");
  }

  private static loadOwnerMindCharter(
    repoRoot: string,
  ): { readonly filename: string; readonly content: string } | undefined {
    for (const filename of ["charter.yaml", "charter.yml"]) {
      const path = join(repoRoot, ".olt", filename);
      if (existsSync(path)) return { filename, content: readFileSync(path, "utf-8") };
    }
    return undefined;
  }

  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string {
    const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);
    const ownerCharter = role === "mind" ? this.loadOwnerMindCharter(repoRoot) : undefined;
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

${
  ownerCharter
    ? `================================================================================
=== OWNER MIND CHARTER (.olt/${ownerCharter.filename}) ===
================================================================================
${ownerCharter.content}
`
    : ""
}
================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/${role}.yaml) ===
================================================================================
${manifestContent}
================================================================================
Execute your verbatim role instructions immediately.`;
  }

  public static buildMindInitializationPrompt(
    repoRoot: string,
    options: MindInitializationOptions = {},
  ): string {
    const manifestContent = this.loadVerbatimManifestContent(repoRoot, "mind");
    const pendingCount = options.pendingBacklogCount ?? 0;
    const isModeA = options.mode !== undefined ? options.mode === "A" : pendingCount === 0;

    const mandateHeader = isModeA
      ? "MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE (Backlog Queue Empty)"
      : "MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE";

    const instructions = isModeA
      ? `INITIALIZATION DIRECTIVES:
1. Autonomously wake from olt/agents/mind.yaml without human prompts or instructions.
2. Observe active system health, doctor reports, and candidate queues.
3. If feedback queue is empty (0 pending items), execute Mode A autonomous discovery:
   - Scan codebase for TypeScript \`any\` or compiler suppression violations.
   - Audit unfulfilled Charter goals and historical blunders in .olt/defects.jsonl.
   - Admit new self-evolution candidate tasks via \`mind:admit\` with Brent Work/Span ($P = W/S$) analysis.
4. Atomically convert admitted candidates to dispatched tasks with 1:1 isolated implementer-validator allocations.
5. Operate indefinitely as an infinite autonomous loop (\`mind:pulse\`); never exit or sit idle.`
      : `INITIALIZATION DIRECTIVES:
1. Autonomously wake from olt/agents/mind.yaml without human prompts or instructions.
2. Ingest ${pendingCount} pending backlog items from feedback-queue.jsonl and evaluate against 6 Admission Gates.
3. Calculate Brent Work/Span concurrency $P = \\lceil W / S \\rceil$ and dispatch disjoint lanes in parallel.
4. Direct Tier 1 Orchestrator exclusively; enforce 1:1 isolated task allocations (Anti-Batching Rule).
5. Supervise active execution runs and enforce 1-hop micro-cycle repairs.`;

    const mindId = options.mindId ?? "unknown";
    const generation = options.generation ?? 1;
    const runRoot = options.runRoot ? ` | Capsule Root: ${options.runRoot}` : "";
    const charterSource = options.charterSourcePath
      ? ` | Charter Source: ${options.charterSourcePath}`
      : "";

    return `[MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]
================================================================================
CRITICAL SUPERVISORY INITIALIZATION: Mind Autonomous Consciousness Ignition
Mind ID: ${mindId} | Generation: ${generation}${runRoot}${charterSource}
================================================================================

${mandateHeader}

${instructions}

================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===
================================================================================
${manifestContent}
================================================================================
Execute your verbatim role instructions immediately.`;
  }

  public static buildInitializationPrompt(
    repoRoot: string,
    role: string,
    options: RoleInitializationOptions = {},
  ): string {
    if (role === "mind") {
      return this.buildMindInitializationPrompt(repoRoot, {
        mindId: options.agentId,
        runRoot: options.runRoot,
        mode: options.mode === "A" || options.mode === "B" ? options.mode : undefined,
      });
    }

    const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);
    const agentId = options.agentId ?? `${role}-1`;
    const runRoot = options.runRoot ? ` | Capsule Root: ${options.runRoot}` : "";
    const taskId = options.taskId ? ` | Task: ${options.taskId}` : "";

    return `[ROLE_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]
================================================================================
SUPERVISORY ROLE INITIALIZATION: ${role.toUpperCase()}
Agent ID: ${agentId}${runRoot}${taskId}
================================================================================

================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/${role}.yaml) ===
================================================================================
${manifestContent}
================================================================================
Execute your verbatim role instructions immediately.`;
  }

  public static buildSubagentSystemPrompt(
    repoRoot: string,
    role: string,
    options: SubagentSystemPromptOptions = {},
  ): string {
    const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);
    const extraInstructions = options.customInstructions
      ? `\n\nADDITIONAL INSTRUCTIONS:\n${options.customInstructions}`
      : "";

    return `[SUBAGENT_VERBATIM_SYSTEM_PROMPT: ${role.toUpperCase()}]
================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/${role}.yaml) ===
================================================================================
${manifestContent}
================================================================================${extraInstructions}
You must strictly execute within your declared role boundaries, permissions, and invariants.`;
  }

  public static buildSubagentDispatchPrompt(
    repoRoot: string,
    role: string,
    taskPrompt: string,
    options: SubagentDispatchPromptOptions = {},
  ): string {
    const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);
    const agentId = options.agentId ?? `${role}-worker`;
    const taskId = options.taskId ? ` | Task: ${options.taskId}` : "";
    const runRoot = options.runRoot ? ` | Capsule Root: ${options.runRoot}` : "";
    const writeScope =
      options.writeScope && options.writeScope.length > 0
        ? `\nASSIGNED WRITE SCOPE:\n${options.writeScope.map((s) => `- ${s}`).join("\n")}`
        : "";
    const anchorBriefing = options.exactAnchorBriefing
      ? `\n\nEXACT-ANCHOR BRIEFING:\n${options.exactAnchorBriefing}`
      : "";

    return `[SUBAGENT_DISPATCH_MANDATE: ${role.toUpperCase()}]
================================================================================
DISPATCH COORDINATES: Agent: ${agentId}${taskId}${runRoot}
================================================================================
TASK PROMPT:
${taskPrompt}${writeScope}${anchorBriefing}

================================================================================
=== VERBATIM ROLE MANIFEST (olt/agents/${role}.yaml) ===
================================================================================
${manifestContent}
================================================================================
Execute your verbatim role instructions and task requirements immediately.`;
  }
}
