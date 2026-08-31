import { HarnessError } from "../../core/errors/index.ts";
import { synthesizeDAGTopology } from "./synthesis.ts";
import type {
  CriticFeedbackAdjustment,
  DependencyRule,
  SynthesizedTaskSpec,
  SynthesizedTopology,
  TopologySynthesisSpec,
} from "./types.ts";

export function adaptTopologyWithCriticFeedback(
  currentTopology: SynthesizedTopology,
  feedback: CriticFeedbackAdjustment,
): SynthesizedTopology {
  if (feedback.criticDecision === "escalated") {
    throw new HarnessError(
      "INVALID_STATE",
      `Critic escalated feedback [${feedback.feedbackId}]: ${feedback.feedbackSummary}`,
    );
  }

  if (feedback.criticDecision === "approve") {
    return {
      ...currentTopology,
      revision: currentTopology.revision + 1,
      metadata: {
        ...currentTopology.metadata,
        lastCriticDecision: "approve",
        lastFeedbackId: feedback.feedbackId,
        approvedRound: feedback.roundNumber,
      },
    };
  }

  let updatedTasks: SynthesizedTaskSpec[] = [...currentTopology.tasks];

  if (feedback.splitTasks && feedback.splitTasks.length > 0) {
    for (const split of feedback.splitTasks) {
      const parentIdx = updatedTasks.findIndex((t) => t.id === split.parentTaskId);
      if (parentIdx >= 0) {
        const parentTask = updatedTasks[parentIdx]!;
        const subTasksWithDeps = split.subTasks.map((st) => {
          const stDeps = st.dependencies !== undefined ? st.dependencies : [];
          const parentDeps = parentTask.dependencies !== undefined ? parentTask.dependencies : [];
          return {
            ...st,
            dependencies: [...stDeps, ...parentDeps],
          };
        });

        updatedTasks.splice(parentIdx, 1, ...subTasksWithDeps);

        const subTaskIds = split.subTasks.map((st) => st.id);
        updatedTasks = updatedTasks.map((t) => {
          const tDeps = t.dependencies !== undefined ? t.dependencies : [];
          if (tDeps.includes(split.parentTaskId)) {
            const newDeps = t.dependencies!.filter((d) => d !== split.parentTaskId);
            newDeps.push(...subTaskIds);
            return { ...t, dependencies: Array.from(new Set(newDeps)) };
          }
          return t;
        });
      }
    }
  }

  if (feedback.newTasks && feedback.newTasks.length > 0) {
    const existingIds = new Set(updatedTasks.map((t) => t.id));
    for (const nt of feedback.newTasks) {
      if (!existingIds.has(nt.id)) {
        updatedTasks.push(nt);
        existingIds.add(nt.id);
      }
    }
  }

  const extraRules: DependencyRule[] = [];
  if (feedback.reorderRules && feedback.reorderRules.length > 0) {
    for (const rule of feedback.reorderRules) {
      for (const afterId of rule.serializeAfter) {
        extraRules.push({
          from: afterId,
          to: rule.taskId,
          reason: rule.reason,
        });
      }
    }
  }

  if (feedback.skillEnhancements && feedback.skillEnhancements.length > 0) {
    const skillMap = new Map(feedback.skillEnhancements.map((se) => [se.taskId, se]));

    updatedTasks = updatedTasks.map((t) => {
      const enhancement = skillMap.get(t.id);
      if (enhancement) {
        const tSkills = t.requiredSkills !== undefined ? t.requiredSkills : [];
        const currentSkills = new Set(tSkills);
        currentSkills.add(enhancement.requiredSkill);
        return {
          ...t,
          requiredSkills: Array.from(currentSkills),
        };
      }
      return t;
    });
  }

  const metaObj =
    currentTopology.metadata !== undefined ? currentTopology.metadata.objective : undefined;
  const objective = typeof metaObj === "string" ? metaObj : "Adapted Topology";
  const metaPrompt =
    currentTopology.metadata !== undefined ? currentTopology.metadata.prompt : undefined;
  const prompt = typeof metaPrompt === "string" ? metaPrompt : "";

  const newSpec: TopologySynthesisSpec = {
    objective,
    prompt,
    tasks: updatedTasks,
    maxParallel: currentTopology.maxParallel,
    dependencyRules: extraRules,
  };

  const adapted = synthesizeDAGTopology(newSpec);

  return {
    ...adapted,
    version: currentTopology.version,
    revision: currentTopology.revision + 1,
    metadata: {
      ...currentTopology.metadata,
      lastCriticDecision: feedback.criticDecision,
      lastFeedbackId: feedback.feedbackId,
      feedbackRound: feedback.roundNumber,
      feedbackSummary: feedback.feedbackSummary,
    },
  };
}
