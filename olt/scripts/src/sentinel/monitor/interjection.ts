import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { dispatchPeerMessage } from "../../communication/mailbox/index.ts";
import {
  getProfileForRole,
  recordStrike,
  type AgentRole,
  type SentinelViolation,
  type StrikeRecord,
} from "../index.ts";
import { PROHIBITED_SUPERVISORY_TOOLS } from "./types.ts";

const PROHIBITED_TOOL_SET = new Set<string>(PROHIBITED_SUPERVISORY_TOOLS);

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

export interface TranscriptEvaluationContext {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly targetWorktree?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
}

export function evaluateTranscriptLine(
  line: string,
  context: TranscriptEvaluationContext,
): SentinelViolation | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const invocations: Array<{ name: string; args?: Record<string, unknown> | undefined }> = [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray(parsed?.tool_calls)) {
      for (const tc of parsed.tool_calls as readonly Record<string, unknown>[]) {
        if (tc && typeof tc === "object") {
          const fn = tc.function as Record<string, unknown> | undefined;
          const name =
            typeof tc.name === "string" ? tc.name : typeof fn?.name === "string" ? fn.name : "";
          let args: Record<string, unknown> | undefined;
          if (tc.args && typeof tc.args === "object") {
            args = tc.args as Record<string, unknown>;
          } else if (tc.arguments && typeof tc.arguments === "object") {
            args = tc.arguments as Record<string, unknown>;
          } else if (typeof fn?.arguments === "string") {
            try {
              args = JSON.parse(fn.arguments) as Record<string, unknown>;
            } catch {}
          }
          if (name) invocations.push({ name, args });
        }
      }
    }
    for (const k of ["tool", "tool_name", "name"]) {
      if (typeof parsed?.[k] === "string") {
        const name = parsed[k] as string;
        const args = (parsed.args ?? parsed.arguments ?? parsed.parameters) as
          | Record<string, unknown>
          | undefined;
        invocations.push({ name, args: typeof args === "object" ? args : undefined });
      }
    }
  } catch {}

  if (invocations.length === 0) {
    const re = /(?:call:\s*(?:default_api:)?|Tool Use:\s*|"name"\s*:\s*")([a-zA-Z0-9_-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      if (m[1]) invocations.push({ name: m[1] });
    }
  }

  for (const inv of invocations) {
    if (PROHIBITED_TOOL_SET.has(inv.name) && isSupervisoryRole(context.role)) {
      return {
        code: "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
        severity: "CRITICAL",
        message: `Supervisory role '${context.role}' (${context.agentId}) invoked prohibited tool '${inv.name}'. Supervisory roles are confined to coordination via invoke_subagent.`,
        remediation_cmd: "Dispatch Tier 3 Implementers via invoke_subagent.",
        documentation_ref:
          "docs/olt/architecture/15-state-schemas-and-event-ledger/15-04-state-json-and-mailbox-schemas.md",
      };
    }

    if (inv.args) {
      const rawPath =
        inv.args.targetPath ??
        inv.args.TargetFile ??
        inv.args.path ??
        inv.args.filePath ??
        inv.args.target_file ??
        inv.args.file;
      if (typeof rawPath === "string" && rawPath.trim()) {
        const p = rawPath.trim();
        const norm = normalize(p).replace(/\\/g, "/");
        let isTraversal = norm.startsWith("../") || norm === ".." || norm.includes("/../");
        if (!isTraversal && context.targetWorktree) {
          const resolved = isAbsolute(p) ? resolve(p) : resolve(context.targetWorktree, p);
          const normWorktree = resolve(context.targetWorktree);
          if (resolved !== normWorktree && !resolved.startsWith(`${normWorktree}/`)) {
            isTraversal = true;
          }
        }
        if (isTraversal) {
          return {
            code: "PATH_TRAVERSAL_ATTACK",
            severity: "CRITICAL",
            message: `Path traversal or outside-worktree attack detected in tool '${inv.name}': '${p}'`,
            target_file: p,
            remediation_cmd: "Confine target paths strictly inside assigned worktree.",
          };
        }
      }
    }
  }

  return null;
}
