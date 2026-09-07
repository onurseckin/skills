import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertInsideMirrorRoot,
  collectStalePaths,
  formatPruneReport,
  isPreservedEntry,
  pruneMirror,
  PRESERVED_MIRROR_ENTRIES,
} from "../../../scripts/sync/prune.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  getVirtualSyncSession,
  scratchRoot,
  setupVirtualSyncFS,
} from "../sync-fixture.ts";

let vfs: ReturnType<typeof getVirtualSyncFS>;

beforeEach(() => {
  vfs = setupVirtualSyncFS();
  getVirtualSyncSession();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

interface MirrorPair {
  readonly sourceDir: string;
  readonly mirrorDir: string;
}

function buildMirrorPair(label: string): MirrorPair {
  const root = scratchRoot(import.meta.path, label);
  const sourceDir = join(root, "repo", "chatroom");
  const mirrorDir = join(root, "home", "agents", "skills", "chatroom");
  vfs.mkdirSync(join(sourceDir, "scripts", "src", "handshake"), { recursive: true });
  vfs.mkdirSync(join(mirrorDir, "scripts", "src", "handshake"), { recursive: true });
  for (const dir of [sourceDir, mirrorDir]) {
    vfs.writeFileSync(join(dir, "SKILL.md"), "skill\n");
    vfs.writeFileSync(join(dir, "scripts", "src", "handshake", "index.ts"), "export {};\n");
    vfs.writeFileSync(join(dir, "scripts", "src", "handshake", "mint.ts"), "export {};\n");
  }
  return { sourceDir, mirrorDir };
}

describe("prune removes what the source deleted", () => {
  test("a nested file present only in the mirror is reported and then removed", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("removes-deleted");
    const stalePath = join("scripts", "src", "handshake", "invite.ts");
    vfs.writeFileSync(join(mirrorDir, stalePath), "pre-split implementation\n");

    const dryRun = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir });
    expect(dryRun.applied).toBe(false);
    expect(dryRun.stalePaths).toEqual([stalePath]);
    expect(vfs.existsSync(join(mirrorDir, stalePath))).toBe(true);

    const applied = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true });
    expect(applied.applied).toBe(true);
    expect(applied.stalePaths).toEqual([stalePath]);
    expect(vfs.existsSync(join(mirrorDir, stalePath))).toBe(false);
    expect(vfs.existsSync(join(mirrorDir, "scripts", "src", "handshake", "mint.ts"))).toBe(true);
    expect(vfs.existsSync(join(mirrorDir, "SKILL.md"))).toBe(true);
  });

  test("a whole directory the source dropped is removed with its contents", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("removes-directory");
    vfs.mkdirSync(join(mirrorDir, "scripts", "tests", "cli"), { recursive: true });
    vfs.writeFileSync(join(mirrorDir, "scripts", "tests", "cli", "join.test.ts"), "stale\n");

    const applied = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true });
    expect(applied.stalePaths).toEqual([join("scripts", "tests")]);
    expect(vfs.existsSync(join(mirrorDir, "scripts", "tests"))).toBe(false);
    expect(vfs.existsSync(join(mirrorDir, "scripts", "src"))).toBe(true);
  });

  test("a mirror identical to source yields no stale paths", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("no-drift");
    const result = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true });
    expect(result.stalePaths).toEqual([]);
    expect(vfs.existsSync(join(mirrorDir, "SKILL.md"))).toBe(true);
  });
});

describe("prune preserves consumer and deploy owned state", () => {
  test("every preserved root entry survives an applied prune that sees no source copy", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("preserve-set");
    for (const entry of PRESERVED_MIRROR_ENTRIES) {
      if (entry.endsWith(".json")) {
        vfs.writeFileSync(join(mirrorDir, entry), "{}\n");
      } else {
        vfs.mkdirSync(join(mirrorDir, entry), { recursive: true });
        vfs.writeFileSync(join(mirrorDir, entry, "state.json"), "{}\n");
      }
    }

    const result = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true });

    expect(result.stalePaths).toEqual([]);
    for (const entry of PRESERVED_MIRROR_ENTRIES) {
      expect(vfs.existsSync(join(mirrorDir, entry))).toBe(true);
    }
  });

  test("preservation is anchored at the root segment, not matched anywhere in the path", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("preserve-anchored");
    vfs.mkdirSync(join(mirrorDir, "scripts", "node_modules"), { recursive: true });
    vfs.writeFileSync(join(mirrorDir, "scripts", "node_modules", "vendored.ts"), "stale\n");

    const result = pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true });

    expect(result.stalePaths).toEqual([join("scripts", "node_modules")]);
    expect(vfs.existsSync(join(mirrorDir, "scripts", "node_modules"))).toBe(false);
  });

  test("isPreservedEntry accepts the root entry and its descendants only", () => {
    expect(isPreservedEntry("node_modules")).toBe(true);
    expect(isPreservedEntry(join("node_modules", "js-yaml", "index.js"))).toBe(true);
    expect(isPreservedEntry(join("scripts", "node_modules"))).toBe(false);
    expect(isPreservedEntry("SKILL.md")).toBe(false);
  });
});

describe("prune refuses to escape the mirror root", () => {
  test("a sibling of the mirror root is rejected by resolved absolute path", () => {
    const root = scratchRoot(import.meta.path, "escape-sibling");
    const mirrorRoot = join(root, "skills", "chatroom");
    vfs.mkdirSync(mirrorRoot, { recursive: true });

    expect(() => assertInsideMirrorRoot(join(root, "skills", "olt"), mirrorRoot)).toThrow(
      HarnessError,
    );
    expect(() => assertInsideMirrorRoot(join(mirrorRoot, "..", "olt"), mirrorRoot)).toThrow(
      HarnessError,
    );
    expect(() => assertInsideMirrorRoot(mirrorRoot, mirrorRoot)).toThrow(HarnessError);
    expect(assertInsideMirrorRoot(join(mirrorRoot, "SKILL.md"), mirrorRoot)).toBe(
      join(mirrorRoot, "SKILL.md"),
    );
  });

  test("a mirrorDir outside the declared mirror root is refused before any walk", () => {
    const root = scratchRoot(import.meta.path, "escape-mirrordir");
    const mirrorRoot = join(root, "skills", "chatroom");
    const outside = join(root, "skills", "olt");
    vfs.mkdirSync(mirrorRoot, { recursive: true });
    vfs.mkdirSync(outside, { recursive: true });
    vfs.writeFileSync(join(outside, "SKILL.md"), "must survive\n");

    expect(() =>
      pruneMirror({ sourceDir: mirrorRoot, mirrorDir: outside, mirrorRoot, apply: true }),
    ).toThrow(HarnessError);
    expect(vfs.existsSync(join(outside, "SKILL.md"))).toBe(true);
  });

  test("a git repository inside the mirror stops the deletion", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("escape-git");
    vfs.mkdirSync(join(mirrorDir, "vendor", ".git"), { recursive: true });
    vfs.writeFileSync(join(mirrorDir, "vendor", "precious.txt"), "do-not-delete\n");

    expect(() => pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true })).toThrow(
      HarnessError,
    );
    expect(vfs.existsSync(join(mirrorDir, "vendor", "precious.txt"))).toBe(true);
  });
});

describe("prune compares trees rather than changesets", () => {
  test("collectStalePaths finds a deletion that has no counterpart path in source", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("tree-compare");
    vfs.mkdirSync(join(mirrorDir, "references"), { recursive: true });
    vfs.writeFileSync(join(mirrorDir, "references", "retired.md"), "retired\n");
    vfs.writeFileSync(join(mirrorDir, "scripts", "src", "handshake", "invite.ts"), "stale\n");

    expect(collectStalePaths(sourceDir, mirrorDir)).toEqual([
      "references",
      join("scripts", "src", "handshake", "invite.ts"),
    ]);
  });

  test("formatPruneReport names the dry-run override and the applied removals", () => {
    const { sourceDir, mirrorDir } = buildMirrorPair("report");
    vfs.writeFileSync(join(mirrorDir, "scripts", "src", "handshake", "invite.ts"), "stale\n");

    const dryReport = formatPruneReport([
      pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir }),
    ]);
    expect(dryReport).toContain("would remove (dry run) 1 entries");
    expect(dryReport).toContain("pass --prune to remove these entries");

    const appliedReport = formatPruneReport([
      pruneMirror({ sourceDir, mirrorDir, mirrorRoot: mirrorDir, apply: true }),
    ]);
    expect(appliedReport).toContain("removed 1 entries");
    expect(appliedReport).not.toContain("pass --prune");
  });
});
