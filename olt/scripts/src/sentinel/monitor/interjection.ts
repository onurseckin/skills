import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { dispatchPeerMessage } from "../../communication/mailbox/index.ts";
import {
  getProfileForRole,
  recordStrike,
  type AgentRole,
  type SentinelViolation,
  type StrikeRecord,
} from "../index.ts";

export function isSupervisoryRole(role: AgentRole): boolean {
  if (
    role === "orchestrator" ||
    role === "coordinator" ||
    role === "mind" ||
    role === "skill-auditor" ||
    role === "mind-auditor"
  ) {
    return true;
  }
  try {
    return getProfileForRole(role).tier <= 2;
  } catch {
    return false;
  }
}

export function isPathInScope(filePath: string, scopes: readonly string[]): boolean {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return scopes.some((s) => {
    const sc = s.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
    return norm === sc || norm.startsWith(`${sc}/`);
  });
}

export function quarantineAgentInState(agentId: string, repoRoot?: string): boolean {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const paths: string[] = [];
  for (const candidate of [join(root, "state.json"), join(root, ".olt", "state.json")]) {
    if (existsSync(candidate)) paths.push(candidate);
  }
  const capsulesDir = join(root, ".olt", "capsules");
  if (existsSync(capsulesDir)) {
    try {
      for (const e of readdirSync(capsulesDir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          const capState = join(capsulesDir, e.name, "state.json");
          if (existsSync(capState)) paths.push(capState);
        }
      }
    } catch {}
  }
  let modifiedAny = false;
  for (const statePath of paths) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
      let changed = false;
      if (Array.isArray(state?.agents)) {
        for (const a of state.agents as Array<Record<string, unknown>>) {
          if (a && typeof a === "object" && a.id === agentId) {
            a.status = "quarantined";
            changed = true;
          }
        }
      } else if (state?.agents && typeof state.agents === "object") {
        const agMap = state.agents as Record<string, Record<string, unknown>>;
        if (agMap[agentId]) {
          agMap[agentId].status = "quarantined";
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
        modifiedAny = true;
      }
    } catch {}
  }
  return modifiedAny;
}

export function appendDefectIncident(
  agentId: string,
  role: string,
  violation: SentinelViolation,
  repoRoot?: string,
  taskId?: string,
): void {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const oltDir = join(root, ".olt");
  if (!existsSync(oltDir)) {
    try {
      mkdirSync(oltDir, { recursive: true });
    } catch {}
  }
  const entry = {
    id: `defect-sentinel-${Date.now()}-${agentId}`,
    type: "role_confinement_violation",
    category: "role_boundary",
    actor: agentId,
    role,
    task_id: taskId,
    severity: violation.severity,
    timestamp: new Date().toISOString(),
    details: violation.message,
    violation_code: violation.code,
  };
  try {
    appendFileSync(join(oltDir, "defects.jsonl"), `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {}
}

export interface InterjectionContext {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly taskId?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly parentSupervisor?: string | undefined;
}

export function executeInstantInterjection(
  ctx: InterjectionContext,
  violation: SentinelViolation,
): StrikeRecord {
  const violations = [violation];
  const strikeRecord = recordStrike(ctx.agentId, ctx.role, violations, ctx.taskId, ctx.repoRoot);

  try {
    dispatchPeerMessage({
      senderId: "sentinel-monitor",
      senderRole: "sentinel",
      recipientRoleOrId: ctx.agentId,
      messageType: "SYSTEM_ALERT",
      payload: {
        action: "EMERGENCY_HALT",
        directive: "HALT_IMMEDIATELY",
        reason: violation.message,
        violations,
        strikeRecord,
      },
      ...(ctx.repoRoot ? { baseDir: ctx.repoRoot } : {}),
    });
  } catch {}

  quarantineAgentInState(ctx.agentId, ctx.repoRoot);
  appendDefectIncident(ctx.agentId, ctx.role, violation, ctx.repoRoot, ctx.taskId);

  const supervisor = ctx.parentSupervisor ?? "mind";
  try {
    dispatchPeerMessage({
      senderId: "sentinel-monitor",
      senderRole: "sentinel",
      recipientRoleOrId: supervisor,
      messageType: "DEFECT_ESCALATION",
      payload: {
        action: "QUARANTINE_ESCALATION",
        agent_id: ctx.agentId,
        role: ctx.role,
        reason: violation.message,
        violations,
        strikeRecord,
        timestamp: new Date().toISOString(),
      },
      ...(ctx.repoRoot ? { baseDir: ctx.repoRoot } : {}),
    });
  } catch {}

  return strikeRecord;
}
