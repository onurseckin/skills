/**
 * Sugiyama Single Node Box Renderer
 */
import {
  formatCoordinates,
  formatImplementerValidatorTracking,
  formatSubagentAllocation,
  getStatusGlyph,
  renderSubagentExpandedItems,
} from "./subagent-expansion.ts";
import type { SugiyamaNode } from "./types.ts";

/**
 * Renders a single rounded Unicode node box.
 */
export function renderRoundedNodeBox(
  task: SugiyamaNode,
  options: {
    detailed?: boolean | undefined;
    boxStyle?: "rounded" | "sharp" | "ascii" | undefined;
    boxWidth?: number | undefined;
    isCycle?: boolean | undefined;
    isBypass?: boolean | undefined;
  } = {},
): string[] {
  const glyph = getStatusGlyph(task.status, task.dependencies.length > 0);
  const style = options.boxStyle ?? "rounded";

  let cornerTL = "╭";
  let cornerTR = "╮";
  let cornerBL = "╰";
  let cornerBR = "╯";
  let horiz = "─";
  let vert = "│";

  if (style === "sharp") {
    cornerTL = "┌";
    cornerTR = "┐";
    cornerBL = "└";
    cornerBR = "┘";
  } else if (style === "ascii") {
    cornerTL = "+";
    cornerTR = "+";
    cornerBL = "+";
    cornerBR = "+";
    horiz = "-";
    vert = "|";
  }

  const cycleBadge = options.isCycle ? " ⚡[CYCLE]" : "";
  const bypassBadge = options.isBypass ? " ❌[BYPASS]" : "";
  const agentBadge =
    task.assignedAgent &&
    (task.status === "leased" ||
      task.status === "running" ||
      task.status === "validating" ||
      task.status === "active")
      ? ` [⚡ ${task.status === "validating" ? "VALIDATING" : "LEASED"}: ${task.assignedAgent} (${task.assignedRole ?? "implementer"})]`
      : "";

  const labelSuffix = task.label && task.label !== task.id ? ` • ${task.label}` : "";
  const titleLine = `${glyph} ${task.id}${labelSuffix}${agentBadge}${cycleBadge}${bypassBadge}`;

  const role = task.assignedRole ?? (task.assignedAgent ? "implementer" : "unassigned");
  const work = typeof task.effort === "number" ? task.effort : 1;
  const span = typeof task.criticalDepth === "number" ? task.criticalDepth + 1 : 1;

  const rows: string[] = [titleLine];

  const implementerId =
    task.implementerAgent ?? (task.assignedRole !== "validator" ? task.assignedAgent : null);
  const validatorId =
    task.validatorAgent ??
    task.validatorId ??
    (task.assignedRole === "validator" ? task.assignedAgent : null);
  const subagentAlloc = formatSubagentAllocation(
    implementerId,
    validatorId,
    task.assignedRole ?? "IMPLEMENTER",
  );
  if (subagentAlloc) {
    rows.push(`Allocations: ${subagentAlloc}`);
  }

  const coords = formatCoordinates(task.coordinates, task.wave, task.lane);
  if (coords) {
    rows.push(`Coordinates: ${coords}`);
  }

  const trackingLines = formatImplementerValidatorTracking(task);
  for (const tl of trackingLines) {
    rows.push(tl);
  }

  if (task.dependencies.length === 0) {
    rows.push(`Role: ${role} | Work: ${work} | Span: ${span}`);
  } else {
    rows.push(`Role: ${role} | Needs: ${task.dependencies.join(", ")}`);
    rows.push(`Work: ${work} | Span: ${span}`);
  }

  if (task.probeRound !== undefined && task.probeRound > 0) {
    rows.push(`Probe Round: P${task.probeRound} (🔍 PROBING)`);
  }
  if (task.round !== undefined && task.round > 1) {
    rows.push(`Repair Round: R${task.round} (⟳ REPAIRING)`);
  }

  if (options.detailed || (task.writeScope && task.writeScope.length > 0)) {
    const scopes =
      task.writeScope && task.writeScope.length > 0 ? task.writeScope.join(", ") : "none";
    rows.push(`Scope: ${scopes}`);
  }

  if (task.dependencies.length > 0 && (options.detailed || task.depReasons)) {
    for (const depId of task.dependencies) {
      const reason = task.depReasons?.[depId];
      if (reason && reason.trim().length > 0) {
        rows.push(`↳ Dep on ${depId}: ${reason.trim()}`);
      }
    }
  }

  if (options.detailed && task.gate) {
    rows.push(`Gate:  ${task.gate}`);
  }

  if (task.expandedSubtasks && task.expandedSubtasks.length > 0) {
    const subLines = renderSubagentExpandedItems(task.expandedSubtasks, task.branchId);
    for (const sl of subLines) {
      rows.push(sl);
    }
  }

  if (
    task.assignedAgent &&
    task.status !== "leased" &&
    task.status !== "running" &&
    task.status !== "validating" &&
    task.status !== "active"
  ) {
    const attemptStr =
      task.attempt !== null && task.attempt !== undefined ? ` (Attempt #${task.attempt})` : "";
    const toolStr = task.assignedTool ? ` • Tool: ${task.assignedTool}` : "";
    rows.push(`Agent: ${task.assignedAgent}${attemptStr}${toolStr}`);
  } else if (
    task.assignedTool &&
    (task.status === "leased" ||
      task.status === "running" ||
      task.status === "validating" ||
      task.status === "active")
  ) {
    rows.push(`Tool:  ${task.assignedTool}`);
  }

  const maxRowLen = Math.max(...rows.map((r) => r.length));
  const defaultWidth = options.boxWidth ?? 63;
  const targetWidth = Math.max(defaultWidth, maxRowLen + 4);
  const finalWidth = targetWidth % 2 === 0 ? targetWidth + 1 : targetWidth;
  const innerWidth = finalWidth - 4;

  const topBorder = `${cornerTL}${horiz.repeat(finalWidth - 2)}${cornerTR}`;
  const bottomBorder = `${cornerBL}${horiz.repeat(finalWidth - 2)}${cornerBR}`;

  const formattedRows = rows.map((row) => {
    const padding = Math.max(0, innerWidth - row.length);
    return `${vert} ${row}${" ".repeat(padding)} ${vert}`;
  });

  return [topBorder, ...formattedRows, bottomBorder];
}
