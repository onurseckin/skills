import {
  generateAgentStatusBadge,
  generateAsciiDagBadges,
  generateQuotaBudgetBadge,
  generateSchedulerTelemetryBanner,
  generateStagnationBadge,
  generateWaveLaneBadges,
  type WaveLaneBadgeItem,
} from "../diagnostics/ascii-badges.ts";
import { evaluateProgressDiff, extractSchedulerSnapshot } from "./diff-evaluator.ts";
import { detectStagnation } from "./stagnation-detector.ts";
import type {
  SchedulerLivePushBadges,
  SchedulerLivePushReport,
  SchedulerLiveReportOptions,
} from "./types.ts";

export function buildSchedulerLivePushReport(
  options: SchedulerLiveReportOptions,
): SchedulerLivePushReport {
  const nowMs = options.nowMs ?? Date.now();
  const pushedAt = new Date(nowMs).toISOString();

  // 1. Current Snapshot
  const currentSnapshot = extractSchedulerSnapshot(options.state, {
    runRoot: options.runRoot,
    nowMs,
    budget: options.budget,
  });

  // 2. Previous Snapshot
  const previousSnapshot =
    options.previousSnapshot ??
    (options.previousState
      ? extractSchedulerSnapshot(options.previousState, {
          runRoot: options.runRoot,
          nowMs,
          budget: options.budget,
        })
      : null);

  // 3. Diff Evaluation
  const diff = evaluateProgressDiff(
    currentSnapshot,
    previousSnapshot,
    options.zeroValueStreak ?? 0,
  );

  // 4. Stagnation Detection
  const stagnation = detectStagnation({
    diff,
    snapshot: currentSnapshot,
    zeroValueStreak: options.zeroValueStreak,
    warningThreshold: options.stagnationWarningThreshold,
    criticalThreshold: options.stagnationCriticalThreshold,
  });

  // 5. ASCII Badges Generation
  const dagBadges = generateAsciiDagBadges(options.state);
  const agentBadge = generateAgentStatusBadge(currentSnapshot.activeAgents);
  const quotaBadge = generateQuotaBudgetBadge(options.budget ?? {});
  const waveLaneItems: WaveLaneBadgeItem[] = currentSnapshot.waves.map((w) => ({
    wave: w.wave,
    lane_count: w.laneCount,
    status: w.status,
    is_active: w.isActive,
  }));
  const waveLaneBadges = generateWaveLaneBadges(waveLaneItems);
  const stagnationBadge = generateStagnationBadge(stagnation.streak, stagnation.isStagnating);

  const waveBadgeStr = waveLaneBadges.length > 0 ? waveLaneBadges.slice(0, 2).join(" ") : undefined;
  const telemetryBanner = generateSchedulerTelemetryBanner({
    stagnationBadge,
    quotaBadge,
    agentBadge,
    waveBadge: waveBadgeStr,
    dagBadges: dagBadges.slice(0, 4),
  });

  const asciiBadges: SchedulerLivePushBadges = {
    dagBadges,
    agentBadge,
    quotaBadge,
    waveLaneBadges,
    stagnationBadge,
    telemetryBanner,
  };

  // 6. Format Markdown Output
  const markdown = formatSchedulerLivePushMarkdown({
    options,
    snapshot: currentSnapshot,
    diff,
    stagnation,
    asciiBadges,
    pushedAt,
  });

  // 7. Event Ledger Payload
  const eventLedgerEntry = {
    kind: "scheduler-live-push",
    timestamp: pushedAt,
    payload: {
      run_root: options.runRoot,
      pulse_id: options.pulseId ?? null,
      actor: options.actor ?? "mind",
      host: options.host ?? "unknown",
      total_tasks: currentSnapshot.totalTasks,
      completed_tasks: currentSnapshot.completedTasks,
      leased_tasks: currentSnapshot.leasedTasks,
      ready_tasks: currentSnapshot.readyTasks,
      active_agents_count: currentSnapshot.activeAgents.length,
      active_wave: currentSnapshot.activeWave,
      total_waves: currentSnapshot.totalWaves,
      is_stagnating: stagnation.isStagnating,
      stagnation_level: stagnation.level,
      stagnation_streak: stagnation.streak,
      diff_summary: diff.summary,
      dag_badges: dagBadges,
      telemetry_banner: telemetryBanner,
    },
  };

  return {
    markdown,
    snapshot: currentSnapshot,
    diff,
    stagnation,
    asciiBadges,
    eventLedgerEntry,
    pushedAt,
    isStagnating: stagnation.isStagnating,
  };
}

export function formatSchedulerLivePushMarkdown(params: {
  readonly options: SchedulerLiveReportOptions;
  readonly snapshot: ReturnType<typeof extractSchedulerSnapshot>;
  readonly diff: ReturnType<typeof evaluateProgressDiff>;
  readonly stagnation: ReturnType<typeof detectStagnation>;
  readonly asciiBadges: SchedulerLivePushBadges;
  readonly pushedAt: string;
}): string {
  const { options, snapshot, diff, stagnation, asciiBadges, pushedAt } = params;
  const lines: string[] = [];

  const pulseTitle = options.pulseId ? ` (Pulse: ${options.pulseId})` : "";
  lines.push(`## 📊 Scheduler Live Progress Report${pulseTitle}`);
  lines.push(`- **Run**: \`${options.runRoot}\``);
  lines.push(`- **Timestamp**: \`${pushedAt}\``);
  if (options.actor) lines.push(`- **Actor**: \`${options.actor}\``);
  if (options.host) lines.push(`- **Host**: \`${options.host}\``);

  lines.push("");
  lines.push(`> \`${asciiBadges.telemetryBanner}\``);
  lines.push("");

  // Progress Bar & Overview
  const pct =
    snapshot.totalTasks > 0
      ? Math.round((snapshot.completedTasks / snapshot.totalTasks) * 100)
      : 0;
  const progressBarBlocks = Math.round(pct / 10);
  const bar = `[${"█".repeat(progressBarBlocks)}${"░".repeat(10 - progressBarBlocks)}] ${pct}%`;

  lines.push(`### 📈 Progress Overview: ${bar}`);
  lines.push(
    `- **Tasks**: ${snapshot.completedTasks}/${snapshot.totalTasks} Done | ${snapshot.leasedTasks} Leased | ${snapshot.readyTasks} Ready | ${snapshot.proposedTasks} Proposed | ${snapshot.failedTasks} Failed`,
  );
  lines.push(
    `- **Topology**: Wave ${snapshot.activeWave ?? "Complete"}/${snapshot.totalWaves} Active | ${snapshot.activeAgents.length} Active Subagents`,
  );

  // Delta Transitions
  if (diff.hasPrevious) {
    lines.push("");
    lines.push(`### 🔄 Progress Delta (Previous vs Current)`);
    lines.push(`- **Summary**: ${diff.summary}`);
    if (diff.newlyCompletedTaskIds.length > 0) {
      lines.push(`- **Newly Completed**: ${diff.newlyCompletedTaskIds.map((id) => `\`${id}\``).join(", ")}`);
    }
    if (diff.newlyLeasedTaskIds.length > 0) {
      lines.push(`- **Newly Leased**: ${diff.newlyLeasedTaskIds.map((id) => `\`${id}\``).join(", ")}`);
    }
    if (diff.newlyReadyTaskIds.length > 0) {
      lines.push(`- **Newly Ready**: ${diff.newlyReadyTaskIds.map((id) => `\`${id}\``).join(", ")}`);
    }
    if (diff.newlyFailedTaskIds.length > 0) {
      lines.push(`- **Newly Failed**: ${diff.newlyFailedTaskIds.map((id) => `\`${id}\``).join(", ")}`);
    }
  }

  // Wave Lanes & Badges
  if (asciiBadges.waveLaneBadges.length > 0) {
    lines.push("");
    lines.push(`### 🌊 Wave Concurrency`);
    for (const b of asciiBadges.waveLaneBadges) {
      lines.push(`- ${b}`);
    }
  }

  if (asciiBadges.dagBadges.length > 0) {
    lines.push("");
    lines.push(`### 🏷️ ASCII DAG Task Badges`);
    lines.push(`\`\`\`text`);
    for (const b of asciiBadges.dagBadges) {
      lines.push(b);
    }
    lines.push(`\`\`\``);
  }

  // Active Agents
  if (snapshot.activeAgents.length > 0) {
    lines.push("");
    lines.push(`### 🤖 Active Agents`);
    for (const a of snapshot.activeAgents) {
      const taskStr = a.task_id ? ` -> Task \`${a.task_id}\`` : " (unassigned)";
      lines.push(`- **${a.id}** (\`${a.role}\` on \`${a.host}\`)${taskStr}`);
    }
  }

  // Stagnation Warning Block
  if (stagnation.level !== "none") {
    lines.push("");
    const alertEmoji = stagnation.level === "critical" ? "🚨" : "⚠️";
    lines.push(`### ${alertEmoji} Stagnation Alert [${stagnation.level.toUpperCase()}]`);
    lines.push(`- **Observation**: ${stagnation.reason}`);
    lines.push(`- **Remediation**: ${stagnation.remediation}`);
  }

  // Quota Headroom
  if (options.budget) {
    lines.push("");
    lines.push(`### ⏳ Quota & Budget Headroom`);
    lines.push(`- ${asciiBadges.quotaBadge}`);
  }

  return lines.join("\n");
}
