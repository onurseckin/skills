import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeRunForensics,
  calculateEfficiencyScore,
  formatForensicsReport,
  injectRemediationToFeedbackQueue,
  isPollTool,
  isReadTool,
  isWriteTool,
  renderForensicsAsciiTable,
  synthesizeRemediationPlan,
  ROOT_CAUSE_CATEGORIES,
  FORENSICS_SEVERITIES,
  type AnalyzeRunForensicsOptions,
  type FeedbackInjectionOptions,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type ForensicsMetrics,
  type ForensicsSeverity,
  type PlanInjectionProposal,
  type RootCauseCategory,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import {
  formatMetaAuditReport,
  metaAuditCommand,
  renderEfficiencyMetricsTable,
  renderForensicsIncidentTable,
} from "../../../../olt/scripts/src/cli/commands/meta-audit.ts";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";


import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Meta Auditor - Remediation Plan Synthesis", () => {
  describe("Remediation Plan Synthesis", () => {
    it("synthesizes proposals for all 7 behavioral root causes", () => {
      const allIncidents: readonly ForensicsIncident[] = [
        {
          id: "inc-tb-1",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Excessive Reads",
          description: "Read 25 files",
          observation: "Read 25 files before write",
          remediation: "Exact anchors",
          recommendation: "Exact anchors",
          agentId: "agent-tb",
        },
        {
          id: "inc-fs-1",
          category: "FALSE_SERIALIZATION",
          severity: "HIGH",
          title: "Serial Tasks",
          description: "Serial execution of disjoint scopes",
          observation: "Disjoint tasks executed serially",
          remediation: "Wave concurrency",
          recommendation: "Wave concurrency",
        },
        {
          id: "inc-rbd-1",
          category: "ROLE_BOUNDARY_DEVIATION",
          severity: "CRITICAL",
          title: "Coordinator Write",
          description: "Coordinator modified code",
          observation: "Coordinator wrote files",
          remediation: "Supervisory role isolation",
          recommendation: "Supervisory role isolation",
          agentId: "coordinator-alpha",
        },
        {
          id: "inc-pw-1",
          category: "POLLING_WASTE",
          severity: "MEDIUM",
          title: "Status Loops",
          description: "Polled 8 times",
          observation: "Active polling loops",
          remediation: "WaitMsBeforeAsync 10000",
          recommendation: "WaitMsBeforeAsync 10000",
          agentId: "implementer-beta",
        },
        {
          id: "inc-co-1",
          category: "CONTEXT_OVERFLOW",
          severity: "CRITICAL",
          title: "Context Saturation",
          description: "Consumed 190k input tokens",
          observation: "Context window saturation",
          remediation: "Stream chunking",
          recommendation: "Stream chunking",
          agentId: "agent-gamma",
        },
        {
          id: "inc-gl-1",
          category: "GHOST_LEASE",
          severity: "HIGH",
          title: "Abandoned Lease",
          description: "Agent released while task leased",
          observation: "Ghost lease detected",
          remediation: "Reclaim idle leases",
          recommendation: "Reclaim idle leases",
          taskId: "task-ghost-99",
          agentId: "agent-ghost",
        },
        {
          id: "inc-str-1",
          category: "STRAGGLER",
          severity: "MEDIUM",
          title: "Straggler Task",
          description: "Task took 250s (4x avg)",
          observation: "Straggler task bottleneck",
          remediation: "Decompose tasks",
          recommendation: "Decompose tasks",
          taskId: "task-slow-1",
        },
      ];

      const proposals = synthesizeRemediationPlan(allIncidents);
      expect(proposals).toHaveLength(7);

      const byRootCause = new Map<RootCauseCategory, PlanInjectionProposal>();
      for (const prop of proposals) {
        byRootCause.set(prop.rootCause, prop);
      }

      // 1. TOKEN_BURNING
      const tbProp = byRootCause.get("TOKEN_BURNING")!;
      expect(tbProp).toBeDefined();
      expect(tbProp.title).toContain("Exact-Anchor");
      expect(tbProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(tbProp.category).toBe("CORE_ENGINE");
      expect(tbProp.targetRole).toBe("coordinator");
      expect(tbProp.remediationDirective).toContain("Exact-Anchor");

      // 2. FALSE_SERIALIZATION
      const fsProp = byRootCause.get("FALSE_SERIALIZATION")!;
      expect(fsProp).toBeDefined();
      expect(fsProp.title).toContain("Parallel Wave Concurrency");
      expect(fsProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(fsProp.category).toBe("SCALING");
      expect(fsProp.targetRole).toBe("coordinator");
      expect(fsProp.remediationDirective).toContain("disjoint write scopes");

      // 3. ROLE_BOUNDARY_DEVIATION
      const rbdProp = byRootCause.get("ROLE_BOUNDARY_DEVIATION")!;
      expect(rbdProp).toBeDefined();
      expect(rbdProp.title).toContain("Role Boundary Guardrails");
      expect(rbdProp.priority).toBe("CRITICAL_USER_FEEDBACK");
      expect(rbdProp.category).toBe("AGENT_CONTRACTS");
      expect(rbdProp.targetRole).toBe("coordinator-alpha");
      expect(rbdProp.remediationDirective).toContain("Prohibit coordinators");

      // 4. POLLING_WASTE
      const pwProp = byRootCause.get("POLLING_WASTE")!;
      expect(pwProp).toBeDefined();
      expect(pwProp.title).toContain("WaitMsBeforeAsync: 10000");
      expect(pwProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(pwProp.category).toBe("CLI_TOOLING");
      expect(pwProp.targetRole).toBe("implementer");
      expect(pwProp.remediationDirective).toContain("WaitMsBeforeAsync: 10000");

      // 5. CONTEXT_OVERFLOW
      const coProp = byRootCause.get("CONTEXT_OVERFLOW")!;
      expect(coProp).toBeDefined();
      expect(coProp.title).toContain("Stream Chunking");
      expect(coProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(coProp.category).toBe("CORE_ENGINE");
      expect(coProp.targetRole).toBe("orchestrator");
      expect(coProp.remediationDirective).toContain("Cowan-chunked context limits");

      // 6. GHOST_LEASE
      const glProp = byRootCause.get("GHOST_LEASE")!;
      expect(glProp).toBeDefined();
      expect(glProp.title).toContain("Automatic Lease Expiration");
      expect(glProp.priority).toBe("NORMAL");
      expect(glProp.category).toBe("WATCHDOG");
      expect(glProp.targetRole).toBe("watchdog");
      expect(glProp.remediationDirective).toContain("Reclaim task leases");

      // 7. STRAGGLER
      const strProp = byRootCause.get("STRAGGLER")!;
      expect(strProp).toBeDefined();
      expect(strProp.title).toContain("Granular Task Decomposition");
      expect(strProp.priority).toBe("NORMAL");
      expect(strProp.category).toBe("ARCHITECTURE");
      expect(strProp.targetRole).toBe("orchestrator");
      expect(strProp.remediationDirective).toContain("Decompose complex requirements");
    });

    it("deduplicates multiple incidents of the same root cause category", () => {
      const duplicateIncidents: readonly ForensicsIncident[] = [
        {
          id: "inc-1",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Token Burn 1",
          description: "Desc 1",
          observation: "Obs 1",
          remediation: "Rem 1",
          recommendation: "Rec 1",
        },
        {
          id: "inc-2",
          category: "TOKEN_BURNING",
          severity: "CRITICAL",
          title: "Token Burn 2",
          description: "Desc 2",
          observation: "Obs 2",
          remediation: "Rem 2",
          recommendation: "Rec 2",
        },
      ];

      const proposals = synthesizeRemediationPlan(duplicateIncidents);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.rootCause).toBe("TOKEN_BURNING");
    });
  });

});
