import type { ContextAnchor, CognitivePromptOptions } from "./types.ts";

export function extractContextAnchors(
  options: CognitivePromptOptions = {},
): readonly ContextAnchor[] {
  const anchors: ContextAnchor[] = [];

  // 1. Invariant Anchors
  anchors.push({
    category: "invariant",
    title: "Zero Suppressions & 100% Type Soundness",
    detail:
      "0 any annotations, 0 @ts-ignore, 0 @ts-expect-error, 0 eslint-disable. All modifications must be 100% type safe.",
  });

  anchors.push({
    category: "invariant",
    title: "5-Minute SLA Boundary & Zero-Chatter Interlock",
    detail:
      "Every single task execution must complete within 300 seconds. No ungrounded conversational chitchat; emit only structured tool calls and evidenced reports.",
  });

  // 2. Model Tier & Thinking Anchors
  const host = options.host ?? "host-runtime";
  const modelTier = options.modelTier ?? "Tier 3 Implementer";
  const thinkingLevel = options.thinkingLevel ?? "high";

  anchors.push({
    category: "model_tier",
    title: `Host & Thinking Policy: ${host.toUpperCase()}`,
    detail: `Current tier: ${modelTier} | Thinking enforcement: ${thinkingLevel}. Tier 0-2 MUST operate with thinking level "high". Tier 3 operates with "medium" or "high".`,
  });

  // 3. Topology & Task State Anchors
  if (options.state !== undefined) {
    const tasksObj =
      typeof options.state["tasks"] === "object" && options.state["tasks"] !== null
        ? (options.state["tasks"] as Record<string, unknown>)
        : {};
    const taskList = Object.values(tasksObj);
    const total = taskList.length;

    let readyCount = 0;
    let leasedCount = 0;
    let doneCount = 0;
    let failedCount = 0;

    for (const t of taskList) {
      if (typeof t === "object" && t !== null) {
        const record = t as Record<string, unknown>;
        const status = record["status"];
        if (status === "ready" || status === "retry_ready") readyCount++;
        else if (status === "leased") leasedCount++;
        else if (status === "done" || status === "validated") doneCount++;
        else if (status === "failed" || status === "cancelled") failedCount++;
      }
    }

    anchors.push({
      category: "topology",
      title: `Task Graph Topology (${doneCount}/${total} Done)`,
      detail: `Ready: ${readyCount} | Leased: ${leasedCount} | Done: ${doneCount} | Failed/Cancelled: ${failedCount}`,
    });
  } else {
    const ready = options.readyTasks?.length ?? 0;
    const active = options.activeTasks?.length ?? 0;
    const blocked = options.blockedTasks?.length ?? 0;

    anchors.push({
      category: "topology",
      title: "Task Queue Overview",
      detail: `Ready tasks: ${ready} | Active leased tasks: ${active} | Blocked tasks: ${blocked}`,
    });
  }

  // 4. Zero-Streak / Quiescence Anchor
  const streak = options.zeroValueStreak ?? 0;
  if (streak > 0) {
    anchors.push({
      category: "lease",
      title: `Quiescence Tracker (Streak: ${streak})`,
      detail:
        streak >= 5
          ? `⚠️ Critical zero-delta streak (${streak} cycles). Mind agent MUST innovate and admit new capabilities.`
          : `Current zero-delta streak: ${streak} cycles. Maintain active vigilance.`,
    });
  }

  return anchors;
}
