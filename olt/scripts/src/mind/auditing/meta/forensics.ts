import { generateProposalId } from "./types.ts";
import type {
  ForensicsAnalysisResult,
  ForensicsIncident,
  PlanInjectionProposal,
  RootCauseCategory,
} from "./types.ts";
import { basename, dirname, join, resolve } from "node:path";
export function formatForensicsReport(result: ForensicsAnalysisResult): string {
  const lines: string[] = [];

  lines.push(`# Skill Meta-Auditor Deep Behavioral Forensics Report`);
  lines.push(``);
  lines.push(`- **Run ID**: \`${result.runId}\``);
  lines.push(`- **Capsule Root**: \`${result.capsuleRoot}\``);
  lines.push(`- **Analyzed At**: \`${result.analyzedAt}\``);
  lines.push(`- **Efficiency Score**: **${result.efficiencyScore.toFixed(1)} / 100**`);
  lines.push(
    `- **Overall Verdict**: **${result.isClean ? "CLEAN / OPTIMIZED" : "DEVIATIONS DETECTED"}**`,
  );
  lines.push(``);

  lines.push(`## Operational Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value | Reference Baseline |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| Total Subagents | \`${result.metrics.totalAgents}\` | N/A |`);
  lines.push(`| Total Tasks | \`${result.metrics.totalTasks}\` | N/A |`);
  lines.push(`| Total Events | \`${result.metrics.totalEvents}\` | N/A |`);
  lines.push(
    `| Total Tokens (In / Out) | \`${result.metrics.totalTokensIn.toLocaleString()}\` / \`${result.metrics.totalTokensOut.toLocaleString()}\` | Token efficiency |`,
  );
  lines.push(
    `| File Reads / Writes | \`${result.metrics.fileReadCount}\` / \`${result.metrics.fileWriteCount}\` | Read/Write ratio \`${result.metrics.readToWriteRatio.toFixed(2)}\` |`,
  );
  lines.push(
    `| Polling / Status Calls | \`${result.metrics.pollingCallsCount}\` | Baseline: 0 (reactive only) |`,
  );
  lines.push(
    `| Sequential Wave Bottlenecks | \`${result.metrics.sequentialWaveBottlenecks}\` | Target: 0 |`,
  );
  lines.push(
    `| Role Boundary Deviations | \`${result.metrics.boundaryDeviationsCount}\` | Invariant: 0 |`,
  );
  lines.push(`| Straggler Tasks | \`${result.metrics.stragglerTasksCount}\` | Target: 0 |`);
  lines.push(`| Ghost Leases | \`${result.metrics.ghostLeasesCount}\` | Invariant: 0 |`);
  lines.push(``);

  lines.push(`## Behavioral Forensics Incidents (${result.incidents.length})`);
  lines.push(``);

  if (result.incidents.length === 0) {
    lines.push(`> [!NOTE]`);
    lines.push(
      `> No behavioral deviations, token burning, or concurrency bottlenecks were detected in this run.`,
    );
    lines.push(``);
  } else {
    for (const inc of result.incidents) {
      lines.push(`### [${inc.severity}] ${inc.title} (\`${inc.id}\`)`);
      lines.push(`- **Category**: \`${inc.category}\``);
      if (inc.agentId) lines.push(`- **Agent**: \`${inc.agentId}\``);
      if (inc.taskId) lines.push(`- **Task**: \`${inc.taskId}\``);
      lines.push(`- **Description**: ${inc.description}`);
      lines.push(`- **Recommendation**: ${inc.recommendation}`);
      lines.push(``);
    }
  }

  lines.push(`## Autonomous Remediation Proposals (${result.proposals.length})`);
  lines.push(``);

  if (result.proposals.length === 0) {
    lines.push(`No remediation proposals required.`);
  } else {
    for (const prop of result.proposals) {
      lines.push(`- **[${prop.priority}] ${prop.title}** (\`${prop.id}\`)`);
      lines.push(`  * Root Cause: \`${prop.rootCause}\` | Category: \`${prop.category}\``);
      lines.push(`  * Directive: ${prop.remediationDirective}`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

export function renderForensicsAsciiTable(incidents: readonly ForensicsIncident[]): string {
  if (incidents.length === 0) {
    return "+-------------------------------------------------------------------------+\n| No forensics incidents detected. Run is fully compliant.                |\n+-------------------------------------------------------------------------+";
  }

  const rows = incidents.map((inc) => {
    const id = inc.id.padEnd(24).slice(0, 24);
    const cat = inc.category.padEnd(22).slice(0, 22);
    const sev = inc.severity.padEnd(8).slice(0, 8);
    const agent = (inc.agentId ?? inc.taskId ?? "N/A").padEnd(20).slice(0, 20);
    const title = inc.title.slice(0, 40);
    return `| ${id} | ${cat} | ${sev} | ${agent} | ${title.padEnd(40)} |`;
  });

  const sep =
    "+--------------------------+------------------------+----------+----------------------+------------------------------------------+";
  const header = `| ID                       | Category               | Severity | Target               | Title                                    |\n${sep}`;
  return `${sep}\n${header}\n${rows.join("\n")}\n${sep}`;
}

export function synthesizeRemediationPlan(
  incidents: readonly ForensicsIncident[],
): readonly PlanInjectionProposal[] {
  const proposals: PlanInjectionProposal[] = [];
  const seenCategories = new Set<RootCauseCategory>();

  for (const incident of incidents) {
    if (seenCategories.has(incident.category)) {
      continue;
    }
    seenCategories.add(incident.category);

    switch (incident.category) {
      case "TOKEN_BURNING":
        proposals.push({
          id: generateProposalId("TOKEN_BURNING"),
          title: "Enforce Zero-Exploration Exact-Anchor Briefings for Task Implementers",
          content:
            "Forensics identified excessive exploratory reads (>5 browsed files before first edit or high read/write ratio). Enforce exact line ranges, symbol locations, and drop-in code chunks in task briefings to ensure zero-exploration single-turn edits.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          rootCause: "TOKEN_BURNING",
          targetRole: "coordinator",
          remediationDirective:
            "Generate Exact-Anchor task briefings with explicit file targets, line ranges, and drop-in replacement chunks prior to dispatching implementers.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "FALSE_SERIALIZATION":
        proposals.push({
          id: generateProposalId("FALSE_SERIALIZATION"),
          title: "Maximize Parallel Wave Concurrency for Disjoint Write Scopes",
          content:
            "Forensics detected sequential execution of independent tasks that possessed disjoint write scopes. Implement wave-based concurrency to dispatch independent tasks in parallel.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "SCALING",
          rootCause: "FALSE_SERIALIZATION",
          targetRole: "coordinator",
          remediationDirective:
            "Batch all tasks with disjoint write scopes into simultaneous execution waves rather than serializing them.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "ROLE_BOUNDARY_DEVIATION":
        proposals.push({
          id: generateProposalId("ROLE_BOUNDARY_DEVIATION"),
          title: "Enforce Supervisory Role Boundary Guardrails & Tool Prohibitions",
          content:
            "Forensics detected role boundary deviations (such as coordinators editing codebase files directly or cognitive validators executing bash/test commands). Enforce strict tool and lease isolation.",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "AGENT_CONTRACTS",
          rootCause: "ROLE_BOUNDARY_DEVIATION",
          targetRole: incident.agentId ?? "coordinator",
          remediationDirective:
            "Prohibit coordinators from direct file edits (delegate to Tier 3 implementers) and prohibit cognitive validators from executing arbitrary write operations.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "POLLING_WASTE":
        proposals.push({
          id: generateProposalId("POLLING_WASTE"),
          title: "Mandate Standard Async WaitMsBeforeAsync: 10000 to Eliminate Polling Waste",
          content:
            "Forensics detected high-frequency status polling loops. Mandate WaitMsBeforeAsync: 10000 across all tool calls and utilize reactive wakeup notifications instead of active poll loops.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CLI_TOOLING",
          rootCause: "POLLING_WASTE",
          targetRole: "implementer",
          remediationDirective:
            "Configure WaitMsBeforeAsync: 10000 on command calls and end turns to receive automatic reactive resume notifications.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "CONTEXT_OVERFLOW":
        proposals.push({
          id: generateProposalId("CONTEXT_OVERFLOW"),
          title: "Implement Stream Chunking and Context Truncation for Subagents",
          content:
            "Forensics detected token context saturation or oversized event payloads exceeding safety thresholds. Implement rigorous token caps and stream pruning.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          rootCause: "CONTEXT_OVERFLOW",
          targetRole: "orchestrator",
          remediationDirective:
            "Truncate verbose tool outputs and enforce Cowan-chunked context limits per subagent turn.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "GHOST_LEASE":
        proposals.push({
          id: generateProposalId("GHOST_LEASE"),
          title: "Enforce Automatic Lease Expiration and Idle Task Reclaim",
          content:
            "Forensics detected ghost leases where tasks were claimed but remained idle without code modifications. Enforce heartbeat deadlines and automated reclamation.",
          priority: "NORMAL",
          category: "WATCHDOG",
          rootCause: "GHOST_LEASE",
          targetRole: "watchdog",
          remediationDirective:
            "Reclaim task leases immediately upon expiration or inactivity timeout exceeding 600 seconds.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "STRAGGLER":
        proposals.push({
          id: generateProposalId("STRAGGLER"),
          title: "Enforce Granular Task Decomposition to Eliminate Straggler Spans",
          content:
            "Forensics detected straggler tasks that disproportionately dominated the execution span. Enforce strict task decomposition to 1-2 files per work unit.",
          priority: "NORMAL",
          category: "ARCHITECTURE",
          rootCause: "STRAGGLER",
          targetRole: "orchestrator",
          remediationDirective:
            "Decompose complex requirements into discrete sub-tasks with small, isolated write scopes.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;
    }
  }

  return proposals;
}
