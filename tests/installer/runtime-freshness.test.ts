import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { clientLinkPaths } from "../../olt/scripts/src/installer/client-links.ts";
import { SKILL_NAME } from "../../olt/scripts/src/installer/constants.ts";
import {
  assertInstalledRuntimeFresh,
  freshnessFindings,
  installedRuntimeFreshness,
  type RuntimeFreshnessReport,
} from "../../olt/scripts/src/installer/runtime-freshness.ts";
import { validateSkillSource } from "../../olt/scripts/src/installer/source-validation.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

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

describe("installedRuntimeFreshness", () => {
  test("reports every root as present:false and not drifted when nothing is installed", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "nothing-installed");
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const report = await installedRuntimeFreshness(reference, home);
    expect(report.drifted).toBe(false);
    expect(report.roots).toHaveLength(3);
    for (const entry of report.roots) {
      expect(entry.present).toBe(false);
      expect(entry.fresh).toBe(true);
      expect(entry.digest).toBeNull();
      expect(entry.issue).toBeNull();
    }
    expect(report.roots.map((entry) => entry.kind).sort()).toEqual([
      "antigravity",
      "claude",
      "primary",
    ]);
  });

  test("reports fresh when the primary install is byte-identical to the reference", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "primary-fresh");
    const home = join(root, "home");
    await installPrimary(home, source);
    const report = await installedRuntimeFreshness(reference, home);
    expect(report.drifted).toBe(false);
    const primary = report.roots.find((entry) => entry.kind === "primary")!;
    expect(primary.present).toBe(true);
    expect(primary.fresh).toBe(true);
    expect(primary.digest).toBe(reference.digest);
    expect(primary.runtimeVersion).toBe(reference.runtimeVersion);
  });

  test("reports drift when the primary install's content diverges from the reference", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "primary-content-drift");
    const home = join(root, "home");
    const destination = await installPrimary(home, source);
    await writeFile(join(destination, "extra-file.txt"), "stale copy tampering");
    const report = await installedRuntimeFreshness(reference, home);
    expect(report.drifted).toBe(true);
    const primary = report.roots.find((entry) => entry.kind === "primary")!;
    expect(primary.present).toBe(true);
    expect(primary.fresh).toBe(false);
    expect(primary.issue).toContain("disagrees with the running source");
  });

  test("reports drift when an installed root's runtime version diverges from the reference", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "primary-version-drift");
    const home = join(root, "home");
    const destination = await installPrimary(home, source);
    await writeFile(
      join(destination, "scripts", "src", "config", "constants.ts"),
      'export const RUNTIME_VERSION = "9.9.9";\n',
    );
    const report = await installedRuntimeFreshness(reference, home);
    const primary = report.roots.find((entry) => entry.kind === "primary")!;
    expect(primary.fresh).toBe(false);
    expect(primary.runtimeVersion).toBe("9.9.9");
  });

  test("follows a client symlink to the primary install and reports it fresh", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "claude-symlink-fresh");
    const home = join(root, "home");
    await installPrimary(home, source);
    await symlinkClient(home, "claude");
    const report = await installedRuntimeFreshness(reference, home);
    expect(report.drifted).toBe(false);
    const claude = report.roots.find((entry) => entry.kind === "claude")!;
    expect(claude.present).toBe(true);
    expect(claude.fresh).toBe(true);
    expect(claude.resolvedPath).toBe(await realpath(primaryPath(home)));
  });

  test("flags an install root that is an independent stale copy rather than a symlink", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "antigravity-independent-stale");
    const home = join(root, "home");
    await installPrimary(home, source);
    await symlinkClient(home, "claude");
    const staleSource = join(root, "stale-source");
    await cp(source, staleSource, { recursive: true });
    await writeFile(
      join(staleSource, "scripts", "src", "config", "constants.ts"),
      'export const RUNTIME_VERSION = "0.0.1";\n',
    );
    await installIndependentCopy(clientLinkPaths(home).antigravity, staleSource);
    const report = await installedRuntimeFreshness(reference, home);
    expect(report.drifted).toBe(true);
    expect(report.roots.find((entry) => entry.kind === "claude")!.fresh).toBe(true);
    const antigravity = report.roots.find((entry) => entry.kind === "antigravity")!;
    expect(antigravity.present).toBe(true);
    expect(antigravity.fresh).toBe(false);
    expect(antigravity.runtimeVersion).toBe("0.0.1");
  });

  test("treats a docs-only install (no scripts/ tree) as present but unfresh, not a crash", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "docs-only-install");
    const home = join(root, "home");
    const path = clientLinkPaths(home).claude;
    await mkdir(path, { recursive: true });
    await cp(join(source, "SKILL.md"), join(path, "SKILL.md"));
    const report = await installedRuntimeFreshness(reference, home);
    const claude = report.roots.find((entry) => entry.kind === "claude")!;
    expect(claude.present).toBe(true);
    expect(claude.fresh).toBe(false);
    expect(claude.digest).toBeNull();
    expect(claude.runtimeVersion).toBeNull();
    expect(claude.issue).not.toBeNull();
  });

  test("treats a dangling client symlink as present but unfresh rather than throwing", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    const root = scratchRoot(import.meta.path, "dangling-symlink");
    const home = join(root, "home");
    await installPrimary(home, source);
    const path = clientLinkPaths(home).antigravity;
    await mkdir(dirname(path), { recursive: true });
    await symlink(join(root, "nowhere"), path, "dir");
    const report = await installedRuntimeFreshness(reference, home);
    const antigravity = report.roots.find((entry) => entry.kind === "antigravity")!;
    expect(antigravity.present).toBe(true);
    expect(antigravity.fresh).toBe(false);
    expect(antigravity.digest).toBeNull();
  });

  test("defaults home to the OS home directory when omitted", async () => {
    const { source } = await installerFixture();
    const reference = await validateSkillSource(source);
    await expect(installedRuntimeFreshness(reference)).resolves.toBeDefined();
  });
});

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
