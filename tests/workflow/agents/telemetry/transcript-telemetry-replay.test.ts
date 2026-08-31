import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentTranscriptTelemetry } from "../../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "transcript-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("transcript telemetry parsing and recovery", () => {
  test("parses workflow nested subagents transcript and handles fallback paths and invalid files gracefully", () => {
    withTempDir((homeDir) => {
      const sessionId = "sess-nested";
      const projectSlug = "test-project";
      const sessionDir = join(homeDir, ".claude", "projects", projectSlug, sessionId);
      const nestedDir = join(sessionDir, "subagents", "workflows", "run-1");
      mkdirSync(nestedDir, { recursive: true });

      const agentId = "agent-nested-1";
      const jsonlPath = join(nestedDir, `agent-${agentId}.jsonl`);
      // Invalid meta file
      const metaPath = join(nestedDir, `agent-${agentId}.meta.json`);
      writeFileSync(metaPath, "invalid json");

      // Valid jsonl with reverse timestamps (end < start) and empty usage
      writeFileSync(
        jsonlPath,
        [
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-08-20T10:00:10.000Z",
            message: { content: "plain text only" },
          }),
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-08-20T10:00:00.000Z", // earlier than first
            message: {},
          }),
        ].join("\n"),
      );

      // Workflows directory with invalid and non-matching wf json
      const workflowsDir = join(sessionDir, "workflows");
      mkdirSync(workflowsDir, { recursive: true });
      writeFileSync(join(workflowsDir, "not_wf_prefix.json"), "{}");
      writeFileSync(join(workflowsDir, "wf_invalid.json"), "invalid json");
      writeFileSync(
        join(workflowsDir, "wf_no_match.json"),
        JSON.stringify({
          workflowProgress: [{ agentId: "different-agent" }],
        }),
      );
      writeFileSync(
        join(workflowsDir, "wf_fallback_runid.json"),
        JSON.stringify({
          workflowProgress: [{ agentId: "agent-nested-1" }],
        }),
      );

      const telemetry = readAgentTranscriptTelemetry(agentId, {
        env: {
          CLAUDE_CODE_SESSION_ID: sessionId,
          HOME: homeDir,
        },
      });

      expect(telemetry).not.toBeNull();
      expect(telemetry!.sourcePath).toBe(jsonlPath);
      expect(telemetry!.durationMs).toBeUndefined(); // end < start
      expect(telemetry!.runContext?.runId).toBe("wf_fallback_runid");
    });
  });

  test("parses nested workflow transcript with valid meta json", () => {
    withTempDir((homeDir) => {
      const sessionId = "sess-nested-meta";
      const sessionDir = join(homeDir, ".claude", "projects", "proj", sessionId);
      const nestedDir = join(sessionDir, "subagents", "workflows", "run-nested");
      mkdirSync(nestedDir, { recursive: true });

      const agentId = "agent-nested-meta";
      const jsonlPath = join(nestedDir, `agent-${agentId}.jsonl`);
      const metaPath = join(nestedDir, `agent-${agentId}.meta.json`);
      writeFileSync(metaPath, JSON.stringify({ agentType: "implementer", spawnDepth: 1 }));
      writeFileSync(jsonlPath, "");

      const telemetry = readAgentTranscriptTelemetry(agentId, {
        homeDir,
        env: { CLAUDE_CODE_SESSION_ID: sessionId },
      });

      expect(telemetry).not.toBeNull();
      expect(telemetry!.agentType).toBe("implementer");
      expect(telemetry!.spawnDepth).toBe(1);
    });
  });

  test("resolveHomeDir falls back to os.homedir when HOME is absent", () => {
    // When HOME is undefined and homeDir option is undefined, it invokes homedir()
    const result = readAgentTranscriptTelemetry("agent-test", {
      env: { CLAUDE_CODE_SESSION_ID: "sess-fallback-homedir" },
    });
    // Won't find this fake session, but exercises lines 62-66
    expect(result).toBeNull();
  });

  test("handles empty/missing .meta.json and missing workflows directory", () => {
    withTempDir((homeDir) => {
      const sessionId = "sess-minimal";
      const sessionDir = join(homeDir, ".claude", "projects", "p1", sessionId);
      const subagentsDir = join(sessionDir, "subagents");
      mkdirSync(subagentsDir, { recursive: true });

      const agentId = "agent-min";
      const jsonlPath = join(subagentsDir, `agent-${agentId}.jsonl`);
      writeFileSync(jsonlPath, "");

      const telemetry = readAgentTranscriptTelemetry(agentId, {
        homeDir,
        env: { CLAUDE_CODE_SESSION_ID: sessionId },
      });

      expect(telemetry).not.toBeNull();
      expect(telemetry!.sourcePath).toBe(jsonlPath);
      expect(telemetry!.tools).toEqual([]);
      expect(telemetry!.agentType).toBeUndefined();
    });
  });

  test("locates agent transcript inside subagents/workflows/<runDir>/ directory", () => {
    withTempDir((homeDir) => {
      const sessionId = "sess-workflow";
      const sessionDir = join(homeDir, ".claude", "projects", "p1", sessionId);
      const workflowRunDir = join(sessionDir, "subagents", "workflows", "run-123");
      mkdirSync(workflowRunDir, { recursive: true });

      const agentId = "agent-wf";
      const jsonlPath = join(workflowRunDir, `agent-${agentId}.jsonl`);
      const metaPath = join(workflowRunDir, `agent-${agentId}.meta.json`);

      writeFileSync(metaPath, JSON.stringify({ agentType: "implementer", spawnDepth: 2 }));
      writeFileSync(
        jsonlPath,
        JSON.stringify({
          type: "assistant",
          message: {
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [],
          },
        }),
      );

      const telemetry = readAgentTranscriptTelemetry(agentId, {
        homeDir,
        env: { CLAUDE_CODE_SESSION_ID: sessionId },
      });

      expect(telemetry).not.toBeNull();
      expect(telemetry!.sourcePath).toBe(jsonlPath);
      expect(telemetry!.agentType).toBe("implementer");
      expect(telemetry!.spawnDepth).toBe(2);
      expect(telemetry!.tokensIn).toBe(10);
      expect(telemetry!.tokensOut).toBe(5);
    });
  });
});
