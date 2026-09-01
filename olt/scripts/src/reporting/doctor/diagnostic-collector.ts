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
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./engines.ts";

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
    return {
      engine: name,
      passed: false,
      findings: [
        {
          code: "DOCTOR_ENGINE_FAULT",
          severity: "ERROR",
          engine: name,
          message: `Engine fault in ${name}: ${err instanceof Error ? err.message : String(err)}`,
          details: { error: err instanceof Error ? (err.stack ?? err.message) : String(err) },
        },
      ],
    };
  }
}

export function collectDiagnosticEngines(
  options: DiagnosticCollectionOptions,
): DiagnosticCollectionResult {
  const repository = options.repoRoot;
  const state = options.state;
  const events = options.events as readonly Record<string, unknown>[] | undefined;

  const engine1 = safeRunEngine("checkPlanningDag", () =>
    checkPlanningDag({
      tasks: (state?.tasks as Record<string, unknown> | undefined) ?? null,
      graph: (state?.graph as { nodes?: []; edges?: [] } | undefined) ?? null,
    }),
  );

  const engine2 = safeRunEngine("checkAstPurity", () =>
    checkAstPurity({
      repoRoot: repository,
      writeScope: options.writeScope ?? [],
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
      state: (state as Record<string, unknown> | undefined) ?? null,
      tasks: (state?.tasks as Record<string, unknown> | undefined) ?? null,
      grants: (state?.grants as readonly unknown[] | undefined) ?? null,
    }),
  );

  const engine5 = safeRunEngine("checkDualChannelUi", () => checkDualChannelUi());

  const engine6 = safeRunEngine("checkCognitiveValidatorCommandLock", () =>
    checkCognitiveValidatorCommandLock({
      state: (state as Record<string, unknown> | undefined) ?? null,
      commands: (state?.commands as Record<string, unknown> | undefined) ?? null,
      events: events ?? null,
      grants: (state?.grants as readonly unknown[] | undefined) ?? null,
    }),
  );

  const engine7 = safeRunEngine("checkRoleBoundaryInterlock", () =>
    checkRoleBoundaryInterlock({
      state: (state as Record<string, unknown> | undefined) ?? null,
      commands: (state?.commands as Record<string, unknown> | undefined) ?? null,
      events: events ?? null,
      grants: (state?.grants as readonly unknown[] | undefined) ?? null,
    }),
  );

  const engine8 = safeRunEngine("checkPushbackQuotas", () =>
    checkPushbackQuotas({
      state: (state as Record<string, unknown> | undefined) ?? null,
      tasks: (state?.tasks as Record<string, unknown> | undefined) ?? null,
      events: events ?? null,
      repoRoot: repository,
    }),
  );

  const engine9 = safeRunEngine("checkPolicyDoctor", () =>
    checkPolicyDoctor({
      repoRoot: repository,
      state: (state as Record<string, unknown> | undefined) ?? null,
      tasks: (state?.tasks as Record<string, unknown> | undefined) ?? null,
      commands: (state?.commands as Record<string, unknown> | undefined) ?? null,
      events: events ?? null,
      grants: (state?.grants as readonly unknown[] | undefined) ?? null,
    }),
  );

  const engine10 = safeRunEngine("checkRepositoryHygiene", () => {
    const hygieneResult = checkRepositoryHygiene({ repoRoot: repository });
    return {
      engine: "checkRepositoryHygiene",
      passed: hygieneResult.passed,
      findings: hygieneResult.violations.map((v) => ({
        code: v.violationType,
        severity: v.severity,
        engine: "checkRepositoryHygiene",
        message: v.message,
        details: { path: v.path, violationType: v.violationType },
      })),
    };
  });

  const engine11 = safeRunEngine("checkGitIndexIntegrity", () => {
    const gitIndexResult = checkGitIndexIntegrity({ repoRoot: repository });
    return {
      engine: "checkGitIndexIntegrity",
      passed: gitIndexResult.healthy,
      findings: gitIndexResult.findings,
    };
  });

  const engine12 = safeRunEngine("checkMailboxHealth", () =>
    checkMailboxHealth({ repoRoot: repository }),
  );

  const engine13 = safeRunEngine("checkWorktreeHealth", () => {
    const worktreeResult = checkWorktreeHealth({ repoRoot: repository });
    return {
      engine: "checkWorktreeHealth",
      passed: worktreeResult.healthy,
      findings: worktreeResult.findings,
    };
  });

  const engine14 = safeRunEngine("checkCliRegistryTaxonomy", () => checkCliRegistryTaxonomy());

  const engine15 = safeRunEngine("checkTier0CompanionsHealth", () =>
    checkTier0CompanionsHealth({
      state: (state as Record<string, unknown> | undefined) ?? null,
      repoRoot: repository,
    }),
  );

  const engine16 = safeRunEngine("checkAntiStagnationDoctor", () =>
    checkAntiStagnationDoctor({
      repoRoot: repository,
      state: (state as Record<string, unknown> | undefined) ?? null,
      events: events ?? null,
      commands: (state?.commands as Record<string, unknown> | undefined) ?? null,
      grants: (state?.grants as readonly unknown[] | undefined) ?? null,
    }),
  );

  const allEngineFindings: DoctorDiagnosticFinding[] = [
    ...engine1.findings,
    ...engine2.findings,
    ...engine3.findings,
    ...engine4.findings,
    ...engine5.findings,
    ...engine6.findings,
    ...engine7.findings,
    ...engine8.findings,
    ...engine9.findings,
    ...engine10.findings,
    ...engine11.findings,
    ...engine12.findings,
    ...engine13.findings,
    ...engine14.findings,
    ...engine15.findings,
    ...engine16.findings,
  ];

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
    engineResults: {
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
    },
    allEngineFindings,
    engineErrorIssues,
    engineWarnIssues,
    engineInfoIssues,
  };
}
