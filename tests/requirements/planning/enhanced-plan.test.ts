import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { renderEnhancedPlanMarkdown } from "../../../olt/scripts/src/requirements/enhanced-plan-markdown.ts";
import {
  buildEnhancedPlan,
  ENHANCED_PLAN_JSON_FILE,
  ENHANCED_PLAN_MARKDOWN_FILE,
  ENHANCED_PLAN_SCHEMA,
  ENHANCED_PLAN_VERSION,
  PLANNING_DIRECTORY,
  writeEnhancedPlan,
  type EnhancedPlanInput,
} from "../../../olt/scripts/src/requirements/enhanced-plan.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import * as durableWriteModule from "../../../olt/scripts/src/core/durable-write.ts";

function input(overrides: Partial<EnhancedPlanInput> = {}): EnhancedPlanInput {
  return {
    runId: "run-1",
    promptSha256: "a".repeat(64),
    actor: "coordinator",
    recordedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildEnhancedPlan", () => {
  test("refuses to build a plan with nothing reported at all", () => {
    expect(() => buildEnhancedPlan(input())).toThrow(HarnessError);
    expect(() => buildEnhancedPlan(input())).toThrow(
      "plan:enhance needs at least one of --summary, --observation, --todo, --risk or --open-question",
    );
  });

  test("a summary alone is enough, and every reported field carries agent_reported evidence", () => {
    const document = buildEnhancedPlan(input({ summary: "Ship the parser" }));
    expect(document.schema).toBe(ENHANCED_PLAN_SCHEMA);
    expect(document.version).toBe(ENHANCED_PLAN_VERSION);
    expect(document.derived_from).toBe("prompt.md");
    expect(document.authoritative).toBe(false);
    expect(document.summary).toEqual({
      value: "Ship the parser",
      evidence_class: "agent_reported",
    });
    expect(document.observations).toEqual([]);
    expect(document.todos).toEqual([]);
  });

  test("omits the summary key entirely rather than writing it as null or undefined", () => {
    const document = buildEnhancedPlan(input({ observations: ["Found a stray file"] }));
    expect("summary" in document).toBe(false);
  });

  test("wraps observations, risks, open questions and sources in agent_reported evidence", () => {
    const document = buildEnhancedPlan(
      input({
        observations: ["Observed A"],
        risks: ["Risk A"],
        openQuestions: ["Question A"],
        sources: ["src/a.ts"],
      }),
    );
    expect(document.observations).toEqual([
      { value: "Observed A", evidence_class: "agent_reported" },
    ]);
    expect(document.risks).toEqual([{ value: "Risk A", evidence_class: "agent_reported" }]);
    expect(document.open_questions).toEqual([
      { value: "Question A", evidence_class: "agent_reported" },
    ]);
    expect(document.sources).toEqual([{ value: "src/a.ts", evidence_class: "agent_reported" }]);
  });

  test("todos are numbered sequentially starting at 1, in input order", () => {
    const document = buildEnhancedPlan(input({ todos: ["First", "Second", "Third"] }));
    expect(document.todos).toEqual([
      { id: "todo-1", text: "First", evidence_class: "agent_reported" },
      { id: "todo-2", text: "Second", evidence_class: "agent_reported" },
      { id: "todo-3", text: "Third", evidence_class: "agent_reported" },
    ]);
  });
});

describe("writeEnhancedPlan (in-memory virtual)", () => {
  const mockFiles = new Map<string, Uint8Array>();
  const mockStats = new Map<string, { mode: number }>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockStats.clear();

    spies.push(spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string));
    spies.push(
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return Buffer.from(val) as unknown as string & Buffer;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
    );
    spies.push(
      spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
        const val = mockStats.get(String(p));
        if (val !== undefined) return val as unknown as fs.Stats;
        return { mode: 0o644 } as unknown as fs.Stats;
      }),
    );
    spies.push(
      spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation(
        (targetPath, bytes, options) => {
          mockFiles.set(targetPath, bytes);
          const mode =
            typeof options === "object" &&
            options !== null &&
            typeof (options as { mode?: number }).mode === "number"
              ? (options as { mode?: number }).mode!
              : 0o644;
          mockStats.set(targetPath, { mode });
        },
      ),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("writes both files under planning/, and reports hashes that match what landed on disk", () => {
    const runRoot = `${process.cwd()}/.olt/virtual-enhanced-plan-run`;
    const document = buildEnhancedPlan(input({ summary: "Ship it", todos: ["Do the thing"] }));
    const artifacts = writeEnhancedPlan(runRoot, document);

    expect(artifacts.json_path).toBe(join(PLANNING_DIRECTORY, ENHANCED_PLAN_JSON_FILE));
    expect(artifacts.markdown_path).toBe(join(PLANNING_DIRECTORY, ENHANCED_PLAN_MARKDOWN_FILE));

    const jsonBytes = fs.readFileSync(join(runRoot, artifacts.json_path));
    const markdownBytes = fs.readFileSync(join(runRoot, artifacts.markdown_path));
    expect(sha256Bytes(jsonBytes)).toBe(artifacts.json_sha256);
    expect(sha256Bytes(markdownBytes)).toBe(artifacts.markdown_sha256);
    expect(jsonBytes).toEqual(Buffer.from(canonicalJsonBytes(document)));
    expect(markdownBytes.toString("utf8")).toBe(renderEnhancedPlanMarkdown(document));

    expect(fs.statSync(join(runRoot, artifacts.json_path)).mode & 0o777).toBe(0o444);
    expect(fs.statSync(join(runRoot, artifacts.markdown_path)).mode & 0o777).toBe(0o444);
  });
});

describe("renderEnhancedPlanMarkdown", () => {
  test("reports every empty section as nothing reported rather than an empty heading", () => {
    const document = buildEnhancedPlan(input({ observations: ["placeholder"] }));
    document.observations = [];
    const markdown = renderEnhancedPlanMarkdown(document);
    expect(markdown).toContain("_Nothing reported._");
    expect(markdown).toContain(`# Enhanced Plan — ${document.run_id}`);
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });

  test("bullets observations, risks, and open questions when they are present", () => {
    const document = buildEnhancedPlan(
      input({
        observations: ["Found a stray file"],
        risks: ["Untested rollback path"],
        openQuestions: ["Who owns this after launch?"],
      }),
    );
    const markdown = renderEnhancedPlanMarkdown(document);
    expect(markdown).toContain("- Found a stray file");
    expect(markdown).toContain("- Untested rollback path");
    expect(markdown).toContain("- Who owns this after launch?");
  });

  test("numbers todos and bullets sources when both are present", () => {
    const document = buildEnhancedPlan(
      input({
        todos: ["First item", "Second item"],
        sources: ["src/a.ts", "src/b.ts"],
      }),
    );
    const markdown = renderEnhancedPlanMarkdown(document);
    expect(markdown).toContain("1. First item");
    expect(markdown).toContain("2. Second item");
    expect(markdown).toContain("- `src/a.ts`");
    expect(markdown).toContain("- `src/b.ts`");
  });
});
