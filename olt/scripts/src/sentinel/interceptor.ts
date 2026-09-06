import { dispatchPeerMessage } from "../communication/mailbox/mailbox-dispatcher.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../communication/types.ts";
import {
  checkPlanningDag,
  type PlanningDagGraphInput,
} from "../reporting/doctor/planning-dag-engine.ts";
import type { DoctorDiagnosticFinding } from "../reporting/doctor/types.ts";
import { listTrackWorktrees } from "../workflow/worktree/manager.ts";

export interface FastDoctorCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | undefined;
  readonly graph?: PlanningDagGraphInput | undefined;
  readonly activeWorktreeCount?: number | undefined;
  readonly findings?: readonly DoctorDiagnosticFinding[] | undefined;
  readonly role?: string | undefined;
  readonly agentId?: string | undefined;
  readonly actionType?: string | undefined;
  readonly target?: string | undefined;
  readonly spawnedRoles?: readonly string[] | undefined;
}

export interface SendMessageOptions {
  readonly senderId: string;
  readonly senderRole?: string | undefined;
  readonly recipientId: string;
  readonly messageType?: MailboxMessageType | undefined;
  readonly payload: Record<string, unknown>;
  readonly baseDir?: string | undefined;
}

export interface SentinelInterceptOptions {
  readonly agentId: string;
  readonly role: string;
  readonly actionType: string;
  readonly target: string;
  readonly supervisorId?: string | undefined;
  readonly blockerCode: string;
  readonly blockerReason: string;
  readonly remediation?: string | undefined;
  readonly findings?: readonly DoctorDiagnosticFinding[] | undefined;
  readonly repoRoot?: string | undefined;
}

export interface SentinelInterceptReceipt {
  readonly recipient: string;
  readonly messageType: string;
  readonly blockerCode: string;
  readonly blockerReason: string;
  readonly remediation: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
}

export const CRITICAL_SENTINEL_CODES = new Set([
  "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION",
  "UNTRACKED_WORKTREE_DETECTED",
  "CROSS_TIER_SPAWNING_VIOLATION",
  "PLANNING_DAG_TIER_SKIP_VIOLATION",
  "ROLE_CONFINEMENT_VIOLATION",
]);

export function isCriticalDoctorFinding(finding: DoctorDiagnosticFinding): boolean {
  if (finding.severity === "ERROR") {
    return (
      CRITICAL_SENTINEL_CODES.has(finding.code) ||
      finding.code.includes("TIER") ||
      finding.code.includes("WORKTREE") ||
      finding.code.startsWith("PLANNING_DAG_")
    );
  }
  return false;
}

export function resolveSupervisorForRole(role: string): string {
  const norm = role.toLowerCase().trim();
  if (norm.includes("orch") || norm === "mind-auditor") return "mind";
  if (
    norm.includes("coord") ||
    ["planner", "plan-validator", "repairer", "completeness-critic"].includes(norm)
  )
    return "orchestrator";
  if (
    norm.includes("impl") ||
    norm.includes("val") ||
    norm.includes("sub-") ||
    norm.includes("mechanic")
  )
    return "coordinator";
  return "supervisor";
}

export function sendMessageToAgent(
  recipientOrOptions: string | SendMessageOptions,
  payload?: Record<string, unknown>,
  extra?: Partial<SendMessageOptions>,
): MailboxEnvelope<Record<string, unknown>> {
  if (typeof recipientOrOptions === "string") {
    const baseDir = extra?.baseDir;
    return dispatchPeerMessage({
      senderId: extra?.senderId ?? "sentinel",
      senderRole: extra?.senderRole ?? "sentinel",
      recipientRoleOrId: recipientOrOptions,
      messageType: extra?.messageType ?? "SYSTEM_ALERT",
      payload: payload ?? {},
      ...(baseDir !== undefined ? { baseDir } : {}),
    });
  }
  const baseDir = recipientOrOptions.baseDir;
  return dispatchPeerMessage({
    senderId: recipientOrOptions.senderId,
    senderRole: recipientOrOptions.senderRole ?? "sentinel",
    recipientRoleOrId: recipientOrOptions.recipientId,
    messageType: recipientOrOptions.messageType ?? "SYSTEM_ALERT",
    payload: recipientOrOptions.payload,
    ...(baseDir !== undefined ? { baseDir } : {}),
  });
}

const recentIntercepts: SentinelInterceptReceipt[] = [];
export function getRecentSentinelIntercepts(): readonly SentinelInterceptReceipt[] {
  return [...recentIntercepts];
}
export function clearRecentSentinelIntercepts(): void {
  recentIntercepts.length = 0;
}

export function runFastDoctorChecks(
  options: FastDoctorCheckOptions = {},
): readonly DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [...(options.findings ?? [])];
  const tasks = options.tasks ?? (options.state?.tasks as Record<string, unknown> | undefined);
  const graph = options.graph ?? (options.state?.graph as PlanningDagGraphInput | undefined);

  const dagResult = checkPlanningDag({
    ...(options.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
    ...(options.state !== undefined ? { state: options.state } : {}),
    ...(tasks !== undefined ? { tasks } : {}),
    ...(graph !== undefined ? { graph } : {}),
    ...(options.activeWorktreeCount !== undefined
      ? { activeWorktreeCount: options.activeWorktreeCount }
      : {}),
  });
  findings.push(...dagResult.findings);

  if (options.repoRoot) {
    try {
      const activeWts = listTrackWorktrees({
        repoRoot: options.repoRoot,
      }).filter((w) => w.status === "active");
      if (activeWts.length > 0 && tasks && typeof tasks === "object") {
        const registered = new Set<string>();
        for (const [k, v] of Object.entries(tasks)) {
          registered.add(k);
          if (v && typeof v === "object") {
            const rec = v as Record<string, unknown>;
            if (typeof rec.trackId === "string") registered.add(rec.trackId);
            if (typeof rec.track_id === "string") registered.add(rec.track_id);
          }
        }
        for (const wt of activeWts) {
          if (!registered.has(wt.trackId)) {
            findings.push({
              code: "UNTRACKED_WORKTREE_DETECTED",
              severity: "ERROR",
              engine: "sentinelFastDoctor",
              message: `Untracked worktree detected without active task registration: "${wt.trackId}"`,
              details: { trackId: wt.trackId, worktreePath: wt.worktreePath },
            });
          }
        }
      }
    } catch {}
  }

  const spawned =
    options.spawnedRoles ??
    (options.state?.spawned_agent_roles as readonly string[] | undefined) ??
    (options.state?.child_agent_roles as readonly string[] | undefined);
  if (spawned && options.role) {
    const normRole = options.role.toLowerCase().trim();
    for (const childRole of spawned) {
      const normChild = childRole.toLowerCase().trim();
      const isMindInvalid =
        normRole === "mind" &&
        ["coordinator", "implementer", "validator", "repairer"].includes(normChild);
      const isOrchInvalid =
        normRole.includes("orch") && ["implementer", "validator", "repairer"].includes(normChild);
      if (isMindInvalid || isOrchInvalid) {
        findings.push({
          code: "CROSS_TIER_SPAWNING_VIOLATION",
          severity: "ERROR",
          engine: "sentinelFastDoctor",
          message: isMindInvalid
            ? `Tier 0 Mind must not directly dispatch Tier 2/3 workers: "${childRole}". Must route through Tier 1 Orchestrator.`
            : `Tier 1 Orchestrator must not directly dispatch Tier 3 workers: "${childRole}". Must route through Tier 2 Coordinator.`,
          details: { parentRole: options.role, childRole },
        });
      }
    }
  }

  return findings;
}

export function dispatchSentinelIntercept(
  options: SentinelInterceptOptions,
): readonly SentinelInterceptReceipt[] {
  const supervisor = options.supervisorId ?? resolveSupervisorForRole(options.role);
  const remediation =
    options.remediation ?? "Resolve critical doctor diagnostic finding before proceeding.";
  const payload: Record<string, unknown> = {
    type: "SENTINEL_INTERCEPT",
    blocker_code: options.blockerCode,
    blocker_reason: options.blockerReason,
    remediation,
    critical_findings: options.findings ?? [],
    agent_id: options.agentId,
    role: options.role,
    action_type: options.actionType,
    target: options.target,
    supervisor,
    timestamp: Date.now(),
  };

  const receipts: SentinelInterceptReceipt[] = [];
  const recipients = [options.agentId];
  if (supervisor && supervisor !== options.agentId) recipients.push(supervisor);

  for (const recipient of recipients) {
    try {
      sendMessageToAgent({
        senderId: `sentinel:${options.agentId}`,
        senderRole: "sentinel",
        recipientId: recipient,
        messageType: "SENTINEL_INTERCEPT" as MailboxMessageType,
        payload,
        ...(options.repoRoot !== undefined ? { baseDir: options.repoRoot } : {}),
      });
      receipts.push({
        recipient,
        messageType: "SENTINEL_INTERCEPT",
        blockerCode: options.blockerCode,
        blockerReason: options.blockerReason,
        remediation,
        payload,
        timestamp: Date.now(),
      });
    } catch {}
  }

  recentIntercepts.push(...receipts);
  return receipts;
}
