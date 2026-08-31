import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  gatePathBindingIssues,
  inside,
  portableRelative,
  resolvePathExecutable,
} from "../../../../olt/scripts/src/engine/runner/signing/gate-path-binding-verify.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gate-path-binding-verify-"));
  roots.push(root);
  return root;
}

describe("inside", () => {
  test("is true for a path nested under the root", () => {
    expect(inside("/repo", "/repo/src/file.ts")).toBe(true);
  });

  test("is true for the root path itself (relative resolves to an empty string)", () => {
    expect(inside("/repo", "/repo")).toBe(true);
  });

  test("is false for a sibling directory or an ancestor of the root", () => {
    expect(inside("/repo", "/repo-other/file.ts")).toBe(false);
    expect(inside("/repo/src", "/repo")).toBe(false);
  });
});

describe("portableRelative", () => {
  test("returns a forward-slash path for a location inside the repository root", async () => {
    const root = await repoRoot();
    expect(portableRelative(root, join(root, "src", "file.ts"))).toBe("src/file.ts");
  });

  test("throws when the path is the repository root itself", async () => {
    const root = await repoRoot();
    expect(() => portableRelative(root, root)).toThrow(
      "gate path must resolve inside repositoryRoot",
    );
  });

  test("throws when the path escapes the repository root", async () => {
    const root = await repoRoot();
    expect(() => portableRelative(root, join(root, "..", "outside"))).toThrow(
      "gate path must resolve inside repositoryRoot",
    );
  });
});

describe("resolvePathExecutable", () => {
  test("resolves an executable found on the PATH", async () => {
    const root = await repoRoot();
    const bin = join(root, "bin");
    await mkdir(bin);
    const tool = join(bin, "tool");
    await writeFile(tool, "#!/bin/sh\nexit 0\n");
    await chmod(tool, 0o700);
    expect(resolvePathExecutable("tool", bin)).toBe(realpathSync(tool));
  });

  test("skips a non-executable candidate and a missing directory entry on the PATH", async () => {
    const root = await repoRoot();
    const bin = join(root, "bin");
    await mkdir(bin);
    const notExecutable = join(bin, "tool");
    await writeFile(notExecutable, "#!/bin/sh\nexit 0\n");
    await chmod(notExecutable, 0o600);
    const missingDir = join(root, "does-not-exist");
    expect(() => resolvePathExecutable("tool", `${missingDir}${delimiter}${bin}`)).toThrow(
      "gate executable is not resolvable: tool",
    );
  });

  test("throws when the executable cannot be found anywhere on the PATH", () => {
    expect(() => resolvePathExecutable("does-not-exist-anywhere", "")).toThrow(
      "gate executable is not resolvable: does-not-exist-anywhere",
    );
  });
});

describe("gatePathBindingIssues error handling", () => {
  test("reports a verification failure instead of throwing when argv is invalid", async () => {
    const root = await repoRoot();
    const issues = gatePathBindingIssues(root, root, [], undefined, "");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^gate path identity cannot be verified: /);
  });
});
