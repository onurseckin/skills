import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { inferRoleFromAgentId, matchesBoundaryPrefix } from "../../authority/index.ts";
import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

export interface AgentCanonicalAlignmentOptions {
  readonly repoRoot?: string | undefined;
  readonly activeAgents?: readonly unknown[] | undefined;
  readonly agentDefinitions?: readonly unknown[] | undefined;
}

export interface AgentDefinitionInput {
  readonly id?: string | undefined;
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly prompt?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly instructions?: string | undefined;
  readonly tools?: Record<string, unknown> | readonly string[] | undefined;
  readonly invariants?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly flags?: readonly string[] | undefined;
  readonly enable_write_tools?: boolean | undefined;
  readonly can_execute_shell?: boolean | undefined;
  readonly enable_shell?: boolean | undefined;
  readonly [key: string]: unknown;
}

export const CORE_CANONICAL_ROLES = [
  "validator",
  "implementer",
  "coordinator",
  "orchestrator",
  "mind",
] as const;

export function resolveAgentsDirectory(repoRoot?: string): string {
  if (repoRoot) {
    const dotOlt = join(repoRoot, ".olt", "agents");
    if (existsSync(dotOlt)) return dotOlt;
  }
  const globalSkills = join(homedir(), ".agents", "skills", "olt", "agents");
  if (existsSync(globalSkills)) return globalSkills;
  return join(process.cwd(), ".olt", "agents");
}

export function loadCanonicalContract(
  repoRoot: string | undefined,
  role: string,
): Record<string, unknown> | null {
  const filePath = join(resolveAgentsDirectory(repoRoot), `${role}.yaml`);
  if (!existsSync(filePath)) return null;
  try {
    return (yaml.load(readFileSync(filePath, "utf-8")) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function checkValidatorPrompt(prompt: string): string | null {
  if (!prompt || !prompt.trim()) return null;
  const neg = /(?:must\s+not|never|prohibited|ban|banned|zero|0\s+commands?|do\s+not|forbidden)/i;
  if (/\bbun\s+test\b/i.test(prompt) && !neg.test(prompt)) {
    return "Cognitive validator must not be instructed to run 'bun test' or terminal test commands";
  }
  if (
    /\b(?:run|execute)\s+(?:arbitrary\s+)?(?:terminal\s+)?tests?\b/i.test(prompt) &&
    !neg.test(prompt)
  ) {
    return "Cognitive validator must not be instructed to execute terminal test commands";
  }
  return null;
}

function checkValidatorTools(agent: AgentDefinitionInput): readonly string[] {
  const violations: string[] = [];
  const tools = agent.tools;
  let writeDisabled = agent.enable_write_tools === false;
  let shellAllowed = agent.can_execute_shell === true || agent.enable_shell === true;

  if (Array.isArray(tools)) {
    const names = tools.map(String);
    if (names.some((t) => ["run_command", "bash", "terminal", "shell", "run:exec"].includes(t)))
      shellAllowed = true;
  } else if (tools && typeof tools === "object") {
    const t = tools as Record<string, unknown>;
    if (t.enable_write_tools === false || t.write_tools === false) writeDisabled = true;
    if (
      t.enable_shell === true ||
      t.shell === true ||
      t.terminal === true ||
      t.can_execute_shell === true
    )
      shellAllowed = true;
  }

  if (writeDisabled)
    violations.push("Write tools must remain mechanically enabled for CLI operations");
  if (shellAllowed) violations.push("Shell execution must be restricted for cognitive validators");
  return violations;
}

function checkValidatorInvariants(agent: AgentDefinitionInput): string | null {
  const all = [...(agent.invariants ?? []), ...(agent.tags ?? []), ...(agent.flags ?? [])].map(
    String,
  );
  return all.includes("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK")
    ? null
    : "Invariant flag 'COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK' must be present";
}

export function checkAgentCanonicalAlignment(
  options?: AgentCanonicalAlignmentOptions,
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const repoRoot = options?.repoRoot;
  const raw = [...(options?.agentDefinitions ?? []), ...(options?.activeAgents ?? [])];
  const agentsToCheck: AgentDefinitionInput[] = raw
    .map((item) =>
      typeof item === "string" ? { id: item.trim() } : (item as AgentDefinitionInput),
    )
    .filter(Boolean);

  if (agentsToCheck.length === 0) {
    for (const role of CORE_CANONICAL_ROLES) {
      if (!loadCanonicalContract(repoRoot, role)) {
        findings.push({
          code: "CANONICAL_DEFINITION_MISALIGNMENT",
          severity: "ERROR",
          engine: "checkAgentCanonicalAlignment",
          message: `Agent '${role}' definition deviates from canonical YAML contract: Canonical contract 'olt/agents/${role}.yaml' not found`,
          details: {
            agentId: role,
            role,
            reason: `Canonical contract 'olt/agents/${role}.yaml' not found`,
            canonicalContract: `olt/agents/${role}.yaml`,
          },
        });
      }
    }
    return {
      engine: "checkAgentCanonicalAlignment",
      passed: computeDoctorEnginePassed(findings),
      findings,
    };
  }

  for (const agent of agentsToCheck) {
    const agentId = String(
      agent.id ?? agent.agentId ?? agent.agent_id ?? agent.name ?? "unknown-agent",
    );
    let role = typeof agent.role === "string" ? agent.role : "";
    if (!role) {
      role = inferRoleFromAgentId(agentId) ?? "";
    }

    if (matchesBoundaryPrefix(role, "validator")) {
      const prompt = String(
        agent.systemPrompt ?? agent.prompt ?? agent.system_prompt ?? agent.instructions ?? "",
      );
      const promptErr = checkValidatorPrompt(prompt);
      const toolErrs = checkValidatorTools(agent);
      const invErr = checkValidatorInvariants(agent);
      const reasons = [...(promptErr ? [promptErr] : []), ...toolErrs, ...(invErr ? [invErr] : [])];

      for (const reason of reasons) {
        findings.push({
          code: "CANONICAL_DEFINITION_MISALIGNMENT",
          severity: "ERROR",
          engine: "checkAgentCanonicalAlignment",
          message: `Agent '${agentId}' definition deviates from canonical YAML contract: ${reason}`,
          details: {
            agentId,
            role,
            reason,
            canonicalContract: `olt/agents/${role}.yaml`,
          },
        });
      }
    }
  }

  return {
    engine: "checkAgentCanonicalAlignment",
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}
