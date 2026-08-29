import { describe, expect, it, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  validateAgentNamingConvention,
  parseStandardAgentId,
  recommendStandardAgentId,
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  AGENT_NAMING_STANDARDS,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import {
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  appendPushbackRound,
} from "../../../olt/scripts/src/authority/review/index.ts";
import { findCycles, breakCycles } from "../../../olt/scripts/src/graph/dag-forensics.ts";
import {
  CANONICAL_VIEWPORTS,
  DEFAULT_PRESETS,
} from "../../../olt/scripts/src/capture/config/default-presets.ts";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../packets/grant-run-fixture.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`The registry has no command named ${invocation}`);
  return found;
}

describe("Validator Specialization & UI Split Architecture Verification Suite", () => {
  describe("1. Strict Command-Running Ban on Regular & Cognitive Validators", () => {
    const cognitiveRoles = [
      "validator",
      "ui-validator",
      "validator-code-quality",
      "validator-ui-design",
      "validator-security",
      "validator-product",
      "validator-system-design",
    ] as const;

    const nonCognitiveRoles = [
      "mechanic-validator",
      "ui-mechanic-validator",
      "implementer",
      "repairer",
      "coordinator",
      "orchestrator",
      "mind",
    ] as const;

    it("correctly identifies all cognitive validator roles", () => {
      for (const role of cognitiveRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(true);
      }
      for (const role of nonCognitiveRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(false);
      }
    });

    it("prohibits cognitive validators from invoking run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(isExecutionCommand(execSpec)).toBe(true);

      const testAgentIds = [
        "validator_task-1",
        "ui-validator_task-1",
        "validator-code-quality_task-1",
        "validator-ui-design_task-1",
        "validator-security_task-1",
        "validator-product_task-1",
        "validator-system-design_task-1",
      ];

      for (const agentId of testAgentIds) {
        expect(() => assertRoleMayInvoke("validator", execSpec, agentId)).toThrow(
          "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
        );
      }
    });

    it("enforces command-running ban on cognitive validators via assertGrantedCommand in active capsule ledger", async () => {
      const { run } = await emptyGrantRun("validator-spec-ban-");
      transact(run, "test-setup", "grant-agents", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "ui-validator_task-2",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const flags1: Flags = { run, actor: "validator_task-1" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags1, {
          actor: "validator_task-1",
          verified: true,
        }),
      ).toThrow(
        "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
      );

      const flags2: Flags = { run, actor: "ui-validator_task-2" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags2, {
          actor: "ui-validator_task-2",
          verified: true,
        }),
      ).toThrow(
        "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
      );
    });

    it("blocks prohibited tool categories (shell, test-runner, build, package-manager) for cognitive validators", async () => {
      const { run } = await emptyGrantRun("validator-spec-toolcat-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const prohibitedCategories = ["shell", "test-runner", "build", "package-manager"];
      for (const cat of prohibitedCategories) {
        expect(isExecutionToolCategory(cat)).toBe(true);
        const flags: Flags = {
          run,
          validator: "validator_task-1",
          "tool-category": cat,
        };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, {
            actor: "validator_task-1",
            verified: true,
          }),
        ).toThrow("may not invoke execution tool category");
      }
    });

    it("permits authorized non-execution validation commands for cognitive validators", async () => {
      const { run } = await emptyGrantRun("validator-spec-permitted-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      expect(isCognitiveValidatorRole("validator")).toBe(true);

      const permittedCommands = [
        "task:validate-start",
        "task:probe",
        "task:reject",
        "task:review",
        "finding:get",
        "report:get",
        "evidence:get",
      ];

      for (const cmdName of permittedCommands) {
        const cmdSpec = spec(cmdName);
        const flags: Flags = { run, validator: "validator_task-1", agent: "validator_task-1" };
        expect(() =>
          assertGrantedCommand(cmdSpec, flags, {
            actor: "validator_task-1",
            verified: true,
          }),
        ).not.toThrow();
      }
    });
  });

  describe("2. Mechanic Validator Gate Execution & Structured Test Receipts", () => {
    it("correctly identifies mechanic validator roles", () => {
      expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("mechanic_validator")).toBe(true);

      expect(isMechanicValidatorRole("validator")).toBe(false);
      expect(isMechanicValidatorRole("ui-validator")).toBe(false);
      expect(isMechanicValidatorRole("implementer")).toBe(false);
    });

    it("permits mechanic-validator to invoke run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(() =>
        assertRoleMayInvoke("mechanic-validator", execSpec, "mechanic-validator_task-1"),
      ).not.toThrow();
    });

    it("allows mechanic validators to execute gate commands via assertGrantedCommand in active capsule", async () => {
      const { run } = await emptyGrantRun("mechanic-spec-exec-");
      transact(run, "test-setup", "grant-mechanic", {}, (draft) => {
        draft.agents = [
          {
            id: "mechanic-validator_task-1",
            role: "mechanic-validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const flags: Flags = { run, actor: "mechanic-validator_task-1" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags, {
          actor: "mechanic-validator_task-1",
          verified: true,
        }),
      ).not.toThrow();
    });

    it("validates mechanic-validator evidence schema structure including gate receipts and checks", () => {
      const schema = evidenceSchema("mechanic-validator");
      expect(schema.verdict).toBe("pass|reject");
      expect(Array.isArray(schema.requirement_ids)).toBe(true);
      expect(Array.isArray(schema.checks)).toBe(true);
      expect(Array.isArray(schema.gate_receipts)).toBe(true);
      expect(Array.isArray(schema.findings)).toBe(true);

      const gateReceipts = schema.gate_receipts as ReadonlyArray<Record<string, unknown>>;
      expect(gateReceipts.length).toBeGreaterThan(0);
      const sampleReceipt = gateReceipts[0]!;
      expect(sampleReceipt.gate_id).toBeDefined();
      expect(sampleReceipt.command_id).toBeDefined();
      expect(sampleReceipt.exit_code).toBe(0);
      expect(sampleReceipt.status).toBe("passed|failed");
    });
  });

  describe("3. UI Validator Split Architecture (ui-mechanic-validator vs ui-validator)", () => {
    describe("Taxonomy and Naming Conventions", () => {
      it("recognizes ui-mechanic-validator and ui-validator in AGENT_NAMING_STANDARDS", () => {
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]!.tier).toBe(3);
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]!.bindingType).toBe("task");

        expect(AGENT_NAMING_STANDARDS["ui-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["ui-validator"]!.tier).toBe(3);
        expect(AGENT_NAMING_STANDARDS["ui-validator"]!.bindingType).toBe("task");

        expect(AGENT_NAMING_STANDARDS["mechanic-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["mechanic-validator"]!.tier).toBe(3);
      });

      it("validates naming convention for ui-mechanic-validator and ui-validator identifiers", () => {
        const mechRes = validateAgentNamingConvention(
          "ui-mechanic-validator_task-p48-viewport-matrix",
        );
        expect(mechRes.valid).toBe(true);
        expect(mechRes.role).toBe("ui-mechanic-validator");
        expect(mechRes.tier).toBe(3);
        expect(mechRes.parsedComponents?.taskId).toBe("task-p48");
        expect(mechRes.parsedComponents?.taskSlug).toBe("viewport-matrix");

        const cogRes = validateAgentNamingConvention("ui-validator_task-p48-viewport-matrix");
        expect(cogRes.valid).toBe(true);
        expect(cogRes.role).toBe("ui-validator");
        expect(cogRes.tier).toBe(3);
        expect(cogRes.parsedComponents?.taskId).toBe("task-p48");
        expect(cogRes.parsedComponents?.taskSlug).toBe("viewport-matrix");
      });

      it("parses standard agent IDs and generates standard recommendations", () => {
        const parsedMech = parseStandardAgentId("ui-mechanic-validator_task-1-dom-metrics");
        expect(parsedMech).not.toBeNull();
        expect(parsedMech?.role).toBe("ui-mechanic-validator");
        expect(parsedMech?.tier).toBe(3);
        expect(parsedMech?.taskId).toBe("task-1");
        expect(parsedMech?.taskSlug).toBe("dom-metrics");

        const parsedCog = parseStandardAgentId("ui-validator_task-1-visual-critique");
        expect(parsedCog).not.toBeNull();
        expect(parsedCog?.role).toBe("ui-validator");
        expect(parsedCog?.tier).toBe(3);
        expect(parsedCog?.taskId).toBe("task-1");
        expect(parsedCog?.taskSlug).toBe("visual-critique");

        expect(
          recommendStandardAgentId("ui-mechanic-validator", "task-p48", "viewport-matrix"),
        ).toBe("ui-mechanic-validator_task-p48-viewport-matrix");
        expect(recommendStandardAgentId("ui-validator", "task-p48", "viewport-matrix")).toBe(
          "ui-validator_task-p48-viewport-matrix",
        );
      });

      it("maps agent IDs to roles and execution tiers", () => {
        expect(agentIdToRole("ui-mechanic-validator_task-p48-matrix")).toBe(
          "ui-mechanic-validator",
        );
        expect(agentIdToRole("ui-validator_task-p48-critique")).toBe("ui-validator");
        expect(agentIdToRole("mechanic-validator_task-p47-watchdog")).toBe("mechanic-validator");

        expect(agentIdToTier("ui-mechanic-validator_task-p48-matrix")).toBe(3);
        expect(agentIdToTier("ui-validator_task-p48-critique")).toBe(3);
        expect(agentIdToTier("mechanic-validator_task-p47-watchdog")).toBe(3);

        expect(roleToTier("ui-mechanic-validator")).toBe(3);
        expect(roleToTier("ui-validator")).toBe(3);
        expect(roleToTier("mechanic-validator")).toBe(3);
      });
    });

    describe("Agent Unified Model Integration (Identity, Contract, Permissions)", () => {
      it("loads valid agent manifests for ui-mechanic-validator and ui-validator", () => {
        const mechId = loadAgentManifest("ui-mechanic-validator");
        expect(mechId.name).toBe("ui-mechanic-validator");
        expect(mechId.tier).toBe(3);
        expect(mechId.interface?.display_name).toBe("UI Mechanic Validator");
        expect(mechId.tools?.enable_write_tools).toBe(false);
        expect(mechId.filePath).toBeDefined();

        const cogId = loadAgentManifest("ui-validator");
        expect(cogId.name).toBe("ui-validator");
        expect(cogId.tier).toBe(3);
        expect(cogId.interface?.display_name).toBe("UI Cognitive Validator");
        expect(cogId.tools?.enable_write_tools).toBe(false);
        expect(cogId.filePath).toBeDefined();
      });

      it("loads valid role definition contracts for ui-mechanic-validator and ui-validator", () => {
        const mechDef = loadRoleContract("ui-mechanic-validator");
        expect(mechDef.tier).toBe(3);
        expect(mechDef.commands.includes("run:exec")).toBe(true);
        expect(mechDef.filePath).toBeDefined();

        const cogDef = loadRoleContract("ui-validator");
        expect(cogDef.tier).toBe(3);
        expect(cogDef.commands.includes("run:exec")).toBe(false);
        expect(cogDef.filePath).toBeDefined();
      });

      it("validates unified model consistency and synthesizes complete models for ui-mechanic-validator and ui-validator", () => {
        const mechModel = loadUnifiedAgentModel("ui-mechanic-validator");
        expect(mechModel.role).toBe("ui-mechanic-validator");
        expect(mechModel.tier).toBe(3);
        expect(mechModel.manifest).toBeDefined();
        expect(mechModel.contract).toBeDefined();
        expect(mechModel.commands.includes("run:exec")).toBe(true);

        const cogModel = loadUnifiedAgentModel("ui-validator");
        expect(cogModel.role).toBe("ui-validator");
        expect(cogModel.tier).toBe(3);
        expect(cogModel.manifest).toBeDefined();
        expect(cogModel.contract).toBeDefined();
        expect(cogModel.commands.includes("run:exec")).toBe(false);
      });
    });

    describe("Viewport Matrix Presets and Synthetic Evidence Support", () => {
      it("defines the canonical 4-tier Viewport Resolution Matrix", () => {
        expect(CANONICAL_VIEWPORTS["desktop-wide"]).toEqual({
          name: "desktop-wide",
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
        });
        expect(CANONICAL_VIEWPORTS.desktop).toEqual({
          name: "desktop",
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
        });
        expect(CANONICAL_VIEWPORTS.tablet).toEqual({
          name: "tablet",
          width: 768,
          height: 1024,
          deviceScaleFactor: 2,
        });
        expect(CANONICAL_VIEWPORTS.mobile).toEqual({
          name: "mobile",
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
        });

        const fullMatrixPreset = DEFAULT_PRESETS["full-matrix"];
        expect(fullMatrixPreset).toBeDefined();
        expect(fullMatrixPreset!.viewports.length).toBe(4);
      });

      it("generates valid synthetic PNG buffers meeting the 1024-byte minimum evidence floor", () => {
        const png = createSyntheticPngBuffer(100, 100, 2048);
        expect(png.byteLength).toBeGreaterThanOrEqual(2048);
        // Standard PNG signature: 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
      });
    });
  });

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
        "tests/unit/validation/validator-specialization.test.ts",
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
