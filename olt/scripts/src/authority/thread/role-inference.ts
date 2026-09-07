import { isAgentRole, type AgentRole } from "../../core/contracts/index.ts";

export function matchesBoundaryPrefix(id: string, prefix: string): boolean {
  if (id === prefix) {
    return true;
  }
  if (id.startsWith(prefix)) {
    const next = id.charAt(prefix.length);
    return next === "-" || next === "_";
  }
  return false;
}

export function matchesBoundarySuffix(id: string, suffix: string): boolean {
  if (id === suffix) {
    return true;
  }
  if (id.endsWith(suffix)) {
    const prev = id.charAt(id.length - suffix.length - 1);
    return prev === "-" || prev === "_";
  }
  return false;
}

function matchesBoundaryInfix(id: string, token: string): boolean {
  const delimiters = ["-", "_"];
  for (const left of delimiters) {
    for (const right of delimiters) {
      if (id.includes(`${left}${token}${right}`)) {
        return true;
      }
    }
  }
  return false;
}

function matchesBoundaryToken(id: string, token: string): boolean {
  return (
    matchesBoundaryPrefix(id, token) ||
    matchesBoundarySuffix(id, token) ||
    matchesBoundaryInfix(id, token)
  );
}

export function normalizeRoleName(input: string): AgentRole | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim().toLowerCase();
  if (isAgentRole(trimmed)) {
    return trimmed;
  }
  return null;
}

export function inferRoleFromAgentId(agentId: string): AgentRole | null {
  if (!agentId || typeof agentId !== "string") {
    return null;
  }
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/, "");
  if (!normalized) {
    return null;
  }

  if (
    matchesBoundaryToken(normalized, "mind-auditor") ||
    matchesBoundaryToken(normalized, "mind_auditor")
  ) {
    return "mind-auditor";
  }

  if (
    matchesBoundaryToken(normalized, "skill-auditor") ||
    matchesBoundaryToken(normalized, "skill_auditor")
  ) {
    return "skill-auditor";
  }

  if (matchesBoundaryToken(normalized, "mind")) {
    return "mind";
  }

  if (
    matchesBoundaryToken(normalized, "orchestrator") ||
    matchesBoundaryToken(normalized, "orch")
  ) {
    return "orchestrator";
  }

  if (
    matchesBoundaryToken(normalized, "coordinator") ||
    matchesBoundaryToken(normalized, "coord")
  ) {
    return "coordinator";
  }

  if (
    matchesBoundaryToken(normalized, "ui-headless-validator") ||
    matchesBoundaryToken(normalized, "ui_headless_validator")
  ) {
    return "ui-headless-validator";
  }

  if (
    matchesBoundaryToken(normalized, "ui-optical-validator") ||
    matchesBoundaryToken(normalized, "ui_optical_validator")
  ) {
    return "ui-optical-validator";
  }

  if (
    matchesBoundaryToken(normalized, "sub-implementer") ||
    matchesBoundaryToken(normalized, "sub_implementer")
  ) {
    return "sub-implementer";
  }

  if (
    matchesBoundaryToken(normalized, "sub-validator") ||
    matchesBoundaryToken(normalized, "sub_validator")
  ) {
    return "sub-validator";
  }

  if (
    matchesBoundaryToken(normalized, "sub-investigator") ||
    matchesBoundaryToken(normalized, "sub_investigator")
  ) {
    return "sub-investigator";
  }

  if (
    matchesBoundaryToken(normalized, "plan-validator") ||
    matchesBoundaryToken(normalized, "plan_validator")
  ) {
    return "plan-validator";
  }

  if (matchesBoundaryToken(normalized, "planner")) {
    return "planner";
  }

  if (
    matchesBoundaryToken(normalized, "completeness-critic") ||
    matchesBoundaryToken(normalized, "completeness_critic")
  ) {
    return "completeness-critic";
  }

  if (matchesBoundaryToken(normalized, "implementer") || matchesBoundaryToken(normalized, "impl")) {
    return "implementer";
  }

  if (matchesBoundaryToken(normalized, "validator") || matchesBoundaryToken(normalized, "val")) {
    return "validator";
  }

  if (matchesBoundaryToken(normalized, "publisher")) {
    return "publisher";
  }

  return null;
}

export function isOrchestratorRole(input: string): boolean {
  const resolved = normalizeRoleName(input) ?? inferRoleFromAgentId(input);
  return resolved === "orchestrator";
}

export function isCoordinatorRole(input: string): boolean {
  const resolved = normalizeRoleName(input) ?? inferRoleFromAgentId(input);
  return resolved === "coordinator";
}

export function isSupervisoryRole(input: string): boolean {
  const resolved = normalizeRoleName(input) ?? inferRoleFromAgentId(input);
  return resolved === "mind" || resolved === "orchestrator" || resolved === "coordinator";
}
