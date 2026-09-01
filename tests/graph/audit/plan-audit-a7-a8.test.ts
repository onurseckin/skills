import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  AUDIT_INVARIANT_IDS,
  auditPlan,
  isAuditInvariantId,
} from "../../../olt/scripts/src/graph/plan-audit.ts";
import { saveRepoPolicy, type RepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";

const vfs = new Map<string, string>();
const vdirs = new Set<string>();
const openFds = new Map<number, { path: string; content: string }>();
let rootCounter = 0,
  nextFd = 100;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs),
    olstat = fs.lstatSync.bind(fs);
  const ostat = fs.statSync.bind(fs),
    oreal = fs.realpathSync.bind(fs),
    oo = fs.openSync.bind(fs);
  const ofstat = fs.fstatSync.bind(fs),
    oc = fs.closeSync.bind(fs),
    orename = fs.renameSync.bind(fs);
  const ochmod = fs.chmodSync.bind(fs),
    owsync = fs.writeSync.bind(fs),
    ofsync = fs.fsyncSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? norm(p) : oreal(p),
    ),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir = vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size: isFile ? (vfs.get(s)?.length ?? 0) : 0,
          mode: isDir ? 0o755 : 0o600,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          nlink: 1,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }
      return olstat(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir = vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size: isFile ? (vfs.get(s)?.length ?? 0) : 0,
          mode: isDir ? 0o755 : 0o600,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          nlink: 1,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }
      return ostat(p);
    }),
    spyOn(fs, "openSync").mockImplementation((p, f, m) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content: vfs.get(s) ?? "" });
        return fd;
      }
      return oo(p, f, m);
    }),
    spyOn(fs, "fstatSync").mockImplementation((fd) => {
      if (openFds.has(fd)) {
        const f = openFds.get(fd)!;
        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          mode: 0o600,
          nlink: 1,
          dev: 1,
          ino: 1,
          size: f.content.length,
        } as unknown as fs.Stats;
      }
      return ofstat(fd);
    }),
    spyOn(fs, "writeSync").mockImplementation(
      (fd: number, data: string | NodeJS.ArrayBufferView) => {
        const openFile = openFds.get(fd);
        if (openFile) {
          const text =
            typeof data === "string"
              ? data
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf-8");
          openFile.content += text;
          vfs.set(openFile.path, openFile.content);
          return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
        }
        return owsync(fd, data as Parameters<typeof owsync>[1]);
      },
    ),
    spyOn(fs, "fsyncSync").mockImplementation((fd: number) =>
      openFds.has(fd) ? undefined : ofsync(fd),
    ),
    spyOn(fs, "closeSync").mockImplementation((fd) =>
      openFds.has(fd) ? (openFds.delete(fd), undefined) : oc(fd),
    ),
    spyOn(fs, "renameSync").mockImplementation((oldP, newP) => {
      const so = norm(oldP),
        sn = norm(newP);
      if (so.startsWith("/virtual/") || sn.startsWith("/virtual/")) {
        const c = vfs.get(so) ?? "";
        vfs.set(sn, c);
        vfs.delete(so);
        return undefined;
      }
      return orename(oldP, newP);
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) =>
      norm(p).startsWith("/virtual/") ? undefined : ochmod(p, m),
    ),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      if (typeof p === "number" && openFds.has(p)) {
        const c = openFds.get(p)!.content;
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      const s = norm(String(p));
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
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  openFds.clear();
});

function tempDir(prefix = "plan-audit-"): string {
  rootCounter += 1;
  const root = `/virtual/${prefix}${rootCounter}`;
  vdirs.add(root);
  return root;
}

function generatePrompt(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, i) => `Requirement ${i + 1}: Detailed actionable obligation`,
  ).join("\n");
}

function sampleTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${i + 1}`,
    writeScope: [`src/module-${i + 1}.ts`],
    deps: [] as string[],
    gate: `bun test tests/unit/module-${i + 1}.test.ts`,
  }));
}

describe("plan-audit A7 and A8 invariant registry", () => {
  it("includes A7 and A8 in AUDIT_INVARIANT_IDS", () => {
    expect(AUDIT_INVARIANT_IDS).toContain("A7-edge-case-exhaustiveness");
    expect(AUDIT_INVARIANT_IDS).toContain("A8-systemic-decomposition");
    expect(isAuditInvariantId("A7-edge-case-exhaustiveness")).toBe(true);
    expect(isAuditInvariantId("A8-systemic-decomposition")).toBe(true);
  });
});

describe("A7-edge-case-exhaustiveness", () => {
  const repoRoot = "/virtual/repo/plan-audit-fixture";

  it("passes when prompt carries <= 5 non-blank lines without mapped edge cases", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(5));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("blocks when prompt carries > 5 non-blank lines and 0 edge cases are mapped", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(6));
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeDefined();
    expect(a7?.severity).toBe("blocking");
    expect(a7?.evidence_class).toBe("derived");
    expect(a7?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a7?.message).toContain("0 edge-case matrix vectors or brainstorming items");
  });

  it("passes when prompt carries > 5 non-blank lines and runState.brainstorming array is provided", () => {
    const runState = { brainstorming: [{ id: "item-1", vectorId: "EMPTY_PAYLOAD" }] };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.brainstorming is an object with totalExpandedItems", () => {
    const runState = { brainstorming: { totalExpandedItems: 8, roundsExecuted: 3 } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.brainstorming has expandedItems array", () => {
    const runState = { brainstorming: { expandedItems: [{ id: "item-1" }, { id: "item-2" }] } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.edge_cases is provided", () => {
    const runState = { edge_cases: ["ec-1", "ec-2"] };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.planning contains brainstorming", () => {
    const runState = { planning: { brainstorming: { totalExpandedItems: 16 } } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when brainstorming.json exists in repoRoot", () => {
    const root = tempDir("plan-audit-a7-");
    vfs.set(join(root, "brainstorming.json"), JSON.stringify({ totalExpandedItems: 8 }));
    const result = auditPlan(root, sampleTasks(2), {}, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });
});

describe("A8-systemic-decomposition", () => {
  const repoRoot = "/virtual/repo/plan-audit-fixture";

  it("passes when prompt carries <= 10 non-blank lines with few tasks", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(10));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });

  it("blocks when prompt carries > 10 non-blank lines and tasks count < 6 (default minimum)", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(15));
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeDefined();
    expect(a8?.severity).toBe("blocking");
    expect(a8?.evidence_class).toBe("derived");
    expect(a8?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a8?.message).toContain("complex prompt");
    expect(a8?.message).toContain("minimum required: 6");
  });

  it("passes when prompt carries > 10 non-blank lines and tasks count >= 6", () => {
    const runState = { brainstorming: [{ id: "1" }] };
    const result = auditPlan(repoRoot, sampleTasks(6), runState, generatePrompt(15));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });

  it("honors custom repo policy min_tasks_per_complex_prompt threshold", () => {
    const root = tempDir("plan-audit-a8-");
    const customPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      planning: {
        mandatory_brainstorming_rounds: 3,
        socratic_expansion_depth: 8,
        enforce_edge_case_matrix: true,
        min_tasks_per_complex_prompt: 3,
        max_files_per_task: 2,
        reject_shallow_umbrella_compression: true,
      },
    };
    saveRepoPolicy(customPolicy, root);
    const runState = { brainstorming: [{ id: "1" }] };
    const result = auditPlan(root, sampleTasks(3), runState, generatePrompt(15));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });
});
