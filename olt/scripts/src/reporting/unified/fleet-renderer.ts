import type { FleetReportData } from "./fleet-builder.ts";
import { padOptical } from "../sugiyama-dag/render-box.ts";

export function formatFleetDashboard(fleetData: FleetReportData): string {
  const { stats, capsules, agentRoster } = fleetData;
  const sections: string[] = [];

  const width = 85;
  const contentWidth = width - 4;
  const topBorder = "┌" + "─".repeat(width - 2) + "┐";
  const midBorder = "├" + "─".repeat(width - 2) + "┤";
  const botBorder = "└" + "─".repeat(width - 2) + "┘";

  const titleText = "GLOBAL FLEET SNAPSHOT DASHBOARD (`bun harness.ts report`)";
  const line1 = `Active Fleets: ${stats.activeFleets} | Total Subagents: ${stats.totalSubagents} | Global Tasks: ${stats.globalTasks} | Total Waves: ${stats.totalWaves}`;
  const line2 = `Overall Occupancy: ${stats.occupancy.coding} Coding | ${stats.occupancy.validating} Validating | ${stats.occupancy.standby} Standby | ${stats.occupancy.satisfied} Satisfied`;
  const line3 = `Supervisory Health: Mind [${stats.supervisoryHealth.mind}] • Mind Auditor [${stats.supervisoryHealth.mindAuditor}] • Skill Auditor [${stats.supervisoryHealth.skillAuditor}]`;

  const banner = [
    topBorder,
    `│ ${padOptical(titleText, contentWidth, "center")} │`,
    midBorder,
    `│ ${padOptical(line1, contentWidth, "left")} │`,
    `│ ${padOptical(line2, contentWidth, "left")} │`,
    `│ ${padOptical(line3, contentWidth, "left")} │`,
    botBorder,
  ].join("\n");

  sections.push(banner);
  sections.push("");

  // Section 1: Whole-Repository Multi-Tier Agent Roster
  sections.push("### Section 1: Whole-Repository Multi-Tier Agent Roster");
  sections.push("");
  if (agentRoster.length === 0) {
    sections.push("*(No registered subagents currently active)*");
  } else {
    sections.push(
      "| Tier | Agent ID | Role | Fleet / Capsule | Status | Task Binding | Attempt | Lease / Timer |",
    );
    sections.push("| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |");
    for (const a of agentRoster) {
      const tierStr = `Tier ${a.tier}`;
      const agentIdStr = `\`${a.agentId}\``;
      const roleStr = `\`${a.role}\``;
      const fleetStr = a.fleetId ? `\`${a.fleetId}\`` : "—";
      const statusIcon = a.status === "active" ? "🟢 active" : a.status;
      const taskStr = a.taskId ? `\`${a.taskId}\`` : "—";
      const attemptStr = a.attempt !== null && a.attempt !== undefined ? String(a.attempt) : "—";
      const timerStr = a.expiresAt ? "Active" : "—";
      sections.push(
        `| ${tierStr} | ${agentIdStr} | ${roleStr} | ${fleetStr} | ${statusIcon} | ${taskStr} | ${attemptStr} | ${timerStr} |`,
      );
    }
  }
  sections.push("");

  // Section 2: Global Fleet Concurrency & Phase Rollup
  sections.push("### Section 2: Global Fleet Concurrency & Phase Rollup");
  sections.push("");
  if (capsules.length === 0) {
    sections.push("*(No active capsules found in .olt/capsules/)*");
  } else {
    sections.push(
      "| Capsule Identifier | Fleet Scope | Phase | Total Tasks | 🏃 Coding | 🔄 Validating | 🟢 Ready | ⏳ Blocked | ✅ Done | Doctor Health |",
    );
    sections.push("| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
    for (const c of capsules) {
      sections.push(
        `| \`${c.runId}\` | ${c.scope} | ${c.phase} | ${c.totalTasks} | ${c.coding} | ${c.validating} | ${c.ready} | ${c.blocked} | ${c.done} | ${c.doctorHealth} |`,
      );
    }
  }
  sections.push("");

  // Section 3: Multi-Capsule Sugiyama Hierarchical DAG
  sections.push("### Section 3: Multi-Capsule Sugiyama Hierarchical DAG");
  sections.push("");
  const dagsWithContent = capsules.filter(
    (c) => c.sugiyamaReport && c.sugiyamaReport.renderedDag.length > 0,
  );
  if (dagsWithContent.length === 0) {
    sections.push("```text");
    sections.push("  ╭──────────────────────────────────────────────╮");
    sections.push("  │  (No active execution DAGs in fleet)         │");
    sections.push("  ╰──────────────────────────────────────────────╯");
    sections.push("```");
  } else {
    for (const c of dagsWithContent) {
      sections.push(`#### Capsule: \`${c.runId}\` (${c.scope})`);
      sections.push(
        `- **Phase**: ${c.phase} | **Total Tasks**: ${c.totalTasks} | **Sugiyama Waves**: ${c.waves}`,
      );
      sections.push("");
      sections.push("```text");
      sections.push(c.sugiyamaReport!.renderedDag);
      sections.push("```");
      sections.push("");
    }
  }
  sections.push("");

  // Section 4: Supervisory Health Rollup
  sections.push("### Section 4: Supervisory Health Rollup");
  sections.push("");
  sections.push(`- **Mind Status**: Mind [${stats.supervisoryHealth.mind}]`);
  sections.push(`- **Mind Auditor Status**: Mind Auditor [${stats.supervisoryHealth.mindAuditor}]`);
  sections.push(
    `- **Skill Auditor Status**: Skill Auditor [${stats.supervisoryHealth.skillAuditor}]`,
  );
  sections.push(
    `- **Supervisory Integrity**: ${stats.supervisoryHealth.healthy ? "✅ Healthy" : "⚠️ Attention Required"}`,
  );
  sections.push(`- **Active Fleets**: ${stats.activeFleets} capsule(s) registered in fleet`);
  sections.push(
    `- **Global Concurrency**: ${stats.occupancy.coding} coding, ${stats.occupancy.validating} validating, ${stats.occupancy.standby} ready`,
  );

  return sections.join("\n");
}
