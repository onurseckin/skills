import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { clientLinkPaths } from "../../../olt/scripts/src/installer/client-links.ts";
import { SKILL_NAME } from "../../../olt/scripts/src/installer/constants.ts";
import {
  assertInstalledRuntimeFresh,
  freshnessFindings,
  type RuntimeFreshnessReport,
} from "../../../olt/scripts/src/installer/runtime-freshness.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "../helpers.ts";

afterEach(cleanInstallerFixtures);

function primaryPath(home: string): string {
  return join(home, ".agents", "skills", SKILL_NAME);
}

async function installPrimary(home: string, source: string): Promise<string> {
  const destination = primaryPath(home);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
  return destination;
}

async function installIndependentCopy(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await cp(source, path, { recursive: true });
}

async function symlinkClient(home: string, client: "claude" | "antigravity"): Promise<void> {
  const target = primaryPath(home);
  const path = clientLinkPaths(home)[client];
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, "dir");
}

describe("freshnessFindings", () => {
  function fixtureReport(overrides: Partial<RuntimeFreshnessReport> = {}): RuntimeFreshnessReport {
    return {
      referenceRoot: "/reference",
      referenceDigest: "a".repeat(64),
      referenceRuntimeVersion: "1.0.0",
      roots: [
        {
          kind: "primary",
          path: "/home/.agents/skills/olt",
          present: false,
          resolvedPath: null,
          digest: null,
          runtimeVersion: null,
          fresh: true,
          issue: null,
        },
        {
          kind: "claude",
          path: "/home/.claude/skills/olt",
          present: true,
          resolvedPath: "/home/.claude/skills/olt",
          digest: "b".repeat(64),
          runtimeVersion: "0.9.0",
          fresh: false,
          issue: "installed content disagrees",
        },
      ],
      drifted: true,
      ...overrides,
    };
  }

  test("includes only the drifted, present roots", () => {
    const findings = freshnessFindings(fixtureReport());
    expect(findings).toHaveLength(1);
    const [finding] = findings as Array<Record<string, unknown>>;
    expect(finding?.severity).toBe("blocking");
    expect(finding?.kind).toBe("claude");
    expect(finding?.reference_runtime_version).toBe("1.0.0");
  });

  test("returns an empty array when every root is fresh or absent", () => {
    const report = fixtureReport({
      roots: [
        {
          kind: "primary",
          path: "/x",
          present: false,
          resolvedPath: null,
          digest: null,
          runtimeVersion: null,
          fresh: true,
          issue: null,
        },
      ],
      drifted: false,
    });
    expect(freshnessFindings(report)).toEqual([]);
  });
});

describe("assertInstalledRuntimeFresh", () => {
  test("returns null without checking anything when executingRuntime is not a real skill source", async () => {
    const root = scratchRoot(import.meta.path, "not-a-skill-source");
    await mkdir(join(root, "scripts"), { recursive: true });
    expect(await assertInstalledRuntimeFresh(join(root, "scripts"), join(root, "home"))).toBeNull();
  });

  test("no-ops for a repo checkout that is not itself a recognized install root under home", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "dev-checkout-not-install-root");
    const home = join(root, "home");
    const destination = await installPrimary(home, source);
    await writeFile(join(destination, "extra-file.txt"), "the real install has drifted too");
    expect(await assertInstalledRuntimeFresh(join(source, "scripts"), home)).toBeNull();
  });

  test("resolves the reference root as the parent of executingRuntime and does not throw absent drift", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "assert-no-drift");
    const home = join(root, "home");
    const destination = await installPrimary(home, source);
    const report = await assertInstalledRuntimeFresh(join(destination, "scripts"), home);
    expect(report?.drifted).toBe(false);
    expect(report?.referenceRoot).toBe(await realpath(destination));
  });

  test("throws a HarnessError carrying structured findings when a sibling install root has drifted", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "assert-drift-throws");
    const home = join(root, "home");
    const primary = await installPrimary(home, source);
    await symlinkClient(home, "claude");
    const staleSource = join(root, "stale-source");
    await cp(source, staleSource, { recursive: true });
    await writeFile(join(staleSource, "extra-file.txt"), "drift");
    await installIndependentCopy(clientLinkPaths(home).antigravity, staleSource);
    let caught: unknown;
    try {
      await assertInstalledRuntimeFresh(join(primary, "scripts"), home);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("INTEGRITY");
    expect(error.message).toContain("installed-runtime freshness check failed");
    expect(error.issues).toHaveLength(1);
    expect((error.issues[0] as Record<string, unknown>).kind).toBe("antigravity");
  });
});
