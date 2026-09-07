import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "./fixture.ts";
import {
  clearInMemoryMailboxStore,
  readUnreadMessages,
  setInMemoryStreamMode,
} from "../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import {
  clearInMemoryMailboxDirs,
  resolveMailboxPaths,
} from "../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import { checkAgentCanonicalAlignment } from "../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";
import { collectDiagnosticEngines } from "../../olt/scripts/src/reporting/doctor/diagnostic-collector.ts";
import {
  clearRecentCanonicalTeardowns,
  getRecentCanonicalTeardowns,
  handleCanonicalMisalignment,
} from "../../olt/scripts/src/sentinel/canonical-teardown.ts";

describe("Mechanical Canonical Agent Alignment & Sentinel Teardown Engine", () => {
  beforeEach(() => {
    setupVirtualReportingFS();
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearRecentCanonicalTeardowns();
    setInMemoryStreamMode(true);
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearRecentCanonicalTeardowns();
    setInMemoryStreamMode(false);
  });

  describe("checkAgentCanonicalAlignment", () => {
    it("passes when agents match canonical YAML contracts and invariants", () => {
      const conformingValidator = {
        id: "val-01",
        role: "validator",
        systemPrompt:
          "You are a cognitive validator. Dedicate 100% bandwidth to cognitive critique and Socratic probing.",
        tools: { enable_write_tools: true },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const conformingImplementer = {
        id: "impl-01",
        role: "implementer",
        systemPrompt: "You are an implementer. Run focused file-scoped tests.",
        tools: { enable_write_tools: true },
      };

      const result = checkAgentCanonicalAlignment({
        activeAgents: [conformingValidator, conformingImplementer],
      });

      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it("emits CANONICAL_DEFINITION_MISALIGNMENT when validator is instructed to run bun test", () => {
      const rogueValidator = {
        id: "val-rogue-test",
        role: "validator",
        systemPrompt: "Please run bun test on touched files to verify functionality.",
        tools: { enable_write_tools: true },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const result = checkAgentCanonicalAlignment({
        agentDefinitions: [rogueValidator],
      });

      expect(result.passed).toBe(false);
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.code).toBe("CANONICAL_DEFINITION_MISALIGNMENT");
      expect(finding.severity).toBe("ERROR");
      expect(finding.engine).toBe("checkAgentCanonicalAlignment");
      expect(finding.message).toContain(
        "Agent 'val-rogue-test' definition deviates from canonical YAML contract",
      );
      expect(finding.message).toContain("bun test");
      expect(finding.details?.agentId).toBe("val-rogue-test");
      expect(finding.details?.role).toBe("validator");
      expect(finding.details?.canonicalContract).toBe("olt/agents/validator.yaml");
    });

    it("emits CANONICAL_DEFINITION_MISALIGNMENT when validator write tools are disabled", () => {
      const noWriteToolsValidator = {
        id: "val-no-writes",
        role: "validator",
        systemPrompt: "Pure cognitive analysis without terminal commands.",
        tools: { enable_write_tools: false },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const result = checkAgentCanonicalAlignment({
        agentDefinitions: [noWriteToolsValidator],
      });

      expect(result.passed).toBe(false);
      const writeFinding = result.findings.find((f) =>
        f.message.includes("Write tools must remain mechanically enabled"),
      );
      expect(writeFinding).toBeDefined();
    });

    it("emits CANONICAL_DEFINITION_MISALIGNMENT when shell execution is enabled for validator", () => {
      const shellValidator = {
        id: "val-shell-allowed",
        role: "validator",
        systemPrompt: "Pure cognitive analysis without terminal commands.",
        tools: { enable_write_tools: true, enable_shell: true },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const result = checkAgentCanonicalAlignment({
        agentDefinitions: [shellValidator],
      });

      expect(result.passed).toBe(false);
      const shellFinding = result.findings.find((f) =>
        f.message.includes("Shell execution must be restricted"),
      );
      expect(shellFinding).toBeDefined();
    });

    it("emits CANONICAL_DEFINITION_MISALIGNMENT when COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK is missing", () => {
      const missingTagValidator = {
        id: "val-no-tag",
        role: "validator",
        systemPrompt: "You are a validator.",
        tools: { enable_write_tools: true },
        invariants: [],
      };

      const result = checkAgentCanonicalAlignment({
        agentDefinitions: [missingTagValidator],
      });

      expect(result.passed).toBe(false);
      const tagFinding = result.findings.find((f) =>
        f.message.includes("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"),
      );
      expect(tagFinding).toBeDefined();
    });
  });

  describe("handleCanonicalMisalignment Sentinel Teardown", () => {
    it("sends SENTINEL_CANONICAL_VIOLATION IPC to parent supervisor and returns teardown receipt", () => {
      const receipt = handleCanonicalMisalignment({
        agentId: "val-misaligned",
        role: "validator",
        reason: "Prompt instructed running bun test",
        parentSupervisor: "coordinator-alpha",
      });

      expect(receipt.terminated).toBe(true);
      expect(receipt.agentId).toBe("val-misaligned");
      expect(receipt.receiptCode).toBe("SENTINEL_CANONICAL_VIOLATION");
      expect(typeof receipt.timestamp).toBe("number");

      const recent = getRecentCanonicalTeardowns();
      expect(recent).toHaveLength(1);
      expect(recent[0].agentId).toBe("val-misaligned");

      const supervisorInbox = resolveMailboxPaths("coordinator-alpha").inboxPath;
      const unread = readUnreadMessages(supervisorInbox);
      expect(unread.messages.length).toBeGreaterThanOrEqual(1);
      const msg = unread.messages[0];
      expect(msg.payload.event).toBe("SENTINEL_CANONICAL_VIOLATION");
      expect(msg.payload.agentId).toBe("val-misaligned");
      expect(msg.payload.reason).toBe("Prompt instructed running bun test");
      expect(msg.payload.teardown).toBe(true);
    });

    it("defaults parent supervisor to 'parent' when omitted", () => {
      const receipt = handleCanonicalMisalignment({
        agentId: "val-orphan",
        role: "validator",
        reason: "Missing zero command hardlock",
      });

      expect(receipt.terminated).toBe(true);
      const parentInbox = resolveMailboxPaths("parent").inboxPath;
      const unread = readUnreadMessages(parentInbox);
      expect(unread.messages.length).toBeGreaterThanOrEqual(1);
      expect(unread.messages[0].payload.event).toBe("SENTINEL_CANONICAL_VIOLATION");
    });
  });

  describe("Diagnostic Collector Integration", () => {
    it("collectDiagnosticEngines aggregates checkAgentCanonicalAlignment successfully", () => {
      const conforming = {
        id: "val-collector-ok",
        role: "validator",
        systemPrompt: "Cognitive validator analysis only.",
        tools: { enable_write_tools: true },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const result = collectDiagnosticEngines({
        repoRoot: tempDir("diag-collector-ok"),
        state: { agents: [conforming] },
      });

      const engineRes = result.engineResults.checkAgentCanonicalAlignment;
      expect(engineRes).toBeDefined();
      expect(engineRes.passed).toBe(true);
      expect(engineRes.findings).toHaveLength(0);
    });

    it("collectDiagnosticEngines fails check and records issues when misaligned agent is in state", () => {
      const rogue = {
        id: "val-collector-rogue",
        role: "validator",
        systemPrompt: "Execute bun test in terminal to ensure pass",
        tools: { enable_write_tools: true },
        invariants: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
      };

      const result = collectDiagnosticEngines({
        repoRoot: tempDir("diag-collector-rogue"),
        state: { agents: [rogue] },
      });

      const engineRes = result.engineResults.checkAgentCanonicalAlignment;
      expect(engineRes).toBeDefined();
      expect(engineRes.passed).toBe(false);
      expect(
        result.allEngineFindings.some((f) => f.code === "CANONICAL_DEFINITION_MISALIGNMENT"),
      ).toBe(true);
      expect(
        result.engineErrorIssues.some((issue) =>
          issue.includes("deviates from canonical YAML contract"),
        ),
      ).toBe(true);
    });
  });
});
