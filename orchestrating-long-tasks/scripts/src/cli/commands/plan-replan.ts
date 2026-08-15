import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { formatPlanReplanBrief } from "../formatters/index.ts";
import {
  partitionFindingsIntoScopes,
  type FindingDetail,
} from "../../workflow/scope-partitioner.ts";
import { utc } from "../../workflow/task-state.ts";
import type { TaskRecord, GateRuntime } from "../../workflow/types.ts";
import { actorFlag, assertFlags, integerFlag, textFlag, type Flags } from "../options.ts";

export function planReplanCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "findings", "findings-file", "round", "actor", "gate"]);
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const findingsRaw = textFlag(flags, "findings", false);
  const findingsFile = textFlag(flags, "findings-file", false);
  const roundFlag = integerFlag(flags, "round");
  const fallbackGate = textFlag(flags, "gate", false) ?? "bun test tests";

  const loaded = loadRun(run);
  const state = loaded.state;

  let findingsToPartition: FindingDetail[] = [];

  if (findingsRaw || findingsFile) {
    let content = findingsRaw;
    if (!content && findingsFile) {
      try {
        content = readFileSync(findingsFile, "utf-8");
      } catch (err) {
        throw new HarnessError("INVALID_ARGUMENT", `cannot read findings file: ${findingsFile}`);
      }
    }
    if (content) {
      try {
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed)
          ? parsed
          : typeof parsed === "object" &&
              parsed !== null &&
              Array.isArray((parsed as Record<string, unknown>).findings)
            ? ((parsed as Record<string, unknown>).findings as unknown[])
            : [parsed];

        findingsToPartition = list.map((item: unknown, idx: number) => {
          const rec = (typeof item === "object" && item !== null ? item : {}) as Record<
            string,
            unknown
          >;
          return {
            id:
              typeof rec.id === "string" && rec.id.trim()
                ? rec.id.trim()
                : `finding-critic-${idx + 1}`,
            requirement_id: typeof rec.requirement_id === "string" ? rec.requirement_id : undefined,
            severity: (rec.severity as FindingDetail["severity"]) ?? "important",
            file_paths: Array.isArray(rec.file_paths)
              ? rec.file_paths.map(String)
              : typeof rec.file_path === "string"
                ? [rec.file_path]
                : typeof rec.path === "string"
                  ? [rec.path]
                  : [],
            observation:
              typeof rec.observation === "string"
                ? rec.observation
                : String(rec.finding ?? rec.message ?? "Defect observed"),
            remediation:
              typeof rec.remediation === "string" ? rec.remediation : "Address identified defect",
            revalidation_gate:
              typeof rec.revalidation_gate === "string" ? rec.revalidation_gate : fallbackGate,
          };
        });
      } catch {
        if (content.trim()) {
          findingsToPartition = [
            {
              id: "finding-critic-01",
              severity: "important",
              file_paths: [],
              observation: content.trim(),
              remediation: "Address identified defect",
              revalidation_gate: fallbackGate,
            },
          ];
        }
      }
    }
  }

  if (findingsToPartition.length === 0) {
    const criticReview = state.completion_review as
      | {
          findings?: {
            id: string;
            requirement_id?: string;
            severity?: string;
            file_paths?: string[];
            observation?: string;
            remediation?: string;
            revalidation?: string;
          }[];
        }
      | undefined;
    if (criticReview?.findings && criticReview.findings.length > 0) {
      findingsToPartition = criticReview.findings.map((f, idx) => ({
        id: f.id ?? `finding-critic-${idx + 1}`,
        requirement_id: f.requirement_id,
        severity: (f.severity as FindingDetail["severity"]) ?? "important",
        file_paths: f.file_paths ?? [],
        observation: f.observation ?? "Defect observed",
        remediation: f.remediation ?? "Address identified defect",
        revalidation_gate: f.revalidation ?? fallbackGate,
      }));
    }
  }

  if (findingsToPartition.length === 0) {
    throw new HarnessError("INVALID_STATE", "no findings available for replanning");
  }

  const currentTasks = Object.values(
    (state.tasks ?? {}) as Record<string, { repair_round?: number }>,
  );
  const maxRound = Math.max(0, ...currentTasks.map((t) => t.repair_round ?? 0));
  const repairRound = roundFlag ?? maxRound + 1;

  const clusters = partitionFindingsIntoScopes(findingsToPartition, repairRound);
  if (clusters.length === 0) {
    throw new HarnessError("INVALID_STATE", "scope partitioner generated 0 clusters");
  }

  const currentRev = (state.graph_revision as number | undefined) ?? 1;
  const nextRev = currentRev + 1;

  let totalTasksCount = 0;

  transact(
    run,
    actor,
    "plan-recompiled",
    {
      revision: nextRev,
      new_tasks: clusters.map((c) => c.taskId),
      repair_round: repairRound,
    },
    (draft) => {
      draft.plan_history ??= [];
      (draft.plan_history as Record<string, unknown>[]).push({
        revision: currentRev,
        tasks_count: Object.keys(draft.tasks ?? {}).length,
        archived_at: utc(new Date()),
      });

      draft.tasks ??= {};
      const draftTasks = draft.tasks as Record<string, TaskRecord>;

      for (const cluster of clusters) {
        draftTasks[cluster.taskId] = {
          id: cluster.taskId,
          status: "ready",
          requirement_ids: cluster.findings
            .map(
              (f) =>
                f.requirement_id ?? (draft.requirements as { id?: string }[])?.[0]?.id ?? "req-1",
            )
            .filter(Boolean),
          write_scope: [...cluster.writeScope],
          dependencies: [],
          attempts: [],
          history: [
            {
              at: utc(new Date()),
              actor,
              from: "proposed",
              to: "ready",
              reason: `Injected in Repair Wave ${repairRound}`,
              attempt: 1,
            },
          ],
          repair_round: repairRound,
          findings: cluster.findings.map((f) => ({
            id: f.id,
            requirement_id:
              f.requirement_id ?? (draft.requirements as { id?: string }[])?.[0]?.id ?? "req-1",
            severity: f.severity === "suggestion" ? "minor" : f.severity,
            observation: f.observation,
            evidence: [],
            remediation: f.remediation,
            revalidation: f.revalidation_gate ?? fallbackGate,
            status: "open",
          })),
        };

        draft.gates ??= [];
        const gateList = draft.gates as GateRuntime[];
        const gateId = `gate-${cluster.taskId}`;
        if (!gateList.some((g) => g.id === gateId)) {
          gateList.push({
            id: gateId,
            command: cluster.gateCommand as string[],
            cwd: ".",
            scope: "task",
            requirement_ids: draftTasks[cluster.taskId]!.requirement_ids,
            mandatory: true,
          });
        }
      }

      if (draft.completion_critic) {
        if (draft.completion_critic_history) {
          const hist = (
            draft.completion_critic_history as { attempt: number; status: string }[]
          ).find((h) => h.attempt === (draft.completion_critic as { attempt?: number })?.attempt);
          if (hist) hist.status = "expired";
        }
        delete (draft as { completion_critic?: unknown }).completion_critic;
      }

      delete (draft as { completion_review?: unknown }).completion_review;
      draft.graph_revision = nextRev;
      totalTasksCount = Object.keys(draftTasks).length;
    },
  );

  const markdown = formatPlanReplanBrief({
    revision: nextRev,
    repairRound,
    newTasksCount: clusters.length,
    repairTasks: clusters.map((c) => ({
      id: c.taskId,
      writeScope: c.writeScope,
      findingsCount: c.findings.length,
    })),
    runId: basename(run),
  });

  return {
    markdown,
    run_root: run,
    revision: nextRev,
    repair_round: repairRound,
    new_tasks: clusters.map((c) => c.taskId),
    repair_tasks: clusters,
    total_tasks: totalTasksCount,
  };
}
