import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  analyzeRunForensics,
  type AnalyzeRunForensicsOptions,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import { metaAuditCommand } from "../../../../olt/scripts/src/cli/commands/meta-audit.ts";
import type {
  AgentGrantRecord,
  Manifest,
  RunState,
} from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("Meta Auditor - Transcripts Parsing & CLI Command (in-memory virtual)", () => {
  let scratchDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    scratchDir = scratchRoot("meta-tx", "test");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("filters analysis by agent filter option", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-filter-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-filter-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:05:00.000Z",
      status: "succeeded",
      tasks: {},
      agents: [
        {
          id: "agent-a",
          role: "implementer",
          status: "released",
          tokens_in: 200000,
          tokens_out: 1000,
        },
        {
          id: "agent-b",
          role: "implementer",
          status: "released",
          tokens_in: 5000,
          tokens_out: 1000,
        },
      ],
    };
    fs.writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
    fs.writeFileSync(join(scratchDir, "events.jsonl"), "");

    const resultB = analyzeRunForensics({
      runRoot: scratchDir,
      agent: "agent-b",
    });

    expect(resultB.agent_filter).toBe("agent-b");
    expect(resultB.metrics.totalAgents).toBe(1);
    expect(resultB.incidents).toHaveLength(0);
    expect(resultB.isClean).toBe(true);
  });

  it("parses transcripts in JSON format and regex log format", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-tx-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(
      join(scratchDir, "state.json"),
      JSON.stringify({ version: "2.0.0", run_id: "run-tx-test", tasks: {}, agents: [] }),
    );
    fs.writeFileSync(join(scratchDir, "events.jsonl"), "");

    const jsonTranscriptPath = join(scratchDir, "transcript1.json");
    fs.writeFileSync(
      jsonTranscriptPath,
      JSON.stringify([
        { tool: "view_file", agent_id: "agent-json", arguments: { AbsolutePath: "/src/foo.ts" } },
        { tool: "write_to_file", agent_id: "agent-json", arguments: { TargetFile: "/src/foo.ts" } },
      ]),
    );

    const regexTranscriptPath = join(scratchDir, "transcript2.log");
    fs.writeFileSync(
      regexTranscriptPath,
      `
      call: default_api:grep_search
      Tool Use: replace_file_content
      "toolAction": "list_dir"
      `,
    );

    const result = analyzeRunForensics({
      runRoot: scratchDir,
      transcripts: [jsonTranscriptPath, regexTranscriptPath],
    });

    expect(result.metrics.totalToolCalls).toBe(5);
    expect(result.metrics.fileReadCount).toBe(3);
    expect(result.metrics.fileWriteCount).toBe(2);
  });

  it("accepts custom agentLedger passed in analysis options", () => {
    const customLedger: readonly AgentGrantRecord[] = [
      {
        id: "custom-agent-1",
        role: "implementer",
        status: "released",
        tokens_in: 190000,
        tokens_out: 2000,
      },
    ];

    const options: AnalyzeRunForensicsOptions = {
      run: scratchDir,
      agentLedger: customLedger,
    };

    const result = analyzeRunForensics(options);
    expect(result.metrics.totalAgents).toBe(1);
    expect(result.incidents.some((i) => i.category === "CONTEXT_OVERFLOW")).toBe(true);
  });

  describe("CLI Command metaAuditCommand", () => {
    it("executes metaAuditCommand with markdown format", async () => {
      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-cli-md",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      fs.writeFileSync(
        join(scratchDir, "state.json"),
        JSON.stringify({ version: "2.0.0", run_id: "run-cli-md", tasks: {}, agents: [] }),
      );
      fs.writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = await metaAuditCommand({
        run: scratchDir,
        format: "markdown",
      });

      expect(result.format).toBe("markdown");
      expect(result.markdown).toContain("Meta-Auditor Deep Behavioral Forensics Report");
      expect(result.report).toBeDefined();
      expect(result.report.runId).toBe("run-cli-md");
    });

    it("executes metaAuditCommand with json format", async () => {
      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-cli-json",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      fs.writeFileSync(
        join(scratchDir, "state.json"),
        JSON.stringify({ version: "2.0.0", run_id: "run-cli-json", tasks: {}, agents: [] }),
      );
      fs.writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = await metaAuditCommand({
        run: scratchDir,
        json: true,
      });

      expect(result.format).toBe("json");
      expect(result.report).toBeDefined();
      expect(result.report.runId).toBe("run-cli-json");
    });
  });
});
