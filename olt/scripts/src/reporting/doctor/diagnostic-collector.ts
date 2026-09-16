import { isJsonObject } from "../../core/contracts/index.ts";
import {
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  checkPolicyDoctor,
  checkRepositoryHygiene,
  checkGitIndexIntegrity,
  checkMailboxHealth,
  checkWorktreeHealth,
  checkCliRegistryTaxonomy,
  checkTier0CompanionsHealth,
  checkAntiStagnationDoctor,
  checkPlanQualityAndAgentUtilization,
  checkQuotaHealth,
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./engines.ts";

import { checkAgentCanonicalAlignment } from "./agent-canonical-engine.ts";
import { checkCompanionAuditorsDoctor } from "./rules/companion-auditors.ts";
import { detectActiveHost } from "../../telemetry/collectors/index.ts";
import { readCurrentQuota } from "../../orchestrator/lifecycle/index.ts";

export interface DiagnosticCollectionOptions {
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly testPaths?: readonly string[] | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly host?: string | undefined;
  readonly quota?: number | null | undefined;
}

export interface DiagnosticCollectionResult {
  readonly engineResults: Record<string, DoctorCheckEngineResult>;
  readonly allEngineFindings: readonly DoctorDiagnosticFinding[];
  readonly engineErrorIssues: readonly string[];
  readonly engineWarnIssues: readonly string[];
  readonly engineInfoIssues: readonly string[];
}

function safeRunEngine(name: string, fn: () => DoctorCheckEngineResult): DoctorCheckEngineResult {
  try {
    return fn();
  } catch (err: unknown) {
    let errorDetail = String(err);
    if (err instanceof Error) {
      if (typeof err.stack === "string") {
        errorDetail = err.stack;
      } else {
        errorDetail = err.message;
      }
    }
    return {
      engine: name,
      passed: false,
      findings: [
        {
          code: "DOCTOR_ENGINE_FAULT",
          severity: "ERROR",
          engine: name,
          message: `Engine fault in ${name}: ${err instanceof Error ? err.message : String(err)}`,
          details: {
            error: errorDetail,
          },
        },
      ],
    };
  }
}

export function collectDiagnosticEngines(
  options: DiagnosticCollectionOptions,
): DiagnosticCollectionResult {
  const repository = options.repoRoot;
  const rawState = options.state;
  const state = isJsonObject(rawState) ? rawState : undefined;
  let events: readonly Record<string, unknown>[] | undefined = undefined;
  if (Array.isArray(options.events)) {
    const rawEvents: readonly unknown[] = options.events;
    events = rawEvents.filter((e): e is Record<string, unknown> => isJsonObject(e));
  }

  const stateTasks = state !== undefined && isJsonObject(state.tasks) ? state.tasks : undefined;
  const stateGraph =
    state !== undefined && isJsonObject(state.graph)
      ? (state.graph as { nodes?: []; edges?: [] })
      : undefined;
  const stateGrants = state !== undefined && Array.isArray(state.grants) ? state.grants : undefined;
  const stateCommands =
    state !== undefined && isJsonObject(state.commands) ? state.commands : undefined;

  const engine1 = safeRunEngine("checkPlanningDag", () =>
    checkPlanningDag({
      tasks: stateTasks,
      graph: stateGraph,
    }),
  );

  const writeScope = options.writeScope !== undefined ? options.writeScope : [];
  const engine2 = safeRunEngine("checkAstPurity", () =>
    checkAstPurity({
      repoRoot: repository,
      writeScope,
    }),
  );

  const engine3 = safeRunEngine("checkAntiMockMutation", () =>
    checkAntiMockMutation({
      repoRoot: repository,
      targetFiles: options.testPaths,
      targetPaths: options.testPaths,
      testFiles: options.testPaths,
    }),
  );

  const engine4 = safeRunEngine("checkAntiBatchingIsolation", () =>
    checkAntiBatchingIsolation({
      state,
      tasks: stateTasks,
      grants: stateGrants,
    }),
  );

  const engine5 = safeRunEngine("checkDualChannelUi", () => checkDualChannelUi());

  const engine6 = safeRunEngine("checkCognitiveValidatorCommandLock", () =>
    checkCognitiveValidatorCommandLock({
      state,
      commands: stateCommands,
      events,
      grants: stateGrants,
    }),
  );

  const engine7 = safeRunEngine("checkRoleBoundaryInterlock", () =>
    checkRoleBoundaryInterlock({
      state,
      commands: stateCommands,
      events,
      grants: stateGrants,
    }),
  );

  const engine8 = safeRunEngine("checkPushbackQuotas", () =>
    checkPushbackQuotas({
      state,
      tasks: stateTasks,
      events,
      repoRoot: repository,
    }),
  );

  const engine9 = safeRunEngine("checkPolicyDoctor", () =>
    checkPolicyDoctor({
      repoRoot: repository,
      state,
      tasks: stateTasks,
      commands: stateCommands,
      events,
      grants: stateGrants,
    }),
  );

  const engine10 = safeRunEngine("checkRepositoryHygiene", () => {
    const h = checkRepositoryHygiene({ repoRoot: repository });
    const findings: DoctorDiagnosticFinding[] = h.violations.map((v) => ({
      code: v.violationType,
      severity: v.severity,
      engine: "checkRepositoryHygiene",
      message: v.message,
      details: { path: v.path, violationType: v.violationType },
    }));
    return {
      engine: "checkRepositoryHygiene",
      passed: computeDoctorEnginePassed(findings),
      findings,
    };
  });

  const engine11 = safeRunEngine("checkGitIndexIntegrity", () => {
    const r = checkGitIndexIntegrity({ repoRoot: repository });
    return {
      engine: "checkGitIndexIntegrity",
      passed: computeDoctorEnginePassed(r.findings),
      findings: r.findings,
    };
  });

  let activeAgentIds: readonly string[] | undefined = undefined;
  if (state !== undefined && Array.isArray(state.agents)) {
    const ids: string[] = [];
    for (const a of state.agents) {
      if (typeof a === "string" && a.length > 0) ids.push(a);
      else if (isJsonObject(a)) {
        if (typeof a.id === "string" && a.id.length > 0) ids.push(a.id);
        else if (typeof a.agentId === "string" && a.agentId.length > 0) ids.push(a.agentId);
      }
    }
    activeAgentIds = ids;
  }

  const engine12 = safeRunEngine("checkMailboxHealth", () =>
    checkMailboxHealth({ repoRoot: repository, activeAgentIds, state }),
  );

  const engine13 = safeRunEngine("checkWorktreeHealth", () => {
    const r = checkWorktreeHealth({ repoRoot: repository });
    return {
      engine: "checkWorktreeHealth",
      passed: computeDoctorEnginePassed(r.findings),
      findings: r.findings,
    };
  });

  const engine14 = safeRunEngine("checkCliRegistryTaxonomy", () => checkCliRegistryTaxonomy());

  const engine15 = safeRunEngine("checkTier0CompanionsHealth", () =>
    checkTier0CompanionsHealth({
      state,
      repoRoot: repository,
    }),
  );

  const engine16 = safeRunEngine("checkAntiStagnationDoctor", () =>
    checkAntiStagnationDoctor({
      repoRoot: repository,
      state,
      events,
      commands: stateCommands,
      grants: stateGrants,
    }),
  );

  const engine17 = safeRunEngine("checkPlanQualityAndAgentUtilization", () =>
    checkPlanQualityAndAgentUtilization({
      state,
      events,
      repoRoot: repository,
    }),
  );

  let activeAgents: readonly unknown[] | undefined = undefined;
  if (state !== undefined) {
    const rawAgents = state.agents;
    if (Array.isArray(rawAgents)) {
      activeAgents = rawAgents;
    } else if (isJsonObject(rawAgents)) {
      const entries: unknown[] = [];
      for (const [id, val] of Object.entries(rawAgents)) {
        if (isJsonObject(val)) {
          entries.push({ id, ...val });
        } else {
          entries.push({ id, role: String(val) });
        }
      }
      activeAgents = entries;
    }
  }

  const engine18 = safeRunEngine("checkAgentCanonicalAlignment", () =>
    checkAgentCanonicalAlignment({ repoRoot: repository, activeAgents }),
  );

  const engine19 = safeRunEngine("checkCompanionAuditors", () =>
    checkCompanionAuditorsDoctor({
      repoRoot: repository,
      state,
      grants: stateGrants,
      events,
    }),
  );

  let activeHost: string | undefined = options.host;
  if (activeHost === undefined && state !== undefined) {
    if (typeof state["activeHost"] === "string" && state["activeHost"].trim().length > 0) {
      activeHost = state["activeHost"].trim();
    } else if (typeof state["host"] === "string" && state["host"].trim().length > 0) {
      activeHost = state["host"].trim();
    }
  }
  if (activeHost === undefined) {
    activeHost = detectActiveHost({
      env: typeof process !== "undefined" ? process.env : {},
    }).activeHost;
  }

  let resolvedQuota: number | null | undefined = options.quota;
  if (resolvedQuota === undefined && state !== undefined) {
    if (typeof state["quota"] === "number" && !Number.isNaN(state["quota"])) {
      resolvedQuota = state["quota"];
    } else if (
      isJsonObject(state["quota_telemetry"]) &&
      typeof state["quota_telemetry"]["lowestQuotaPercentage"] === "number"
    ) {
      resolvedQuota = state["quota_telemetry"]["lowestQuotaPercentage"] as number;
    } else if (
      isJsonObject(state["telemetry"]) &&
      typeof state["telemetry"]["lowestRemainingQuota"] === "number"
    ) {
      resolvedQuota = state["telemetry"]["lowestRemainingQuota"] as number;
    }
  }
  if (resolvedQuota === undefined) {
    const current = readCurrentQuota();
    if (typeof current === "number" && !Number.isNaN(current)) resolvedQuota = current;
  }
  const effectiveQuota = resolvedQuota ?? null;

  const engine20 = safeRunEngine("checkQuotaHealth", () => {
    const p = checkQuotaHealth({
      repoRoot: repository,
      host: activeHost,
      quota: effectiveQuota,
    });
    const bunGlobal =
      typeof Bun !== "undefined"
        ? (Bun as unknown as { peek?: <T>(promise: Promise<T>) => T })
        : undefined;
    const peeked = typeof bunGlobal?.peek === "function" ? bunGlobal.peek(p) : undefined;
    const peekedObj = peeked as unknown;
    if (
      peekedObj &&
      typeof peekedObj === "object" &&
      "findings" in peekedObj &&
      "passed" in peekedObj
    ) {
      return peekedObj as DoctorCheckEngineResult;
    }
    const direct = p as unknown;
    if (direct && typeof direct === "object" && "findings" in direct && "passed" in direct) {
      return direct as DoctorCheckEngineResult;
    }
    return {
      engine: "checkQuotaHealth",
      passed: true,
      findings: [],
    };
  });

  const engineResults: Record<string, DoctorCheckEngineResult> = {
    checkPlanningDag: engine1,
    checkAstPurity: engine2,
    checkAntiMockMutation: engine3,
    checkAntiBatchingIsolation: engine4,
    checkDualChannelUi: engine5,
    checkCognitiveValidatorCommandLock: engine6,
    checkRoleBoundaryInterlock: engine7,
    checkPushbackQuotas: engine8,
    checkPolicyDoctor: engine9,
    checkRepositoryHygiene: engine10,
    checkGitIndexIntegrity: engine11,
    checkMailboxHealth: engine12,
    checkWorktreeHealth: engine13,
    checkCliRegistryTaxonomy: engine14,
    checkTier0CompanionsHealth: engine15,
    checkAntiStagnationDoctor: engine16,
    checkPlanQualityAndAgentUtilization: engine17,
    checkAgentCanonicalAlignment: engine18,
    checkCompanionAuditors: engine19,
    checkQuotaHealth: engine20,
  };

  const allEngineFindings: readonly DoctorDiagnosticFinding[] = Object.values(
    engineResults,
  ).flatMap((e) => e.findings);
  const engineErrorIssues = allEngineFindings
    .filter((f) => f.severity === "ERROR")
    .map((f) => `${f.engine}: ${f.message}`);
  const engineWarnIssues = allEngineFindings
    .filter((f) => f.severity === "WARN")
    .map((f) => `[WARN] ${f.engine}: ${f.message}`);
  const engineInfoIssues = allEngineFindings
    .filter((f) => f.severity === "INFO")
    .map((f) => `[INFO] ${f.engine}: ${f.message}`);

  return {
    engineResults,
    allEngineFindings,
    engineErrorIssues,
    engineWarnIssues,
    engineInfoIssues,
  };
}
