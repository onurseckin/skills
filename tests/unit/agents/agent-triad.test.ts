import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertTriadIntegrity,
  auditAgentTriadWorkspace,
  findRelevantReferencesForRole,
  loadAgentIdentity,
  loadAgentReferenceDocs,
  loadAgentRoleDefinition,
  synthesizeTriadManifest,
  validateAgentTriad,
  type AgentIdentity,
  type AgentReferenceDoc,
  type AgentRoleDefinition,
  type AgentTriadBundle,
  type TriadAuditReport,
  type TriadValidationResult,
} from "../../../olt/scripts/src/agents/agent-triad.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("P06 Agent Triad Architecture Unit Tests", () => {
  const standardRoles = [
    "mind",
    "orchestrator",
    "coordinator",
    "implementer",
    "validator",
    "repairer",
    "completeness-critic",
    "planner",
    "plan-validator",
  ] as const;

  // -------------------------------------------------------------------------
  // 1. validateAgentTriad Tests
  // -------------------------------------------------------------------------
  describe("validateAgentTriad", () => {
    test("successfully validates standard roles in the repository", () => {
      for (const role of standardRoles) {
        const result: TriadValidationResult = validateAgentTriad(role);
        expect(result.valid).toBe(true);
        expect(result.role).toBe(role);
        expect(result.hasIdentity).toBe(true);
        expect(result.hasDefinition).toBe(true);
        expect(result.tierConsistent).toBe(true);
        expect(result.hasReferences).toBe(true);
        expect(result.referenceCount).toBeGreaterThan(0);
        expect(result.identityPath).toBeDefined();
        expect(result.definitionPath).toBeDefined();
        expect(result.issues).toHaveLength(0);
      }
    });

    test("normalizes role aliases before validation", () => {
      const orchResult = validateAgentTriad("orch");
      expect(orchResult.valid).toBe(true);
      expect(orchResult.role).toBe("orchestrator");
      expect(orchResult.tier).toBe(1);

      const coordResult = validateAgentTriad("coord");
      expect(coordResult.valid).toBe(true);
      expect(coordResult.role).toBe("coordinator");
      expect(coordResult.tier).toBe(2);

      const mindResult = validateAgentTriad("tier-0");
      expect(mindResult.valid).toBe(true);
      expect(mindResult.role).toBe("mind");
      expect(mindResult.tier).toBe(0);
    });

    test("detects missing identity manifest and missing definition in isolated mock paths", () => {
      const mockDir = join(tmpdir(), `triad-test-validate-${Date.now()}`);
      const mockAgents = join(mockDir, "agents");
      const mockRefs = join(mockDir, "references");

      mkdirSync(mockAgents, { recursive: true });
      mkdirSync(mockRefs, { recursive: true });

      try {
        // Missing manifest
        const resultMissingManifest = validateAgentTriad("orphan-role", {
          skillRoot: mockDir,
          agentsDir: mockAgents,
          referencesDir: mockRefs,
        });

        expect(resultMissingManifest.valid).toBe(false);
        expect(resultMissingManifest.hasIdentity).toBe(false);
        expect(resultMissingManifest.hasDefinition).toBe(false);
        expect(
          resultMissingManifest.issues.some((i) => i.includes("Missing agent identity manifest")),
        ).toBe(true);
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });

    test("detects tier mismatch in manifest with invalid configuration", () => {
      const mockDir = join(tmpdir(), `triad-test-tier-mismatch-${Date.now()}`);
      const mockAgents = join(mockDir, "agents");
      const mockRefs = join(mockDir, "references");

      mkdirSync(mockAgents, { recursive: true });
      mkdirSync(mockRefs, { recursive: true });

      try {
        writeFileSync(
          join(mockAgents, "mismatched-agent.yaml"),
          "name: mismatched-agent\nrole: mismatched-agent\ntier: 2\ninstructions: |-\n  # Mismatched Agent\n",
          "utf-8",
        );

        const result = validateAgentTriad("mismatched-agent", {
          skillRoot: mockDir,
          agentsDir: mockAgents,
          referencesDir: mockRefs,
        });

        expect(result.valid).toBe(true);
        expect(result.tier).toBe(2);
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. auditAgentTriadWorkspace Tests
  // -------------------------------------------------------------------------
  describe("auditAgentTriadWorkspace", () => {
    test("audits repository workspace and discovers all triads", () => {
      const report: TriadAuditReport = auditAgentTriadWorkspace();

      expect(report.skillRoot).toBeDefined();
      expect(report.totalRoles).toBeGreaterThanOrEqual(10);
      expect(report.completeTriads).toBeGreaterThanOrEqual(8);
      expect(report.triads.length).toBe(report.totalRoles);
      expect(report.summary.length).toBeGreaterThan(0);
      expect(typeof report.healthy).toBe("boolean");
    });

    test("audits mock workspace with complete and orphaned components", () => {
      const mockDir = join(tmpdir(), `triad-test-audit-${Date.now()}`);
      const mockAgents = join(mockDir, "agents");
      const mockRefs = join(mockDir, "references");

      mkdirSync(mockAgents, { recursive: true });
      mkdirSync(mockRefs, { recursive: true });

      try {
        // Complete manifest: agent1
        writeFileSync(
          join(mockAgents, "agent1.yaml"),
          "name: agent1\nrole: agent1\ntier: 3\ninstructions: |-\n  # Agent 1\n",
          "utf-8",
        );

        // Unreferenced doc: unreferenced.md
        writeFileSync(
          join(mockRefs, "unreferenced.md"),
          "# Unreferenced Doc\n\nNo roles here.\n",
          "utf-8",
        );

        const report = auditAgentTriadWorkspace({
          skillRoot: mockDir,
          agentsDir: mockAgents,
          referencesDir: mockRefs,
        });

        expect(report.totalRoles).toBe(1);
        expect(report.completeTriads).toBe(1);
        expect(report.unreferencedReferences).toContain("unreferenced");
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });

    test("evaluates healthy when mock workspace is completely synchronized", () => {
      const mockDir = join(tmpdir(), `triad-test-healthy-${Date.now()}`);
      const mockAgents = join(mockDir, "agents");
      const mockRoles = join(mockDir, "roles");
      const mockRefs = join(mockDir, "references");

      mkdirSync(mockAgents, { recursive: true });
      mkdirSync(mockRoles, { recursive: true });
      mkdirSync(mockRefs, { recursive: true });

      try {
        writeFileSync(
          join(mockAgents, "sync-agent.yaml"),
          "name: sync-agent\nrole: sync-agent\ntier: 3\nprotocol:\n  instructions: See ref-doc\n",
          "utf-8",
        );
        writeFileSync(
          join(mockRoles, "sync-agent.md"),
          "---\nrole: sync-agent\ntier: 3\n---\n# Sync Agent\n",
          "utf-8",
        );
        writeFileSync(
          join(mockRefs, "ref-doc.md"),
          "# Ref Doc\n\nApplies to sync-agent.\n",
          "utf-8",
        );

        const report = auditAgentTriadWorkspace({
          skillRoot: mockDir,
          agentsDir: mockAgents,
          rolesDir: mockRoles,
          referencesDir: mockRefs,
        });

        expect(report.healthy).toBe(true);
        expect(report.completeTriads).toBe(1);
        expect(report.incompleteTriads).toBe(0);
        expect(report.orphanedManifests).toHaveLength(0);
        expect(report.orphanedContracts).toHaveLength(0);
        expect(report.issues).toHaveLength(0);
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. synthesizeTriadManifest Tests
  // -------------------------------------------------------------------------
  describe("synthesizeTriadManifest", () => {
    test("synthesizes complete triad bundles for standard roles", () => {
      for (const role of standardRoles) {
        const bundle: AgentTriadBundle = synthesizeTriadManifest(role);
        expect(bundle.role).toBe(role);
        expect([0, 1, 2, 3]).toContain(bundle.tier);
        expect(bundle.identity).toBeDefined();
        expect(bundle.identity.name).toBeDefined();
        expect(bundle.definition).toBeDefined();
        expect(bundle.definition.may.length).toBeGreaterThan(0);
        expect(bundle.definition.mustNot.length).toBeGreaterThan(0);
        expect(bundle.references).toBeDefined();
        expect(bundle.references.length).toBeGreaterThan(0);
        expect(bundle.isComplete).toBe(true);
        expect(bundle.validationIssues).toBeUndefined();
      }
    });

    test("synthesizes bundle with fallbacks when role files are absent in non-strict mode", () => {
      const mockDir = join(tmpdir(), `triad-test-synth-${Date.now()}`);
      mkdirSync(mockDir, { recursive: true });

      try {
        const bundle = synthesizeTriadManifest("non-existent-role", {
          skillRoot: mockDir,
          agentsDir: join(mockDir, "agents"),
          rolesDir: join(mockDir, "roles"),
          referencesDir: join(mockDir, "references"),
        });

        expect(bundle.role).toBe("non-existent-role");
        expect(bundle.identity.name).toBe("non-existent-role");
        expect(bundle.definition.role).toBe("non-existent-role");
        expect(bundle.isComplete).toBe(false);
        expect(bundle.validationIssues).toBeDefined();
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });

    test("throws HarnessError in strict mode when role triad is invalid", () => {
      const mockDir = join(tmpdir(), `triad-test-synth-strict-${Date.now()}`);
      mkdirSync(mockDir, { recursive: true });

      try {
        expect(() => {
          synthesizeTriadManifest("non-existent-role", {
            skillRoot: mockDir,
            agentsDir: join(mockDir, "agents"),
            rolesDir: join(mockDir, "roles"),
            referencesDir: join(mockDir, "references"),
            strict: true,
          });
        }).toThrow(HarnessError);
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. assertTriadIntegrity Tests
  // -------------------------------------------------------------------------
  describe("assertTriadIntegrity", () => {
    test("passes assertion for valid role names in repository", () => {
      for (const role of standardRoles) {
        expect(() => assertTriadIntegrity(role)).not.toThrow();
      }
    });

    test("passes assertion for valid pre-synthesized AgentTriadBundle", () => {
      const bundle = synthesizeTriadManifest("orchestrator");
      expect(() => assertTriadIntegrity(bundle)).not.toThrow();
    });

    test("throws HarnessError when role string has missing files", () => {
      const mockDir = join(tmpdir(), `triad-test-assert-str-${Date.now()}`);
      mkdirSync(mockDir, { recursive: true });

      try {
        expect(() => {
          assertTriadIntegrity("ghost-role", {
            skillRoot: mockDir,
            agentsDir: join(mockDir, "agents"),
            rolesDir: join(mockDir, "roles"),
            referencesDir: join(mockDir, "references"),
          });
        }).toThrow(HarnessError);
      } finally {
        rmSync(mockDir, { recursive: true, force: true });
      }
    });

    test("throws HarnessError when bundle is incomplete or has tier mismatch", () => {
      const incompleteBundle: AgentTriadBundle = {
        role: "broken-agent",
        tier: 3,
        identity: {
          name: "broken-agent",
          role: "broken-agent",
          tier: 3,
          displayName: "Broken Agent",
          shortDescription: "Broken",
        },
        definition: {
          role: "broken-agent",
          tier: 3,
          may: [],
          mustNot: [],
          commands: [],
          spawns: [],
          body: "",
        },
        references: [],
        isComplete: false,
        validationIssues: ["Missing files"],
      };

      expect(() => assertTriadIntegrity(incompleteBundle)).toThrow(HarnessError);

      const tierMismatchBundle: AgentTriadBundle = {
        role: "mismatched",
        tier: 2,
        identity: {
          name: "mismatched",
          role: "mismatched",
          tier: 2,
          displayName: "Mismatched",
          shortDescription: "Mismatched",
        },
        definition: {
          role: "mismatched",
          tier: 3,
          may: [],
          mustNot: [],
          commands: [],
          spawns: [],
          body: "",
        },
        references: [
          {
            id: "cli",
            title: "CLI",
            filePath: "/dummy/cli.md",
            category: "cli",
            sizeBytes: 10,
            format: "markdown",
          },
        ],
        isComplete: true,
      };

      expect(() => assertTriadIntegrity(tierMismatchBundle)).toThrow(HarnessError);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Helper & Utility Functions Tests
  // -------------------------------------------------------------------------
  describe("Helper & Loader Functions", () => {
    test("loadAgentIdentity loads existing manifests correctly", () => {
      const impl = loadAgentIdentity("implementer");
      expect(impl.name).toBe("implementer");
      expect(impl.role).toBe("implementer");
      expect(impl.tier).toBe(3);
      expect(impl.filePath).toBeDefined();
      expect(impl.rawYaml).toBeDefined();
    });

    test("loadAgentRoleDefinition loads existing contracts correctly", () => {
      const coord = loadAgentRoleDefinition("coordinator");
      expect(coord.role).toBe("coordinator");
      expect(coord.tier).toBe(2);
      expect(coord.may.length).toBeGreaterThan(0);
      expect(coord.mustNot.length).toBeGreaterThan(0);
      expect(coord.commands.length).toBeGreaterThan(0);
      expect(coord.filePath).toBeDefined();
    });

    test("loadAgentReferenceDocs parses all markdown and json reference docs", () => {
      const docs: readonly AgentReferenceDoc[] = loadAgentReferenceDocs();
      expect(docs.length).toBeGreaterThanOrEqual(10);
      const ids = docs.map((d) => d.id);
      expect(ids).toContain("cli");
      expect(ids).toContain("cli-capabilities");
      expect(ids).toContain("protocol");

      for (const doc of docs) {
        expect(doc.id.length).toBeGreaterThan(0);
        expect(doc.title.length).toBeGreaterThan(0);
        expect(doc.filePath.length).toBeGreaterThan(0);
        expect(doc.sizeBytes).toBeGreaterThan(0);
        expect(["markdown", "json"]).toContain(doc.format);
      }
    });

    test("findRelevantReferencesForRole matches protocol instructions, contract body, and general docs", () => {
      const allDocs = loadAgentReferenceDocs();
      const identity = loadAgentIdentity("orchestrator");
      const definition = loadAgentRoleDefinition("orchestrator");

      const relevant = findRelevantReferencesForRole("orchestrator", allDocs, identity, definition);
      expect(relevant.length).toBeGreaterThan(0);
      const relevantIds = relevant.map((d) => d.id);
      expect(relevantIds).toContain("cli-capabilities");
      expect(relevantIds).toContain("protocol");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Static Invariants & Strict TypeScript Verification
  // -------------------------------------------------------------------------
  describe("Static Invariants & Zero-Any / Zero-Suppression Verification", () => {
    test("zero TypeScript any and zero compiler suppressions across agent-triad source and tests", () => {
      const sourceFiles = [
        join(__dirname, "../../../olt/scripts/src/agents/agent-triad.ts"),
        __filename,
      ];

      const anyAnnotation = /:\s*any\b/;
      const anyCast = /as\s+any\b/;
      const anyGeneric = /<\s*any\s*>/;
      const tsIgnore = "@" + "ts-ignore";
      const tsExpectError = "@" + "ts-expect-error";
      const tsNoCheck = "@" + "ts-nocheck";
      const lintSuppressionA = "es" + "lint-disable";
      const lintSuppressionB = "ox" + "lint-disable";

      for (const filePath of sourceFiles) {
        const content = readFileSync(filePath, "utf-8");

        expect(content).not.toMatch(anyAnnotation);
        expect(content).not.toMatch(anyCast);
        expect(content).not.toMatch(anyGeneric);
        expect(content.includes(tsIgnore)).toBe(false);
        expect(content.includes(tsExpectError)).toBe(false);
        expect(content.includes(tsNoCheck)).toBe(false);
        expect(content.includes(lintSuppressionA)).toBe(false);
        expect(content.includes(lintSuppressionB)).toBe(false);
      }
    });
  });
});
