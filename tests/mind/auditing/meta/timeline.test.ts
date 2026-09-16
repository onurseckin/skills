import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  discoverActiveTranscripts,
  extractToolCallsFromTranscripts,
} from "../../../../olt/scripts/src/mind/auditing/meta/timeline.ts";
import {
  ANTI_MOCK_INJECTION_INVARIANT,
  findVisualReportCandidates,
  isScratchOrExcludedPath,
  scanDirectoryForVisualReports,
} from "../../../../olt/scripts/src/reporting/screenshot-scanner.ts";
import {
  COORDINATOR_ZERO_CODE_EDITS,
  evaluateWatchdogRoleBoundary,
  getRoleCapabilities,
} from "../../../../olt/scripts/src/roles/role-boundary.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../../cli/commands/fixtures/full-lifecycle-fixture.ts";

describe("Timeline Forensics & Governance Enforcement Suite", () => {
  let vfs: ReturnType<typeof getVirtualCliFS>;

  beforeEach(() => {
    setupVirtualCliFS();
    vfs = getVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  describe("discoverActiveTranscripts", () => {
    it("discovers transcripts across antigravity, antigravity-cli, and repo root", () => {
      const home = homedir() || process.env.HOME || "";
      const agBrain = join(home, ".gemini", "antigravity", "brain", "conv-ag");
      const agCliBrain = join(home, ".gemini", "antigravity-cli", "brain", "conv-cli");
      const repoRoot = "/virtual/test-repo";

      const fileAg = join(agBrain, ".system_generated", "logs", "transcript.jsonl");
      const fileCli = join(agCliBrain, "transcript.jsonl");
      const fileRepo = join(repoRoot, ".system_generated", "logs", "transcript.jsonl");

      vfs.mkdirSync(join(agBrain, ".system_generated", "logs"), { recursive: true });
      vfs.writeFileSync(fileAg, '{"step":1}\n');

      vfs.mkdirSync(agCliBrain, { recursive: true });
      vfs.writeFileSync(fileCli, '{"step":2}\n');

      vfs.mkdirSync(join(repoRoot, ".system_generated", "logs"), { recursive: true });
      vfs.writeFileSync(fileRepo, '{"step":3}\n');

      const discovered = discoverActiveTranscripts(repoRoot);
      expect(discovered).toContain(fileAg);
      expect(discovered).toContain(fileCli);
      expect(discovered).toContain(fileRepo);
    });

    it("returns empty array safely when brain directories do not exist", () => {
      const discovered = discoverActiveTranscripts();
      expect(Array.isArray(discovered)).toBe(true);
    });
  });

  describe("extractToolCallsFromTranscripts", () => {
    it("parses line-by-line JSONL and unpacks step.tool_calls with prefix stripping", () => {
      const jsonl = [
        JSON.stringify({
          step_index: 1,
          agent_id: "agent-01",
          task_id: "task-01",
          created_at: "2026-09-15T10:00:00.000Z",
          tool_calls: [
            {
              name: "default_api:view_file",
              arguments: { AbsolutePath: "/repo/file.ts" },
            },
            {
              name: "mcp_host_replace_file_content",
              arguments: { TargetFile: "/repo/file.ts", ReplacementContent: "new content" },
            },
          ],
        }),
        JSON.stringify({
          step_index: 2,
          tool_calls: [
            {
              tool: "write_to_file",
              parameters: { TargetFile: "/repo/output.txt" },
            },
          ],
        }),
      ].join("\n");

      const calls = extractToolCallsFromTranscripts([jsonl]);
      expect(calls.length).toBe(3);

      expect(calls[0]!.name).toBe("view_file");
      expect(calls[0]!.isRead).toBe(true);
      expect(calls[0]!.isWrite).toBe(false);
      expect(calls[0]!.agentId).toBe("agent-01");
      expect(calls[0]!.taskId).toBe("task-01");
      expect(calls[0]!.targetPath).toBe("/repo/file.ts");

      expect(calls[1]!.name).toBe("replace_file_content");
      expect(calls[1]!.isWrite).toBe(true);
      expect(calls[1]!.targetPath).toBe("/repo/file.ts");

      expect(calls[2]!.name).toBe("write_to_file");
      expect(calls[2]!.isWrite).toBe(true);
      expect(calls[2]!.targetPath).toBe("/repo/output.txt");
    });

    it("handles stringified JSON arguments in tool calls", () => {
      const jsonl = JSON.stringify({
        step_index: 1,
        tool_calls: [
          {
            name: "replace_file_content",
            arguments: JSON.stringify({
              TargetFile: "/repo/stringified.ts",
              WaitMsBeforeAsync: 5000,
            }),
          },
        ],
      });

      const calls = extractToolCallsFromTranscripts([jsonl]);
      expect(calls.length).toBe(1);
      expect(calls[0]!.name).toBe("replace_file_content");
      expect(calls[0]!.isWrite).toBe(true);
      expect(calls[0]!.targetPath).toBe("/repo/stringified.ts");
      expect(calls[0]!.waitMsBeforeAsync).toBe(5000);
    });

    it("resiliently skips corrupted lines without dropping valid lines", () => {
      const jsonl = [
        "corrupted non-json line {{{{",
        JSON.stringify({
          tool_calls: [{ name: "run_command", args: { CommandLine: "echo 1" } }],
        }),
        "another bad line !!!",
        JSON.stringify({
          tool_calls: [{ name: "list_dir", arguments: { DirectoryPath: "/src" } }],
        }),
      ].join("\n");

      const calls = extractToolCallsFromTranscripts([jsonl]);
      expect(calls.length).toBe(2);
      expect(calls[0]!.name).toBe("run_command");
      expect(calls[1]!.name).toBe("list_dir");
    });

    it("falls back to full pretty-printed JSON array parsing when not formatted per line", () => {
      const prettyJson = JSON.stringify(
        [
          {
            name: "write_to_file",
            arguments: { TargetFile: "/path/pretty.ts" },
          },
        ],
        null,
        2,
      );

      const calls = extractToolCallsFromTranscripts([prettyJson]);
      expect(calls.length).toBe(1);
      expect(calls[0]!.name).toBe("write_to_file");
      expect(calls[0]!.isWrite).toBe(true);
      expect(calls[0]!.targetPath).toBe("/path/pretty.ts");
    });

    it("falls back to raw text regex scanner when no JSON objects are present", () => {
      const rawText = "Tool Use: view_file\ncall: default_api:write_to_file";
      const calls = extractToolCallsFromTranscripts([rawText]);
      expect(calls.length).toBe(2);
      expect(calls[0]!.name).toBe("view_file");
      expect(calls[0]!.isRead).toBe(true);
      expect(calls[1]!.name).toBe("write_to_file");
      expect(calls[1]!.isWrite).toBe(true);
    });
  });

  describe("ANTI_MOCK_INJECTION_INVARIANT & Screenshot Scanner", () => {
    it("exports ANTI_MOCK_INJECTION_INVARIANT token", () => {
      expect(ANTI_MOCK_INJECTION_INVARIANT).toBe("ANTI_MOCK_INJECTION_INVARIANT");
    });

    it("identifies and rejects scratch, .olt/scratch, and .tmp paths", () => {
      expect(isScratchOrExcludedPath("scratch/visual-report.json")).toBe(true);
      expect(isScratchOrExcludedPath("/root/project/.olt/scratch/visual-report.json")).toBe(true);
      expect(isScratchOrExcludedPath(".tmp/visual-report.md")).toBe(true);
      expect(isScratchOrExcludedPath("/path/to/tmp/mock.json")).toBe(true);
      expect(isScratchOrExcludedPath("src/scratchpad.ts")).toBe(false);
      expect(isScratchOrExcludedPath("evidence/visual-report.json")).toBe(false);
    });

    it("excludes scratch directories from scanDirectoryForVisualReports and candidate finding", () => {
      const testDir = "/virtual/run-quarantine";
      const legitReport = join(testDir, "evidence", "visual-report.json");
      const mockScratchReport = join(testDir, "scratch", "visual-report.json");
      const mockOltScratchReport = join(testDir, ".olt", "scratch", "visual-report.json");
      const mockTmpReport = join(testDir, ".tmp", "visual-report.md");

      vfs.mkdirSync(join(testDir, "evidence"), { recursive: true });
      vfs.mkdirSync(join(testDir, "scratch"), { recursive: true });
      vfs.mkdirSync(join(testDir, ".olt", "scratch"), { recursive: true });
      vfs.mkdirSync(join(testDir, ".tmp"), { recursive: true });

      vfs.writeFileSync(legitReport, "{}");
      vfs.writeFileSync(mockScratchReport, "{}");
      vfs.writeFileSync(mockOltScratchReport, "{}");
      vfs.writeFileSync(mockTmpReport, "# Visual Report");

      const scanned = scanDirectoryForVisualReports(testDir);
      expect(scanned).toContain(legitReport);
      expect(scanned).not.toContain(mockScratchReport);
      expect(scanned).not.toContain(mockOltScratchReport);
      expect(scanned).not.toContain(mockTmpReport);

      const candidates = findVisualReportCandidates([testDir], undefined, undefined, [
        mockScratchReport,
        legitReport,
      ]);
      expect(candidates).toContain(legitReport);
      expect(candidates).not.toContain(mockScratchReport);
    });
  });

  describe("COORDINATOR_ZERO_CODE_EDITS & Role Boundary", () => {
    it("exports COORDINATOR_ZERO_CODE_EDITS invariant token", () => {
      expect(COORDINATOR_ZERO_CODE_EDITS).toBe("COORDINATOR_ZERO_CODE_EDITS");
    });

    it("denies code writes and write leases to coordinators", () => {
      const caps = getRoleCapabilities("coordinator");
      expect(caps.canWriteCode).toBe(false);
      expect(caps.canClaimLeases).toBe(false);
      expect(caps.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(caps.invariants).toContain("COORDINATOR_ZERO_CODE_EDITS");

      const writeEval = evaluateWatchdogRoleBoundary("coordinator", "code_write", "src/foo.ts");
      expect(writeEval.allowed).toBe(false);
      expect(writeEval.violation?.ruleId).toBe("watchdog:role-boundary:zero-code-edits");

      const leaseEval = evaluateWatchdogRoleBoundary("coordinator", "lease_claim", "task-123");
      expect(leaseEval.allowed).toBe(false);
      expect(leaseEval.violation?.ruleId).toBe("watchdog:role-boundary:lease-prohibited");
    });
  });
});
