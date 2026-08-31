import { HarnessError } from "../../core/errors/index.ts";
import { normalizeScope, checkScopeListOverlap } from "./scopes.ts";
import { validateTopologyAcyclicity } from "./acyclicity.ts";
import { computeCriticalPath } from "./critical-path.ts";
import { assertDominatingSkillQuality } from "./quality.ts";
import { partitionTopologyWaves } from "./waves.ts";
import type {
  SynthesizedTaskSpec,
  SynthesizedTopology,
  TopologyDecisionRecord,
  TopologySynthesisSpec,
} from "./types.ts";

export function synthesizeDAGTopology(spec: TopologySynthesisSpec): SynthesizedTopology {
  if (!spec.tasks || spec.tasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "TopologySynthesisSpec must contain at least one task",
    );
  }

  const taskMap = new Map<string, SynthesizedTaskSpec>();
  for (const t of spec.tasks) {
    const id = t.id.trim();
    if (!id) {
      throw new HarnessError("INVALID_ARGUMENT", "Task ID must be non-empty");
    }
    if (taskMap.has(id)) {
      throw new HarnessError("INVALID_ARGUMENT", `Duplicate task ID: ${id}`);
    }
    const rawDeps = t.dependencies !== undefined ? t.dependencies : [];
    taskMap.set(id, {
      ...t,
      id,
      writeScope: t.writeScope.map(normalizeScope),
      dependencies: rawDeps.map((d) => d.trim()).filter(Boolean),
    });
  }

  if (spec.dependencyRules) {
    for (const rule of spec.dependencyRules) {
      const fromId = rule.from.trim();
      const toId = rule.to.trim();

      if (!taskMap.has(fromId)) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Dependency rule references unknown task '${fromId}'`,
        );
      }
      if (!taskMap.has(toId)) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Dependency rule references unknown task '${toId}'`,
        );
      }

      const targetTask = taskMap.get(toId)!;
      const targetDeps = targetTask.dependencies !== undefined ? targetTask.dependencies : [];
      const currentDeps = new Set(targetDeps);
      currentDeps.add(fromId);

      taskMap.set(toId, {
        ...targetTask,
        dependencies: Array.from(currentDeps),
      });
    }
  }

  const resolvedTasks = Array.from(taskMap.values());
  const acyclicity = validateTopologyAcyclicity(resolvedTasks, { strict: true });

  const maxParallel =
    typeof spec.maxParallel === "number" && spec.maxParallel > 0 ? spec.maxParallel : 4;
  const waves = partitionTopologyWaves(resolvedTasks, maxParallel);

  const { criticalPath, criticalDepth } = computeCriticalPath(
    resolvedTasks,
    acyclicity.topologicalOrder,
  );

  const totalEffort = resolvedTasks.reduce((sum, t) => {
    const effort = typeof t.effort === "number" && t.effort > 0 ? t.effort : 1;
    return sum + effort;
  }, 0);

  const qualityReport = assertDominatingSkillQuality({
    codeSnippets: spec.codeSnippets,
    strict: spec.enforceZeroAny === true || spec.enforceZeroSuppressions === true,
    qualityThreshold: spec.targetSkillQuality,
  });

  const taskWaveMap = new Map<string, number>();
  for (const w of waves) {
    for (const tid of w.taskIds) {
      taskWaveMap.set(tid, w.wave);
    }
  }

  const decisions: TopologyDecisionRecord[] = [];
  for (const t of resolvedTasks) {
    const assignedWave = taskWaveMap.get(t.id);
    const wave = assignedWave !== undefined ? assignedWave : 1;
    const wavePlan = waves.find((w) => w.wave === wave);
    const waveTaskIds = wavePlan !== undefined ? wavePlan.taskIds : [];
    const parallelWith = waveTaskIds.filter((id) => id !== t.id);

    const deps = t.dependencies !== undefined ? t.dependencies : [];
    let reason: TopologyDecisionRecord["reason"] = "priority_capacity";
    let rationale = `Placed in wave ${wave} with ${parallelWith.length} concurrent task(s)`;

    if (deps.length > 0) {
      reason = "dependency";
      rationale = `Serialized after prerequisites [${deps.join(", ")}]`;
    } else if (wave > 1) {
      let hadScopeConflict = false;
      let conflictingTaskId = "";
      for (let prevWave = 1; prevWave < wave; prevWave++) {
        const prevWavePlan = waves.find((w) => w.wave === prevWave);
        const prevTaskIds = prevWavePlan !== undefined ? prevWavePlan.taskIds : [];
        for (const prevId of prevTaskIds) {
          const prevTask = taskMap.get(prevId);
          if (prevTask && checkScopeListOverlap(t.writeScope, prevTask.writeScope).overlap) {
            hadScopeConflict = true;
            conflictingTaskId = prevId;
            break;
          }
        }
        if (hadScopeConflict) break;
      }

      if (hadScopeConflict) {
        reason = "write_scope_conflict";
        rationale = `Serialized into wave ${wave} due to write scope overlap with [${conflictingTaskId}]`;
      }
    }

    decisions.push({
      taskId: t.id,
      wave,
      parallelWith,
      serializedAfter: deps,
      reason,
      rationale,
    });
  }

  return {
    schema: "orchestrator.synthesized_topology",
    version: 1,
    revision: 1,
    tasks: resolvedTasks,
    waves,
    decisions,
    maxParallel,
    criticalPath,
    criticalDepth,
    totalEffort,
    qualityScore: qualityReport.score,
    isAcyclic: true,
    metadata: {
      objective: spec.objective,
      prompt: spec.prompt,
    },
  };
}
