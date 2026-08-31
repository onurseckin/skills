import { describe, expect, it, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  validateAgentNamingConvention,
  parseStandardAgentId,
  recommendStandardAgentId,
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  AGENT_NAMING_STANDARDS,
} from "../../../../olt/scripts/src/authority/thread/index.ts";
import {
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../../olt/scripts/src/authority/manifest/index.ts";
import {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  appendPushbackRound,
} from "../../../../olt/scripts/src/authority/review/index.ts";
import { findCycles, breakCycles } from "../../../../olt/scripts/src/graph/dag-forensics.ts";
import {
  CANONICAL_VIEWPORTS,
  DEFAULT_PRESETS,
} from "../../../../olt/scripts/src/capture/config/default-presets.ts";
import { createSyntheticPngBuffer } from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../../packets/grant-run-fixture.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`The registry has no command named ${invocation}`);
  return found;
}


describe("Validator Specialization - Workflow & Invariants", () => {
  describe("4. Acyclic Workflow & Clean Pushback Delegation", () => {
    describe("Superficiality Detection & Scepticism Auditing", () => {
      it("flags canned superficial phrases in review submissions", () => {
        const cannedPhrases = [
          "lgtm",
          "looks good to me",
          "all tests pass",
          "verified manually",
          "works as expected",
          "done and verified",
          "everything works",
        ];

        for (const phrase of cannedPhrases) {
          const matched = SUPERFICIAL_PATTERNS.some((pattern) => pattern.test(phrase));
          expect(matched).toBe(true);

          const result = rejectSuperficialClaims(phrase, []);
          expect(result.isSuperficial).toBe(true);
          expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
        }
      });

      it("audits task verification evidence and recommends substantive pushback for unevidenced reviews", () => {
        const result = auditTaskVerificationEvidence(
          {
            taskId: "task-1",
            requirementIds: ["req-1"],
            filesChanged: ["src/app.ts"],
            summary: "looks good to me",
            checks: [],
          },
          { requireCounterfactual: true },
        );

        expect(result.valid).toBe(false);
        expect(result.superficiality.isSuperficial).toBe(true);
        expect(result.recommendedAction).toBe("pushback_substantive");
        expect(result.correctiveGuidance.length).toBeGreaterThan(0);
      });

      it("detects undifferentiated domain batching across multiple domains", () => {
        const duplicatePayload = { tested: true, status: "ok" };
        const result = detectDomainBatching(["ui-design", "security"], {
          "ui-design": duplicatePayload,
          security: duplicatePayload,
        });

        expect(result.isBatched).toBe(true);
        expect(result.violatingDomains.length).toBeGreaterThan(0);
      });
    });

    describe("Pushback Lineage & Round Tracking", () => {
      it("tracks multi-round pushback history without cycles and enforces max repair rounds", () => {
        const history = createPushbackHistory("task-p48-viewport-matrix", 3);
        expect(history.currentRound).toBe(0);
        expect(history.isExhausted).toBe(false);

        const h1 = appendPushbackRound(history, {
          coordinatorId: "coordinator_domain-ui",
          validatorId: "ui-validator_task-p48-viewport-matrix",
          domain: "ui-design",
          cause: "missing_counterfactual_evidence",
          observation: "Missing APCA contrast measurement on primary CTA button in dark mode",
          remediation:
            "Capture visual report with APCA Lc >= 60 and include mobile viewport screenshot",
          rejectionReasons: ["APCA contrast unverified"],
          correctiveGuidance: ["Measure APCA contrast in dark theme"],
          statusAfter: "changes_requested",
        });

        expect(h1.currentRound).toBe(1);
        expect(h1.isExhausted).toBe(false);

        const h2 = appendPushbackRound(h1, {
          coordinatorId: "coordinator_domain-ui",
          validatorId: "ui-validator_task-p48-viewport-matrix",
          domain: "ui-design",
          cause: "superficial_verification",
          observation: "Touch target on mobile hamburger menu is 32x32px, below 44x44px floor",
          remediation: "Increase touch target padding to reach >= 44x44px bounding box",
          rejectionReasons: ["Touch target below 44px floor"],
          correctiveGuidance: ["Ensure boundingClientRect >= 44x44px"],
          statusAfter: "changes_requested",
        });

        expect(h2.currentRound).toBe(2);
        expect(h2.isExhausted).toBe(false);

        const h3 = appendPushbackRound(h2, {
          coordinatorId: "coordinator_domain-ui",
          validatorId: "ui-validator_task-p48-viewport-matrix",
          domain: "ui-design",
          cause: "substantive",
          observation: "Hamburger menu touch target remains 32px",
          remediation: "Escalate to coordinator for redesign",
          rejectionReasons: ["Repeated failure on touch target"],
          correctiveGuidance: ["Redesign navigation layout"],
          statusAfter: "changes_requested",
        });

        expect(h3.currentRound).toBe(3);
        expect(h3.isExhausted).toBe(true);
      });
    });

    describe("Graph Acyclicity & Cycle Detection", () => {
      it("detects elementary cycles in cyclic dependency graphs", () => {
        const cyclicDeps = new Map<string, ReadonlySet<string>>([
          ["task-A", new Set(["task-B"])],
          ["task-B", new Set(["task-C"])],
          ["task-C", new Set(["task-A"])],
        ]);

        const cycles = findCycles(cyclicDeps);
        expect(cycles.length).toBeGreaterThan(0);
        expect(cycles[0]).toContain("task-A");
        expect(cycles[0]).toContain("task-B");
        expect(cycles[0]).toContain("task-C");
      });

      it("returns empty cycles list for clean acyclic DAGs", () => {
        const acyclicDeps = new Map<string, ReadonlySet<string>>([
          ["task-A", new Set([])],
          ["task-B", new Set(["task-A"])],
          ["task-C", new Set(["task-A", "task-B"])],
          ["task-D", new Set(["task-C"])],
        ]);

        const cycles = findCycles(acyclicDeps);
        expect(cycles.length).toBe(0);
      });

      it("breaks feedback edges to restore strict DAG acyclicity", () => {
        const cyclicDeps = new Map<string, ReadonlySet<string>>([
          ["task-1", new Set(["task-2"])],
          ["task-2", new Set(["task-3"])],
          ["task-3", new Set(["task-1"])],
        ]);

        const result = breakCycles(cyclicDeps);
        expect(result.brokenEdges.length).toBeGreaterThan(0);
        const remainingCycles = findCycles(result.acyclicDependencies);
        expect(remainingCycles.length).toBe(0);
      });
    });
  });

  describe("5. Static Code Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies zero TypeScript any and zero compiler/linter suppressions across touched files", () => {
      const filesToAudit = [
        "olt/scripts/src/authority/thread/naming.ts",
        "olt/scripts/src/authority/thread/constants.ts",
        "olt/scripts/src/authority/thread/index.ts",
        "olt/scripts/src/capture/runners/live-capture-runner/index.ts",
        "olt/scripts/src/capture/runners/types.ts",
        "olt/scripts/src/packets/command-authority.ts",
        "tests/validation/dual-validation/roles/validator-specialization-domains.test.ts",
      ];

      const anyTypeRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>|Record<string,\\s*any>");
      const suppressionRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const relativePath of filesToAudit) {
        const fullPath = `${process.cwd()}/${relativePath}`;
        expect(existsSync(fullPath)).toBe(true);
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyTypeRegex") || line.includes("suppressionRegex")) continue;

          expect(anyTypeRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
