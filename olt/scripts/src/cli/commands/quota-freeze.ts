import {
  captureDagSnapshot,
  persistDagSnapshot,
  formatDagSnapshotMarkdown,
} from "../../telemetry/dag-snapshot.ts";
import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import { QuotaCircuitBreaker } from "../../telemetry/circuit-breaker.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  executeGracefulSoftExit,
  type SoftExitExecutionParams,
} from "../../telemetry/soft-drain/index.ts";
import { autoDeriveCallerIdentity } from "../../authority/session/index.ts";

export interface QuotaFreezeContext extends CommandContext {
  readonly gitRunner?: SoftExitExecutionParams["gitRunner"] | undefined;
  readonly refreshHandoffFn?: SoftExitExecutionParams["refreshHandoffFn"] | undefined;
}

function assertCallerAuthorization(
  flags: Flags,
  context: QuotaFreezeContext | CommandContext | undefined,
  runRoot: string,
): void {
  const caller = context?.authenticatedCaller;
  const actor = textFlag(flags, "actor", false);

  if (caller !== undefined) {
    if (!caller.verified) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        "quota:freeze requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority",
      );
    }
    if (actor !== undefined && actor !== caller.actor && actor !== caller.role) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `Actor spoofing blocked: caller verified as '${caller.actor}' (${caller.role}) cannot execute as '${actor}'. Session tokens authenticate their holder and cannot delegate another agent's durable grant.`,
      );
    }
    if (caller.role !== "mind" && caller.role !== "orchestrator") {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `role ${caller.role} may not invoke quota:freeze: quota operations require mind or orchestrator role`,
      );
    }
    return;
  }

  if (actor !== undefined) {
    const derived = autoDeriveCallerIdentity({
      runRoot,
      explicitActor: actor,
    });
    if (!derived.verified) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        "quota:freeze requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority",
      );
    }
    if (derived.role !== "mind" && derived.role !== "orchestrator") {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `role ${derived.role} may not invoke quota:freeze: quota operations require mind or orchestrator role`,
      );
    }
    return;
  }

  if (context !== undefined) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      "quota:freeze requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority",
    );
  }
}

export async function quotaFreezeCommand(
  flags: Flags,
  context?: QuotaFreezeContext | CommandContext,
  _remainder?: readonly string[],
  env?: CollectorEnvironment,
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const loaded = loadRun(run, false);
  const repo = findRepoRoot(loaded.runRoot);
  const requestedRepo = textFlag(flags, "repo", false);
  if (requestedRepo !== undefined && findRepoRoot(requestedRepo) !== repo) {
    throw new HarnessError(
      "PATH_SAFETY",
      "quota:freeze --repo must resolve to the verified run repository",
    );
  }

  assertCallerAuthorization(flags, context, loaded.runRoot);

  const rawThreshold = textFlag(flags, "threshold", false);
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : 10.0;
  const activeAgentsCount = integerFlag(flags, "active-agents", { required: false }) ?? 0;
  const force = boolFlag(flags, "force");
  const jsonOutput = boolFlag(flags, "json");
  const detailed = boolFlag(flags, "detailed");

  const collectors = createDefaultCollectors(env);
  const engine = new TelemetryNormalizationEngine(collectors);
  const report = await engine.probeAll();

  const breaker = new QuotaCircuitBreaker();
  const evaluation = breaker.evaluate(report, {
    thresholdPercentage: isNaN(threshold) ? 10.0 : threshold,
    activeAgentsCount,
  });

  if (!evaluation.isTriggered && !force) {
    return {
      status: "healthy",
      message: "Quota is healthy. Use --force to freeze anyway.",
      json: jsonOutput,
      isTriggered: evaluation.isTriggered,
      markdown: "Quota is healthy. Freeze skipped. Use `--force` to freeze anyway.",
    };
  }

  const freezeContext = context as QuotaFreezeContext | undefined;
  const softExit = await executeGracefulSoftExit({
    runRoot: loaded.runRoot,
    repoRoot: repo,
    lowestQuota: evaluation.lowestRemainingQuota ?? 0,
    ...(freezeContext?.gitRunner !== undefined ? { gitRunner: freezeContext.gitRunner } : {}),
    ...(freezeContext?.refreshHandoffFn !== undefined
      ? { refreshHandoffFn: freezeContext.refreshHandoffFn }
      : {}),
  });

  const snapshot = await captureDagSnapshot({
    runRoot: loaded.runRoot,
    repositoryRoot: repo,
    lowestQuotaObserved: evaluation.lowestRemainingQuota,
    constrainedModels: evaluation.constrainedModels.map((m) => m.modelName),
    resetTime: evaluation.autoWakeSchedule?.targetWakeupIso ?? new Date().toISOString(),
  });
  persistDagSnapshot(snapshot);

  const markdown = formatDagSnapshotMarkdown(snapshot, evaluation, detailed);

  return {
    status: "frozen",
    snapshot,
    evaluation,
    softExit,
    handoffPath: softExit.handoffPath,
    stagedCommitSha: softExit.stagedCommitSha,
    json: jsonOutput,
    markdown,
  };
}
