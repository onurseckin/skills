import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { writeBrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-store.ts";
import type { BrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-types.ts";
import type { GraphNodeData } from "../../../../olt/scripts/src/summary/graph/index.ts";

const vfs = new Map<string, string>();
const vdirs = new Set<string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => String(p).replace(/\/+$/, "");

export function setupBrowserVirtualFS(): void {
  cleanupBrowserVirtualFS();
  const oe = fs.existsSync.bind(fs);
  const or = fs.readFileSync.bind(fs);
  const oreaddir = fs.readdirSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
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
      vfs.set(
        s,
        typeof d === "string"
          ? d
          : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf-8"),
      );
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      const s = norm(p);
      vdirs.add(s);
      return undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      vfs.delete(s);
      vdirs.delete(s);
      for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
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
}

export function cleanupBrowserVirtualFS(): void {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
}

export function runRootWith(records: readonly BrowserRunRecord[]): string {
  rootCounter += 1;
  const root = `/virtual/graph-browser-${rootCounter}`;
  vdirs.add(root);
  vdirs.add(join(root, "evidence"));
  for (const record of records) writeBrowserRunRecord(root, record);
  return root;
}

export function makeBrowserRun(overrides: Partial<BrowserRunRecord> = {}): BrowserRunRecord {
  return {
    command_id: "C-1",
    task_id: "T-1",
    actor: "worker-1",
    report_path: "/repo/test-results/report.json",
    runner: "gvui-visual-suite",
    test_file: "tests/browser/login.spec.ts",
    browser: "chromium",
    status: "passed",
    duration_ms: 1500,
    viewport: { width: 1440, height: 900 },
    traces: ["/artifacts/trace.zip"],
    videos: ["/artifacts/session.webm"],
    evidence_classes: {
      runner: "agent_reported",
      test_file: "agent_reported",
      browser: "agent_reported",
      viewport: "agent_reported",
      traces: "agent_reported",
      videos: "agent_reported",
      duration_ms: "harness_observed",
      status: "harness_observed",
    },
    ...overrides,
  };
}

export function nodeById(nodes: readonly GraphNodeData[], id: string): GraphNodeData | undefined {
  return nodes.find((node) => node.id === id);
}
