import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { ingestBrowserRun } from "../../../olt/scripts/src/reporting/browser-run-ingestion.ts";
import { readBrowserRunReport } from "../../../olt/scripts/src/reporting/browser-run-report.ts";
import { buildNodeBrowserTests } from "../../../olt/scripts/src/summary/formatters/index.ts";
import { buildNodeScripts } from "../../../olt/scripts/src/summary/markdown/index.ts";
import { makeCommand } from "../reporters/dag/graph-fixtures.ts";

const vfs = new Map<string, string>();
const vdirs = new Set<string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs),
    oreaddir = fs.readdirSync.bind(fs),
    ostat = fs.statSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s);
        const isDir = vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          mtimeMs: Date.now(),
          size: isFile ? (vfs.get(s)?.length ?? 0) : 0,
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats;
      }
      return ostat(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf-8"),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return om(p) as string | undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        vdirs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, opt?: unknown): unknown => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const prefix = `${s}/`;
        const entries = new Map<string, boolean>();
        for (const k of vfs.keys()) {
          if (k.startsWith(prefix) && k.length > prefix.length) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, rel.includes("/"));
          }
        }
        for (const d of vdirs) {
          if (d.startsWith(prefix) && d.length > prefix.length) {
            const rel = d.slice(prefix.length);
            entries.set(rel.split("/")[0]!, true);
          }
        }
        const withTypes =
          typeof opt === "object" &&
          opt !== null &&
          "withFileTypes" in opt &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return Array.from(entries.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })) as unknown as fs.Dirent[];
        }
        return Array.from(entries.keys());
      }
      return oreaddir(p, opt as Parameters<typeof oreaddir>[1]);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
});

function tempRoot(name: string): string {
  rootCounter += 1;
  const root = `/virtual/${name}-${rootCounter}`;
  vdirs.add(root);
  return root;
}

function writeReport(dir: string, body: unknown): string {
  const path = join(dir, "report.json");
  vfs.set(path, JSON.stringify(body));
  return path;
}

describe("a recorded command carries what the caller declared it was", () => {
  test("the category, the tool and the extras reach the graph labelled as reported", () => {
    const [script] = buildNodeScripts([
      makeCommand("C-1", {
        tool_category: "test-runner",
        tool: "the-suite",
        tool_extras: { shard: "2/4" },
      }),
    ]);

    expect(script?.category).toBe("test-runner");
    expect(script?.tool).toBe("the-suite");
    expect(script?.extras).toEqual({ shard: "2/4" });
    expect(script?.evidence_class).toBe("harness_observed");
    expect(script?.evidence).toEqual({
      category: "agent_reported",
      tool: "agent_reported",
      extras: "agent_reported",
    });
  });

  test("a command nobody described carries no category and no tool at all", () => {
    const [script] = buildNodeScripts([makeCommand("C-2", { argv: ["some-runner", "test"] })]);

    expect(script?.category).toBeUndefined();
    expect(script?.tool).toBeUndefined();
    expect(script?.extras).toBeUndefined();
    expect(script?.evidence).toBeUndefined();
  });

  test("a category declared without a tool is still recorded, and only it is labelled", () => {
    const [script] = buildNodeScripts([makeCommand("C-3", { tool_category: "type-checker" })]);

    expect(script?.category).toBe("type-checker");
    expect(script?.tool).toBeUndefined();
    expect(script?.evidence).toEqual({ category: "agent_reported" });
  });
});

describe("a browser run is one instance of a generic category", () => {
  test("the category follows from how the report was read, so it is derived", () => {
    const root = tempRoot("browser-category");
    const repo = tempRoot("browser-category-repo");
    writeReport(join(repo, "test-results"), {
      runner: "some-runner",
      suites: [{ file: "tests/browser/login.spec.ts" }],
    });

    const record = ingestBrowserRun({
      runRoot: root,
      commandId: "C-1",
      searchDirs: [repo],
      startedAt: new Date(Date.now() - 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });

    expect(record?.category).toBe("browser-automation");
    expect(record?.evidence_classes.category).toBe("derived");
    expect(record?.runner).toBe("some-runner");
  });

  test("what the report said beyond the generic fields is kept under its own names", () => {
    const root = tempRoot("browser-extras");
    const repo = tempRoot("browser-extras-repo");
    writeReport(join(repo, "test-results"), {
      runner: "some-runner",
      traceFormat: "zip",
      shard: 2,
      retried: false,
      suites: [{ file: "tests/browser/login.spec.ts" }],
    });

    const record = ingestBrowserRun({
      runRoot: root,
      commandId: "C-1",
      searchDirs: [repo],
      startedAt: new Date(Date.now() - 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });

    expect(record?.extras).toEqual({ traceFormat: "zip", shard: 2, retried: false });
    expect(record?.evidence_classes.extras).toBe("agent_reported");

    const [graphRun] = buildNodeBrowserTests([makeCommand("C-1")], root);
    expect(graphRun?.category).toBe("browser-automation");
    expect(graphRun?.extras).toEqual({ traceFormat: "zip", shard: 2, retried: false });
    expect(graphRun?.evidence.category).toBe("derived");
  });

  test("a nested value is not flattened into an extra nobody reported", () => {
    const repo = tempRoot("browser-extras-nested");
    const path = writeReport(repo, {
      runner: "some-runner",
      shardInfo: { current: 2, total: 4 },
      suites: [{ file: "tests/browser/a.spec.ts" }],
    });

    expect(readBrowserRunReport(path)?.extras).toBeUndefined();
  });

  test("a report with nothing beyond the generic fields carries no extras bag", () => {
    const repo = tempRoot("browser-extras-none");
    const path = writeReport(repo, {
      runner: "some-runner",
      suites: [{ file: "tests/browser/a.spec.ts" }],
    });

    expect(readBrowserRunReport(path)?.extras).toBeUndefined();
  });

  test("an extras bag alone is not evidence that a run happened", () => {
    const repo = tempRoot("browser-extras-only");
    const path = writeReport(repo, { traceFormat: "zip", suites: [] });

    expect(readBrowserRunReport(path)).toBeUndefined();
  });
});
