import { roleToTier } from "../../authority/thread/index.ts";
import type {
  LiveCliProof,
  ProcessHealthStatus,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
} from "./types.ts";

export function createSpawnedSubagentRecord(
  options: SubagentRegistrationOptions,
  timestamp: string,
): SubagentBootGateRecord {
  const tier = options.tier !== undefined ? options.tier : roleToTier(options.role);

  return {
    agentId: options.agentId,
    role: options.role,
    tier,
    parentAgentId: options.parentAgentId ?? null,
    taskId: options.taskId ?? null,
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
    ...(options.ppid !== undefined ? { ppid: options.ppid } : {}),
    spawnedAt: options.spawnedAt ?? timestamp,
    whoamiExecuted: false,
    whoamiExecutedAt: null,
    doctorExecuted: false,
    doctorExecutedAt: null,
    bootGatePassed: false,
    gateViolations: [
      "Pre-flight boot gate 'whoami' not yet executed",
      "Pre-flight boot gate 'doctor' not yet executed",
    ],
    lastActivityAt: timestamp,
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
  };
}

export function applyWhoamiExecution(
  existing: SubagentBootGateRecord,
  timestamp: string,
  proof?: Partial<LiveCliProof>,
): SubagentBootGateRecord {
  const isVerified =
    proof?.verified !== false && (proof?.exitCode === undefined || proof.exitCode === 0);

  const constructedProof: LiveCliProof = {
    gate: "whoami",
    actor: existing.agentId,
    argv: proof?.argv ?? ["bun", "scripts/harness.ts", "whoami"],
    exitCode: proof?.exitCode ?? 0,
    executedAt: timestamp,
    ...(proof?.pid !== undefined
      ? { pid: proof.pid }
      : existing.pid !== undefined
        ? { pid: existing.pid }
        : {}),
    ...(proof?.outputSnippet !== undefined ? { outputSnippet: proof.outputSnippet } : {}),
    ...(proof?.fingerprint !== undefined ? { fingerprint: proof.fingerprint } : {}),
    verified: isVerified,
    ...(proof?.failureReason !== undefined
      ? { failureReason: proof.failureReason }
      : isVerified
        ? {}
        : { failureReason: "whoami CLI command failed with non-zero exit" }),
  };

  const doctorPassed = existing.doctorExecuted;
  const gateViolations: string[] = [];
  if (!isVerified) {
    gateViolations.push(
      `Pre-flight boot gate 'whoami' verification failed: ${constructedProof.failureReason ?? "unverified execution"}`,
    );
  }
  if (!doctorPassed) {
    gateViolations.push("Pre-flight boot gate 'doctor' not yet executed");
  }

  return {
    ...existing,
    whoamiExecuted: isVerified,
    whoamiExecutedAt: timestamp,
    whoamiProof: constructedProof,
    bootGatePassed: isVerified && doctorPassed,
    gateViolations,
    lastActivityAt: timestamp,
  };
}

export function applyDoctorExecution(
  existing: SubagentBootGateRecord,
  timestamp: string,
  proof?: Partial<LiveCliProof>,
): SubagentBootGateRecord {
  const isVerified =
    proof?.verified !== false && (proof?.exitCode === undefined || proof.exitCode === 0);

  const constructedProof: LiveCliProof = {
    gate: "doctor",
    actor: existing.agentId,
    argv: proof?.argv ?? ["bun", "scripts/harness.ts", "doctor"],
    exitCode: proof?.exitCode ?? 0,
    executedAt: timestamp,
    ...(proof?.pid !== undefined
      ? { pid: proof.pid }
      : existing.pid !== undefined
        ? { pid: existing.pid }
        : {}),
    ...(proof?.outputSnippet !== undefined ? { outputSnippet: proof.outputSnippet } : {}),
    ...(proof?.fingerprint !== undefined ? { fingerprint: proof.fingerprint } : {}),
    verified: isVerified,
    ...(proof?.failureReason !== undefined
      ? { failureReason: proof.failureReason }
      : isVerified
        ? {}
        : { failureReason: "doctor CLI command failed with non-zero exit" }),
  };

  const whoamiPassed = existing.whoamiExecuted;
  const gateViolations: string[] = [];
  if (!whoamiPassed) {
    gateViolations.push("Pre-flight boot gate 'whoami' not yet executed");
  }
  if (!isVerified) {
    gateViolations.push(
      `Pre-flight boot gate 'doctor' verification failed: ${constructedProof.failureReason ?? "unverified execution"}`,
    );
  }

  return {
    ...existing,
    doctorExecuted: isVerified,
    doctorExecutedAt: timestamp,
    doctorProof: constructedProof,
    bootGatePassed: whoamiPassed && isVerified,
    gateViolations,
    lastActivityAt: timestamp,
  };
}
