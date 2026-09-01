import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
} from "../../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";

export const hygieneEngineSuiteName = "Doctor Repository Hygiene Diagnostic Engine";

interface VirtualNode {
  isDir: boolean;
  mode?: number;
  content?: string;
}

class VirtualFs {
  private readonly nodes = new Map<string, VirtualNode>();

  addDir(path: string): void {
    const normalized = path.replace(/\/+$/, "");
    this.nodes.set(normalized, { isDir: true, mode: 0o755 });
    // ensure parent directories exist
    const parts = normalized.split("/");
    for (let i = 2; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (parent && !this.nodes.has(parent)) {
        this.nodes.set(parent, { isDir: true, mode: 0o755 });
      }
    }
  }

  addFile(path: string, content = "", mode = 0o644): void {
    const normalized = path.replace(/\/+$/, "");
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent) this.addDir(parent);
    this.nodes.set(normalized, { isDir: false, mode, content });
  }

  has(path: string): boolean {
    const normalized = path.replace(/\/+$/, "");
    return this.nodes.has(normalized);
  }

  get(path: string): VirtualNode | undefined {
    const normalized = path.replace(/\/+$/, "");
    return this.nodes.get(normalized);
  }

  delete(path: string): boolean {
    const normalized = path.replace(/\/+$/, "");
    return this.nodes.delete(normalized);
  }

  readdir(dirPath: string): string[] {
    const normalized = dirPath.replace(/\/+$/, "");
    const prefix = `${normalized}/`;
    const entries = new Set<string>();
    for (const key of this.nodes.keys()) {
      if (key.startsWith(prefix) && key.length > prefix.length) {
        const rest = key.slice(prefix.length);
        const firstSegment = rest.split("/")[0];
        if (firstSegment) entries.add(firstSegment);
      }
    }
    return Array.from(entries);
  }

  rename(from: string, to: string): void {
    const fromNorm = from.replace(/\/+$/, "");
    const toNorm = to.replace(/\/+$/, "");
    const node = this.nodes.get(fromNorm);
    if (node) {
      this.nodes.delete(fromNorm);
      this.addFile(toNorm, node.content, node.mode);
    }
  }
}

const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(vfs: VirtualFs): void {
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p)));
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file or directory, stat '${String(p)}'`);
    return {
      isFile: () => !node.isDir,
      isDirectory: () => node.isDir,
      isSymbolicLink: () => false,
      mode: node.mode ?? (node.isDir ? 0o755 : 0o644),
      size: node.content ? node.content.length : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file or directory, lstat '${String(p)}'`);
    return {
      isFile: () => !node.isDir,
      isDirectory: () => node.isDir,
      isSymbolicLink: () => false,
      mode: node.mode ?? (node.isDir ? 0o755 : 0o644),
      size: node.content ? node.content.length : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p) => {
    return vfs.readdir(String(p)) as unknown as fs.Dirent[];
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file '${String(p)}'`);
    return node.content ?? "";
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    vfs.addFile(String(p), String(data));
  });
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.addDir(String(p));
    return undefined;
  });
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    vfs.rename(String(from), String(to));
  });
  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
    vfs.delete(String(p));
  });

  spies.push(
    existsSpy,
    statSpy,
    lstatSpy,
    readdirSpy,
    readSpy,
    writeSpy,
    mkdirSpy,
    renameSpy,
    unlinkSpy,
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) {
    s.mockRestore();
  }
});

function createVirtualWorkspace(vfs: VirtualFs): string {
  const root = "/virtual/workspace";
  vfs.addDir(root);
  vfs.addFile(join(root, "package.json"), "{}");
  vfs.addFile(join(root, "README.md"), "# Doctor Test");
  vfs.addFile(join(root, "tsconfig.json"), "{}");
  return root;
}

describe(hygieneEngineSuiteName, () => {
  it("reports healthy status on clean repository workspace", () => {
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    const root = createVirtualWorkspace(vfs);

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.scrubbedFiles).toHaveLength(0);
  });

  it("detects unapproved root files, loose scratch scripts and unapproved directories", () => {
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    const root = createVirtualWorkspace(vfs);

    vfs.addFile(join(root, "fix-bug.ts"), "const a = 1;");
    vfs.addFile(join(root, "loose.sh"), "#!/bin/bash", 0o755);
    vfs.addFile(join(root, "rogue.data"), "raw");
    vfs.addDir(join(root, "unapproved_dir"));

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBe(4);

    const types = result.violations.map((v) => v.violationType);
    expect(types).toContain("UNCONFINED_SCRATCH_SCRIPT");
    expect(types).toContain("UNAPPROVED_ROOT_FILE");
    expect(types).toContain("UNAPPROVED_ROOT_DIR");
  });

  it("detects static package runtime pollution under olt/", () => {
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    const root = createVirtualWorkspace(vfs);

    const oltDir = join(root, "olt");
    const covDir = join(oltDir, "coverage");
    vfs.addDir(covDir);
    vfs.addFile(join(covDir, "lcov.info"), "TN:");
    vfs.addFile(join(oltDir, "defects.jsonl"), "{}");

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    const staticViolations = result.violations.filter(
      (v) => v.violationType === "STATIC_PACKAGE_RUNTIME_POLLUTION",
    );
    expect(staticViolations.length).toBe(2);
  });

  it("quarantines offending files and returns scrubbed file paths when fix=true", () => {
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    const root = createVirtualWorkspace(vfs);

    vfs.addFile(join(root, "fix-temp.ts"), "export const x = 10;");
    vfs.addFile(join(root, "unapproved.tmp"), "temp");

    const firstResult = checkRepositoryHygiene({ repoRoot: root, fix: true });
    expect(firstResult.passed).toBe(false);
    expect(firstResult.scrubbedFiles.length).toBe(2);
    expect(vfs.has(join(root, "fix-temp.ts"))).toBe(false);
    expect(vfs.has(join(root, "unapproved.tmp"))).toBe(false);

    const secondResult = checkRepositoryHygiene({ repoRoot: root });
    expect(secondResult.passed).toBe(true);
    expect(secondResult.violations).toHaveLength(0);
  });

  it("purgeOrphanedScratch moves loose root files to scratch/orphaned/", () => {
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    const root = createVirtualWorkspace(vfs);

    vfs.addFile(join(root, "loose-scratch.ts"), "export const s = 1;");
    vfs.addFile(join(root, "junk.txt"), "junk");

    const scrubbed = purgeOrphanedScratch(root);
    expect(scrubbed).toContain("loose-scratch.ts");
    expect(scrubbed).toContain("junk.txt");
    expect(vfs.has(join(root, "loose-scratch.ts"))).toBe(false);
    expect(vfs.has(join(root, "junk.txt"))).toBe(false);
    expect(vfs.has(join(root, "scratch", "orphaned"))).toBe(true);
    expect(vfs.has(join(root, "package.json"))).toBe(true);
    expect(vfs.has(join(root, "README.md"))).toBe(true);
  });

  it("verifies hygiene-engine adheres to zero comments and physical line limits", () => {
    const filePath = join(process.cwd(), "olt/scripts/src/reporting/doctor/hygiene-engine.ts");
    const vfs = new VirtualFs();
    setupVirtualFs(vfs);
    vfs.addFile(filePath, "export function checkRepositoryHygiene() {}\n");

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);
    expect(content).not.toMatch(/\/\//);
    expect(content).not.toMatch(/\/\*/);
  });
});
