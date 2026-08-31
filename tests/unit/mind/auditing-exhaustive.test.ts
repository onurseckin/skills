import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDynamicRoles as auditDynamicRolesHierarchy,
  runAutonomousMindRoleAudit,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  formatNonDuplicatePersonaSummary,
  isMindRole,
} from "../../../olt/scripts/src/mind/auditing/roles/rules/hierarchy.ts";
import { auditSingleRole } from "../../../olt/scripts/src/mind/auditing/roles/contract-auditor.ts";
import {
  auditDynamicRoles as auditDynamicRolesBatch,
  formatRoleAuditMarkdown as formatBatchMarkdown,
  renderRoleAuditAsciiTable as renderBatchAsciiTable,
  formatNonDuplicatePersonaSummary as formatBatchPersonaSummary,
} from "../../../olt/scripts/src/mind/auditing/roles/batch-auditor.ts";
import { synthesizeNonDuplicatePersona } from "../../../olt/scripts/src/mind/auditing/roles/synthesizer.ts";
import {
  getRoleName,
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
} from "../../../olt/scripts/src/mind/auditing/roles/similarity.ts";
import {
  validateParentChildSupervision,
  assertParentChildBoundary,
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
} from "../../../olt/scripts/src/mind/auditing/roles/auditor.ts";
import {
  checkValidatorHardLock,
  checkSpawning,
} from "../../../olt/scripts/src/mind/auditing/roles/rules/leaf-checks.ts";
import { isFullTestSuiteCommand } from "../../../olt/scripts/src/mind/auditing/roles/rules/matrix.ts";
import {
  checkNeverUnattendedActions,
  checkDeclinedCandidates,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/evaluator.ts";
import {
  checkAdmittedCandidateWitnesses,
  checkAdmittedCandidateGoals,
  checkValueConsistency,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/prompts.ts";
import {
  validateAuditAnswers,
  checkAuditBlocksPulse,
  assertAuditAllowsPulseOpen,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/reporter.ts";
import { analyzeRunForensics } from "../../../olt/scripts/src/mind/auditing/meta/evaluator.ts";
import { parseEventsFile } from "../../../olt/scripts/src/mind/auditing/meta/types.ts";
import {
  parseStateFile,
  parseManifestFile,
  extractToolCallsFromTranscripts,
  extractToolCallsFromEvents,
  calculateEfficiencyScore,
} from "../../../olt/scripts/src/mind/auditing/meta/timeline.ts";
import { runExtendedForensicsHeuristics } from "../../../olt/scripts/src/mind/auditing/meta/heuristics-extended.ts";
import { runForensicsHeuristics } from "../../../olt/scripts/src/mind/auditing/meta/heuristics.ts";
import { auditMindPreplanningStagnation } from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import {
  executeStagnationShockRecovery,
  resolveStagnationIncidents,
} from "../../../olt/scripts/src/mind/auditing/stagnation-recovery-interlock.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { DynamicRoleRegistry } from "../../../olt/scripts/src/mind/roles/dynamic/registry.ts";
import type { DynamicRoleSpec } from "../../../olt/scripts/src/mind/roles/dynamic/types.ts";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

describe("Auditing & Roles Exhaustive Unit Test Suite", () => {
  describe("Hierarchy & Role Auditing Rules", () => {
    it("isMindRole matches mind patterns and rejects non-mind", () => {
      expect(isMindRole("mind")).toBe(true);
      expect(isMindRole("mind-1")).toBe(true);
      expect(isMindRole("tier0-mind-architect")).toBe(true);
      expect(isMindRole("orchestrator")).toBe(false);
      expect(isMindRole("implementer")).toBe(false);
    });

    it("audits dynamic roles with duplicate detection, summaries, and ascii tables", () => {
      const specA: DynamicRoleSpec = {
        name: "test-role-a",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "backend",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
        invariants: ["inv-1"],
        cognitivePillars: ["pil-1"],
        permittedActivities: ["implement features"],
      };

      const specB: DynamicRoleSpec = {
        name: "test-role-b",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "backend",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
        invariants: ["inv-1"],
        cognitivePillars: ["pil-1"],
        permittedActivities: ["implement features"],
      };

      const report = auditDynamicRolesHierarchy([specA, specB], {
        checkDuplicates: true,
        duplicateSimilarityThreshold: 0.8,
      });

      expect(report.summary.totalRolesAudited).toBe(2);
      expect(report.duplicatePairs.length).toBeGreaterThan(0);
      expect(report.markdownReport).toContain("Persona Deduplication");

      const asciiTable = renderRoleAuditAsciiTable(report);
      expect(asciiTable).toContain("test-role-a");
      expect(asciiTable).toContain("test-role-b");

      const emptyTable = renderRoleAuditAsciiTable({ ...report, checkedRoles: [] });
      expect(emptyTable).toBe("(no dynamic roles evaluated)");

      const cleanReport = auditDynamicRolesHierarchy([]);
      const cleanMd = formatRoleAuditMarkdown(cleanReport);
      expect(cleanMd).toContain("Zero role audit findings");

      const compactMd = formatRoleAuditMarkdown(report, { compact: true });
      expect(compactMd).toBeDefined();

      const nonDupSummary = formatNonDuplicatePersonaSummary({
        contract: { role: "test-role-c", tier: 3, spec: specA } as any,
        action: "synthesized_disambiguated",
        deduplicated: false,
        signature: { signatureHash: "1234567890abcdef1234" } as any,
        message: "Unique persona created",
        duplicateOfRole: "test-role-a",
        disambiguatedFrom: "test-role-a",
      });
      expect(nonDupSummary).toContain("Non-Duplicate Persona Synthesis");
      expect(nonDupSummary).toContain("Disambiguated From");
    });

    it("runs autonomous role audit using role registry", () => {
      const reg = new DynamicRoleRegistry();
      const spec: DynamicRoleSpec = {
        name: "auto-role",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "testing",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
      };
      reg.register({ role: "auto-role", tier: 3, spec, sha256: "sha-auto" } as any);

      const report = runAutonomousMindRoleAudit(reg as any);
      expect(report.summary.totalRolesAudited).toBe(1);
    });
  });

  describe("Contract Auditor Rules & Cross-Tier Violations", () => {
    it("audits single role from string file path and string YAML content", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "contract-audit-test-"));
      roots.push(tmpDir);

      const roleFile = join(tmpDir, "sample-role.md");
      const yamlContent = `---
role: sample-file-role
tier: 3
archetype: tier_3_implementer
domain: core
writeScopePolicy: lease_bounded
grantedCommands:
  - task:claim
---
# Role Definition
`;
      writeFileSync(roleFile, yamlContent);

      const findingsFromFile = auditSingleRole(roleFile);
      expect(findingsFromFile.length).toBe(0);

      const findingsFromYaml = auditSingleRole(yamlContent);
      expect(findingsFromYaml.length).toBe(0);
    });

    it("detects cross-tier spawning, invalid parent roles, forbidden commands, and validator write violations", () => {
      // Tier 0 spawning non-orchestrator
      const tier0Spec: DynamicRoleSpec = {
        name: "bad-mind",
        tier: 0,
        archetype: "tier_0_mind",
        spawns: ["implementer"],
      };
      const f0 = auditSingleRole(tier0Spec);
      expect(f0.some((f) => f.id.includes("FIND-HIER-SPAWN0"))).toBe(true);

      // Tier 1 spawning non-coordinator
      const tier1Spec: DynamicRoleSpec = {
        name: "bad-orch",
        tier: 1,
        archetype: "tier_1_orchestrator",
        spawns: ["implementer"],
        parentRole: "implementer", // invalid parent
      };
      const f1 = auditSingleRole(tier1Spec);
      expect(f1.some((f) => f.id.includes("FIND-HIER-SPAWN1"))).toBe(true);
      expect(f1.some((f) => f.id.includes("FIND-HIER-PARENT1"))).toBe(true);

      // Tier 2 spawning non-worker and invalid parent
      const tier2Spec: DynamicRoleSpec = {
        name: "bad-coord",
        tier: 2,
        archetype: "tier_2_coordinator",
        spawns: ["orchestrator"],
        parentRole: "mind", // invalid parent (must be orchestrator)
        grantedCommands: ["task:claim", "orchestrator:run"],
      };
      const f2 = auditSingleRole(tier2Spec);
      expect(f2.some((f) => f.id.includes("FIND-HIER-SPAWN2"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-HIER-PARENT2"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-CMD-SUPERCLAIM"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-CMD-ORCHRUN"))).toBe(true);

      // Tier 3 invalid parent and validator write policy
      const tier3ValSpec: DynamicRoleSpec = {
        name: "bad-val",
        tier: 3,
        archetype: "tier_3_validator",
        parentRole: "orchestrator", // invalid parent (must be coordinator)
        writeScopePolicy: "lease_bounded",
        permittedActivities: ["edit code files"],
        cognitivePillars: [],
      };
      const f3 = auditSingleRole(tier3ValSpec, { minCognitivePillars: 2 });
      expect(f3.some((f) => f.id.includes("FIND-HIER-PARENT3"))).toBe(true);
      expect(f3.some((f) => f.id.includes("FIND-LEAK-VALWRITE"))).toBe(true);
      expect(f3.some((f) => f.id.includes("FIND-PILLARS"))).toBe(true);
    });
  });

  describe("Batch Auditor & Synthesizer", () => {
    it("scans rolesDir in batch auditor and formats summaries", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "batch-audit-roles-"));
      roots.push(tmpDir);

      const roleFile = join(tmpDir, "role-one.md");
      writeFileSync(
        roleFile,
        `---
role: role-one
tier: 3
archetype: tier_3_implementer
---
`,
      );

      const report = auditDynamicRolesBatch({ rolesDir: tmpDir });
      expect(report.rolesDir).toBe(tmpDir);

      const md = formatBatchMarkdown(report);
      expect(md).toContain("Mind Autonomous Role Audit Report");

      const asciiEmpty = renderBatchAsciiTable(report);
      expect(asciiEmpty).toBe("(no dynamic roles evaluated)");

      const reportWithRoles = auditDynamicRolesBatch([
        {
          role: "role-one",
          tier: 3,
          spec: { name: "role-one", tier: 3, archetype: "tier_3_implementer" },
        } as any,
      ]);
      const asciiWithRoles = renderBatchAsciiTable(reportWithRoles);
      expect(asciiWithRoles).toContain("ROLE");

      const personaSummary = formatBatchPersonaSummary({
        contract: { role: "test-role" },
        action: "reused_existing",
      });
      expect(personaSummary).toContain("test-role");
    });

    it("synthesizes non-duplicate personas with reuse, auto-disambiguation, and collision error paths", () => {
      const reg = new DynamicRoleRegistry();

      // Synthesize new
      const res1 = synthesizeNonDuplicatePersona(
        {
          name: "synth-role",
          tier: 3,
          archetype: "tier_3_implementer",
          domain: "core",
        },
        reg,
      );
      expect(res1.action).toBe("synthesized_new");
      expect(reg.has("synth-role")).toBe(true);

      // Reused identical
      const resIdentical = synthesizeNonDuplicatePersona(
        {
          name: "synth-role",
          tier: 3,
          archetype: "tier_3_implementer",
          domain: "core",
        },
        reg,
      );
      expect(resIdentical.action).toBe("reused_existing");

      // Name collision with different spec and autoDisambiguate = false -> error
      expect(() =>
        synthesizeNonDuplicatePersona(
          {
            name: "synth-role",
            tier: 3,
            archetype: "tier_3_validator",
            domain: "diff",
            autoDisambiguate: false,
          },
          reg,
        ),
      ).toThrow(HarnessError);

      // Name collision with autoDisambiguate = true -> disambiguated
      const resDisambiguated = synthesizeNonDuplicatePersona(
        {
          name: "synth-role",
          tier: 3,
          archetype: "tier_3_validator",
          domain: "diff",
          autoDisambiguate: true,
        },
        reg,
      );
      expect(resDisambiguated.action).toBe("synthesized_disambiguated");
      expect(resDisambiguated.contract.role).toContain("synth-role-v2");

      // Similar persona reuse under high threshold
      const resSimilarReuse = synthesizeNonDuplicatePersona(
        {
          name: "another-implementer",
          tier: 3,
          archetype: "tier_3_implementer",
          domain: "core",
          allowReuseExisting: true,
          similarityThreshold: 0.7,
        },
        reg,
      );
      expect(resSimilarReuse.action).toBe("reused_existing");
    });
  });

  describe("Similarity & Auditor Utilities", () => {
    it("extracts role names and computes persona signatures", () => {
      expect(getRoleName({ role: "custom-role" } as any)).toBe("custom-role");
      expect(getRoleName({ spec: { name: "spec-role" } } as any)).toBe("spec-role");
      expect(getRoleName({ name: "name-role" } as any)).toBe("name-role");
      expect(getRoleName({} as any)).toBe("");

      const sig = computePersonaSignature({
        name: "role-x",
        tier: 3,
        archetype: "tier_3_implementer",
      });
      expect(sig.role).toBe("role-x");

      const sim = calculatePersonaSimilarity(
        { name: "role-x", tier: 3, archetype: "tier_3_implementer" },
        { name: "role-y", tier: 3, archetype: "tier_3_implementer" },
      );
      expect(typeof sim.similarityScore).toBe("number");

      const similarList = findSimilarPersonas(
        { name: "role-x", tier: 3, archetype: "tier_3_implementer" },
        [{ name: "role-y", tier: 3, archetype: "tier_3_implementer" }],
        0.5,
      );
      expect(similarList.length).toBe(1);
    });

    it("validates parent-child supervision and watchdog actions", () => {
      // Coordinator dispatching Orchestrator (Tier 2 dispatching Tier 1)
      const res21 = validateParentChildSupervision("coordinator", "orchestrator");
      expect(res21.valid).toBe(false);
      expect(res21.reason).toContain("Coordinator");

      // Coordinator dispatching Implementer (Tier 2 dispatching Tier 3)
      const res23 = validateParentChildSupervision("coordinator", "implementer");
      expect(res23.valid).toBe(true);

      // Tier 3 dispatching child
      const res33 = validateParentChildSupervision("implementer", "validator");
      expect(res33.valid).toBe(false);
      expect(res33.reason).toContain("leaf execution agent");

      expect(() =>
        assertParentChildBoundary("coordinator", "orchestrator", "coord-1", "orch-1"),
      ).toThrow(HarnessError);

      const watchdog = createRoleBoundaryWatchdog();
      const singleV = verifyRoleBoundaryAction({
        agentId: "agent-1",
        role: "implementer",
        actionType: "spawning",
        targetRole: "subagent",
      });
      expect(singleV).not.toBeNull();

      const batchV = auditRoleBoundaryActions([
        {
          agentId: "agent-1",
          role: "implementer",
          actionType: "spawning",
          targetRole: "subagent",
        },
      ]);
      expect(batchV.valid).toBe(false);
    });

    it("leaf-checks and matrix edge cases", () => {
      // checkValidatorHardLock returning null for read action
      const vLock = checkValidatorHardLock(
        {
          agentId: "val-1",
          role: "validator",
          actionType: "execution",
          tool: "view_file",
        },
        3,
        new Date().toISOString(),
      );
      expect(vLock).toBeNull();

      // checkSpawning returning null for coordinator -> implementer
      const vSpawn = checkSpawning(
        {
          agentId: "coord-1",
          role: "coordinator",
          actionType: "spawning",
          targetRole: "implementer",
        },
        2,
        new Date().toISOString(),
      );
      expect(vSpawn).toBeNull();

      // isFullTestSuiteCommand
      expect(isFullTestSuiteCommand(["bun", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/my.test.ts"])).toBe(false);
    });
  });

  describe("Questionnaire Evaluator, Prompts, and Reporter", () => {
    it("evaluates never-unattended actions and declined candidates", () => {
      const events: HarnessEvent[] = [
        {
          kind: "never-unattended-violation",
          sequence: 1,
          payload: { reason: "Manual file edit detected" },
        } as any,
        {
          kind: "command-executed",
          sequence: 2,
          payload: { argv: ["rm", "-rf", "/"] },
        } as any,
      ];

      const resNever = checkNeverUnattendedActions(events, {} as any);
      expect(resNever.ok).toBe(false);
      expect(resNever.violations.length).toBeGreaterThan(0);

      // checkDeclinedCandidates with mindState.candidates
      const stateWithMindCandidates: RunState = {
        mind: {
          candidates: [
            { id: "c-1", status: "declined", decline_reason: "Out of scope" },
            { id: "c-2", status: "declined" }, // missing reason
          ],
        },
      } as any;

      const declineEvents: HarnessEvent[] = [
        {
          kind: "mind-candidate-declined",
          sequence: 3,
          payload: { candidate_id: "c-3", reason: "duplicate" },
        } as any,
      ];

      const resDeclined = checkDeclinedCandidates(stateWithMindCandidates, declineEvents);
      expect(resDeclined.ok).toBe(false);
      expect(resDeclined.findings.some((f) => f.includes("c-2"))).toBe(true);
    });

    it("verifies admitted candidate witnesses and charter goals", () => {
      const state: RunState = {
        mind: {
          candidates: [
            { id: "d-1", status: "admitted", kind: "defect", witness: "cmd-1" },
            { id: "d-2", status: "admitted", kind: "defect" }, // missing witness
          ],
        },
      } as any;

      const resWit = checkAdmittedCandidateWitnesses(state, []);
      expect(resWit.ok).toBe(false);
      expect(resWit.findings.some((f) => f.includes("d-2"))).toBe(true);

      const resGoals = checkAdmittedCandidateGoals(
        state,
        [
          {
            kind: "mind-candidate-admitted",
            sequence: 1,
            payload: { candidate_id: "d-1", charter_goals: ["G1", "G_UNKNOWN"] },
          } as any,
        ],
        ["G1", "G2"],
      );
      expect(resGoals.ok).toBe(false);
      expect(resGoals.findings.some((f) => f.includes("G_UNKNOWN"))).toBe(true);
    });

    it("checks pulse value consistency and forbidden metric keys", () => {
      const events: HarnessEvent[] = [
        {
          kind: "mind-pulse-closed",
          sequence: 1,
          payload: {
            pulse_id: "pulse-1",
            value: 999, // inconsistent
            metrics: {
              findings_resolved: 1,
              files_touched: 5, // forbidden key
            },
          },
        } as any,
      ];

      const resVal = checkValueConsistency(events, {} as any);
      expect(resVal.ok).toBe(false);
      expect(resVal.findings.some((f) => f.includes("files_touched"))).toBe(true);
      expect(resVal.findings.some((f) => f.includes("inconsistent"))).toBe(true);
    });

    it("validates answers in object record format and checks audit blocking conditions", () => {
      const answersRecord = {
        Q1: "cmd-1:pass",
        Q2: "cmd-2:fail",
        Q3: { command_id: "cmd-3", verdict: "pass" },
        Q4: { commandId: "cmd-4", verdict: "pass" },
        Q5: { command: "cmd-5", verdict: "pass" },
        Q6: { command: "cmd-6", verdict: "pass" },
        Q7: { command: "cmd-7", verdict: "pass" },
        Q8: { command: "cmd-8", verdict: "pass" },
      };

      const validated = validateAuditAnswers(answersRecord);
      expect(validated.length).toBe(8);

      // Audit blocking checks
      const haltedState: RunState = {
        mind: { halted: true, halt_reason: "emergency stop" },
      } as any;
      const bHalted = checkAuditBlocksPulse(haltedState);
      expect(bHalted.blocked).toBe(true);
      expect(bHalted.outcome).toBe("halted");

      const findingsState: RunState = {
        audit: { open_findings: ["Defect in Q2"] },
      } as any;
      const bFindings = checkAuditBlocksPulse(findingsState);
      expect(bFindings.blocked).toBe(true);
      expect(bFindings.outcome).toBe("blocked");

      const changesState: RunState = {
        audit: { status: "changes_requested" },
      } as any;
      const bChanges = checkAuditBlocksPulse(changesState);
      expect(bChanges.blocked).toBe(true);

      expect(() => assertAuditAllowsPulseOpen(haltedState)).toThrow(HarnessError);
    });
  });

  describe("Meta Forensics & Incident Heuristics", () => {
    it("handles forensics summary toString and parseEventsFile file error", () => {
      const emptyEvents = parseEventsFile("/nonexistent/events.jsonl");
      expect(emptyEvents).toEqual([]);

      const tmpDir = mkdtempSync(join(tmpdir(), "forensics-eval-test-"));
      roots.push(tmpDir);

      const eventsFile = join(tmpDir, "events.jsonl");
      writeFileSync(
        eventsFile,
        JSON.stringify({
          kind: "tool-called",
          actor: "agent-1",
          timestamp: new Date().toISOString(),
          payload: { tool: "run_command", arguments: { CommandLine: "ls" } },
        }) + "\n",
      );

      const forensics = analyzeRunForensics({
        runRoot: tmpDir,
      });
      expect(forensics.summary.toString()).toContain("Run `");
    });

    it("parses state/manifest files and extracts tool calls with diverse parameters", () => {
      expect(parseStateFile("/nonexistent/state.json")).toBeNull();
      expect(parseManifestFile("/nonexistent/manifest.json")).toBeNull();

      const tmpDir = mkdtempSync(join(tmpdir(), "meta-timeline-test-"));
      roots.push(tmpDir);

      const badJsonFile = join(tmpDir, "array.json");
      writeFileSync(badJsonFile, "[1, 2, 3]");
      expect(parseStateFile(badJsonFile)).toBeNull();
      expect(parseManifestFile(badJsonFile)).toBeNull();

      const transcriptJson = JSON.stringify([
        {
          name: "write_to_file",
          agentId: "agent-alpha",
          taskId: "task-1",
          parameters: { TargetFile: "/path/to/file.ts" },
          timestamp: "2026-08-31T00:00:00Z",
        },
      ]);
      const calls = extractToolCallsFromTranscripts([transcriptJson]);
      expect(calls.length).toBe(1);
      expect(calls[0]!.targetPath).toBe("/path/to/file.ts");

      const eventCalls = extractToolCallsFromEvents([
        {
          kind: "command-executed",
          actor: "worker-1",
          timestamp: "2026-08-31T00:00:00Z",
          payload: { command: "run_command", arguments: { AbsolutePath: "/dir" } },
        } as any,
      ]);
      expect(eventCalls.length).toBe(1);

      const score = calculateEfficiencyScore({
        fileWriteCount: 5,
        fileReadCount: 200, // high ratio > 15
        pollingCallsCount: 10, // high polling > 5
        sequentialWaveBottlenecks: 2,
        incidents: [{ severity: "HIGH" }, { severity: "LOW" }],
      });
      expect(score).toBeLessThan(100);
    });

    it("audits context overflow and incident heuristics with boundary violations", () => {
      const incidents: any[] = [];
      const addIncident = (inc: any) => incidents.push(inc);

      // Context overflow on state.agents
      runExtendedForensicsHeuristics({
        runRoot: "/test",
        allToolCalls: [],
        events: [],
        addIncident,
        state: {
          agents: [{ id: "agent-overflow", total_tokens: 190000 }],
        } as any,
      });
      expect(
        incidents.some((i) => i.category === "CONTEXT_OVERFLOW" && i.severity === "CRITICAL"),
      ).toBe(true);

      // Boundary violation in events
      runForensicsHeuristics({
        runRoot: "/test",
        allToolCalls: [],
        events: [
          {
            type: "boundary_violation",
            command_id: "cmd-viol-1",
            message: "Direct edit forbidden",
            actor: "orch-1",
          } as any,
        ],
        addIncident,
      });
      expect(incidents.some((i) => i.category === "ROLE_BOUNDARY_DEVIATION")).toBe(true);
    });
  });

  describe("Stagnation Shock Recovery Interlock", () => {
    it("handles shock recovery triggers, threshold skips, and corrupt defect lines", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "shock-recovery-test-"));
      roots.push(tmpDir);

      const oltDir = join(tmpDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const defectsPath = join(oltDir, "defects.jsonl");
      writeFileSync(
        defectsPath,
        `{"error_code":"LIVE_STAGNATION_DETECTED","status":"OPEN"}\ncorrupt_non_json_line\n{"error_code":"OTHER","status":"OPEN"}\n`,
      );

      const resDefects = resolveStagnationIncidents(tmpDir);
      expect(resDefects.resolvedCount).toBe(1);

      // idle < threshold -> NOOP
      const noopRecovery = executeStagnationShockRecovery(tmpDir, {
        idleDurationSeconds: 10,
        stagnationThresholdSeconds: 120,
      });
      expect(noopRecovery.recovered).toBe(false);
      expect(noopRecovery.recoveryAction).toBe("NOOP");

      // auditMindPreplanningStagnation with shock recovery trigger
      const stagnationRes = auditMindPreplanningStagnation({
        rootDir: tmpDir,
        triggerShockRecovery: true,
        consecutiveStagnationCount: 3,
        stagnationThresholdSeconds: 1,
      });
      expect(stagnationRes).toBeDefined();
    });
  });
});
