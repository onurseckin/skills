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
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./engines.ts";

import { checkAgentCanonicalAlignment } from "./agent-canonical-engine.ts";
import { checkCompanionAuditorsDoctor } from "./rules/companion-auditors.ts";

export interface DiagnosticCollectionOptions {
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly testPaths?: readonly string[] | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
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
    const rawAgents: readonly unknown[] = state.agents;
    const extractedIds: string[] = [];
    for (const a of rawAgents) {
      if (typeof a === "string") {
        if (a.length > 0) {
          extractedIds.push(a);
        }
      } else if (isJsonObject(a)) {
        if (typeof a.id === "string") {
          if (a.id.length > 0) {
            extractedIds.push(a.id);
          }
        } else if (typeof a.agentId === "string") {
          if (a.agentId.length > 0) {
            extractedIds.push(a.agentId);
          }
        }
      }
    }
    activeAgentIds = extractedIds;
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
