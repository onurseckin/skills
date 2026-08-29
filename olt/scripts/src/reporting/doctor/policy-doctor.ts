import { computePolicyChecksum, detectPolicyDrift, inspectRepoPolicy } from "../../policy/index.ts";
import { CURRENT_POLICY_SCHEMA_VERSION, type RepoPolicy } from "../../policy/types.ts";
import { checkCognitiveValidatorCommandLock } from "./command-lock-engine.ts";
import { checkPushbackQuotas } from "./pushback-quotas-engine.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface PolicyDoctorCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly customPolicyPath?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly expectedChecksum?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
  readonly minProbes?: number | undefined;
  readonly strict?: boolean | undefined;
}

export type PolicyDoctorOptions = PolicyDoctorCheckOptions;

function checkUnauthorizedCommands(
  policy: RepoPolicy | undefined,
  commands: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined,
  grants: readonly unknown[] | null | undefined,
): DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];
  if (!commands || typeof commands !== "object") return findings;

  const roleMap = new Map<string, string>();
  if (Array.isArray(grants)) {
    for (const grant of grants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id =
          typeof g["id"] === "string"
            ? g["id"]
            : typeof g["agent_id"] === "string"
              ? g["agent_id"]
              : undefined;
        const role = typeof g["role"] === "string" ? g["role"] : undefined;
        if (id && role) roleMap.set(id, role);
      }
    }
  }

  const forbiddenSet = new Set(policy?.forbidden_commands ?? []);
  const cmdList = Array.isArray(commands) ? commands : Object.values(commands);

  for (const cmdObj of cmdList) {
    if (!cmdObj || typeof cmdObj !== "object") continue;
    const rec = cmdObj as Record<string, unknown>;
    const cmdId = typeof rec["id"] === "string" ? rec["id"] : "cmd";
    const cmdLine = typeof rec["command"] === "string" ? rec["command"] : "";
    const agentId = typeof rec["agent_id"] === "string" ? rec["agent_id"] : "";
    const role = roleMap.get(agentId) ?? (typeof rec["role"] === "string" ? rec["role"] : "");

    if (forbiddenSet.has(cmdLine)) {
      findings.push({
        code: "UNAUTHORIZED_COMMAND",
        severity: "ERROR",
        engine: "checkPolicyDoctor",
        message: `Command "${cmdLine}" (id: ${cmdId}) executed by agent "${agentId}" is forbidden by repository policy`,
        details: { commandId: cmdId, command: cmdLine, agentId, role },
      });
    }

    if (role && policy?.agents?.[role]?.rbac) {
      const rbac = policy.agents[role].rbac;
      if (rbac.forbidden_patterns) {
        for (const pattern of rbac.forbidden_patterns) {
          if (cmdLine.includes(pattern)) {
            findings.push({
              code: "UNAUTHORIZED_COMMAND",
              severity: "ERROR",
              engine: "checkPolicyDoctor",
              message: `Command "${cmdLine}" executed by agent "${agentId}" (${role}) matches forbidden pattern "${pattern}"`,
              details: { commandId: cmdId, command: cmdLine, agentId, role, pattern },
            });
          }
        }
      }
    }
  }

  return findings;
}

export function checkPolicyDoctor(options: PolicyDoctorCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const inspection = inspectRepoPolicy(options.repoRoot, options.customPolicyPath);

  let activePolicy: RepoPolicy | undefined = options.policy;

  if (inspection.status === "invalid_custom") {
    findings.push({
      code: "POLICY_CORRUPT",
      severity: "ERROR",
      engine: "checkPolicyDoctor",
      message: `Repository policy is corrupted or invalid: ${inspection.error ?? "unknown schema defect"}`,
      details: { filePath: inspection.filePath, error: inspection.error },
    });
  } else if (inspection.status === "valid_custom") {
    activePolicy = activePolicy ?? inspection.policy;
  } else if (inspection.status === "auto_detected") {
    activePolicy = activePolicy ?? inspection.policy;
    findings.push({
      code: "POLICY_AUTO_DETECTED",
      severity: "INFO",
      engine: "checkPolicyDoctor",
      message: "No explicit .olt/policy.json found; operating under canonical auto-detected policy",
      details: { ecosystem: inspection.policy.ecosystem },
    });
  }

  if (activePolicy) {
    if (activePolicy.schema_version !== CURRENT_POLICY_SCHEMA_VERSION) {
      findings.push({
        code: "POLICY_SCHEMA_VERSION_DRIFT",
        severity: "ERROR",
        engine: "checkPolicyDoctor",
        message: `Policy schema version ${activePolicy.schema_version} differs from supported version ${CURRENT_POLICY_SCHEMA_VERSION}`,
        details: {
          observedVersion: activePolicy.schema_version,
          expectedVersion: CURRENT_POLICY_SCHEMA_VERSION,
        },
      });
    }
  }

  if (options.expectedChecksum !== undefined) {
    const currentChecksum = computePolicyChecksum(options.repoRoot, options.customPolicyPath);
    const drift = detectPolicyDrift(
      options.expectedChecksum,
      options.repoRoot,
      options.customPolicyPath,
    );
    if (drift.drifted) {
      findings.push({
        code: "POLICY_CHECKSUM_DRIFT",
        severity: options.strict ? "ERROR" : "WARN",
        engine: "checkPolicyDoctor",
        message: `Policy file checksum drifted from expected ${options.expectedChecksum} (current: ${currentChecksum})`,
        details: {
          expectedChecksum: options.expectedChecksum,
          currentChecksum,
        },
      });
    }
  }

  const quotaResult = checkPushbackQuotas({
    state: options.state,
    tasks: options.tasks,
    events: options.events,
    policy: activePolicy,
  });
  findings.push(...quotaResult.findings);

  const lockResult = checkCognitiveValidatorCommandLock({
    state: options.state,
    commands: options.commands,
    events: options.events,
    grants: options.grants,
  });
  findings.push(...lockResult.findings);

  const unauthorizedFindings = checkUnauthorizedCommands(
    activePolicy,
    options.commands ?? (options.state?.commands as Record<string, unknown> | undefined),
    options.grants ?? (options.state?.grants as readonly unknown[] | undefined),
  );
  findings.push(...unauthorizedFindings);

  const passed = findings.filter((f) => f.severity === "ERROR").length === 0;

  return {
    engine: "checkPolicyDoctor",
    passed,
    findings,
  };
}

export function auditPolicyDoctor(options: PolicyDoctorCheckOptions = {}): DoctorCheckEngineResult {
  return checkPolicyDoctor(options);
}
