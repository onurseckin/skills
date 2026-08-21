import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { clientLinkPaths } from "../../../orchestrating-long-tasks/scripts/src/installer/client-links.ts";
import { SKILL_NAME } from "../../../orchestrating-long-tasks/scripts/src/installer/constants.ts";
import { installationStatus } from "../../../orchestrating-long-tasks/scripts/src/installer/installation-status.ts";
import { sealInstallationManifest } from "../../../orchestrating-long-tasks/scripts/src/installer/manifest-integrity.ts";
import { treeDigest } from "../../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { validateSkillSource } from "../../../orchestrating-long-tasks/scripts/src/installer/source-validation.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

async function installRealRelease(
  source: string,
  home: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const validated = await validateSkillSource(source);
  const destination = join(home, ".agents", "skills", SKILL_NAME);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
  const digest = await treeDigest(destination, new Set(["installation.json"]));
  const sealed = sealInstallationManifest({
    schema: "harness.installation",
    version: 1,
    skill_name: SKILL_NAME,
    runtime_version: validated.runtimeVersion,
    source_sha256: digest,
    installed_at: "2026-01-01T00:00:00.000Z",
    clients: ["claude"],
    ...overrides,
  });
  await writeFile(join(destination, "installation.json"), canonicalJsonBytes(sealed));
  return destination;
}

describe("installationStatus", () => {
  test("reports not installed when the destination does not exist", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "not-installed");
    const home = join(root, "home");
    mkdirSync(home);
    const status = await installationStatus(source, home);
    expect(status.installed).toBe(false);
    expect(status.drifted).toBe(true);
    expect(status.issues).toContain("not installed");
  });

  test("tolerates a home directory that does not exist yet", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "home-missing");
    const status = await installationStatus(source, join(root, "does-not-exist"));
    expect(status.installed).toBe(false);
    expect(status.issues).toContain("not installed");
  });

  test("reports a missing manifest when the destination exists without installation.json", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "missing-manifest");
    const home = join(root, "home");
    const destination = join(home, ".agents", "skills", SKILL_NAME);
    await mkdir(destination, { recursive: true });
    const status = await installationStatus(source, home);
    expect(status.installed).toBe(true);
    expect(status.issues).toContain("installation manifest is missing, invalid, or untrusted");
  });

  test("reports a clean, non-drifted install when content and manifest agree", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "clean-install");
    const home = join(root, "home");
    await installRealRelease(source, home);
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.installed).toBe(true);
    expect(status.issues).not.toContain("installed release has drifted");
  });

  test("reports drift when the installed content no longer matches the source digest", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "content-drift");
    const home = join(root, "home");
    const destination = await installRealRelease(source, home);
    await writeFile(join(destination, "extra-file.txt"), "tampered");
    const status = await installationStatus(source, home);
    expect(status.issues).toContain("installed release has drifted");
  });

  test("treats an installed tree that fails digesting outright (e.g. contains a symlink) as drifted", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "digest-throws");
    const home = join(root, "home");
    const destination = await installRealRelease(source, home);
    symlinkSync(destination, join(destination, "self-link"));
    const status = await installationStatus(source, home);
    expect(status.installed).toBe(true);
    expect(status.issues).toContain("installed release has drifted");
  });

  test("reports drift when the manifest's own digest disagrees with the source", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "manifest-digest-drift");
    const home = join(root, "home");
    await installRealRelease(source, home, { source_sha256: "0".repeat(64) });
    const status = await installationStatus(source, home);
    expect(status.issues).toContain("installed release has drifted");
  });

  test("reports drift when the manifest's runtime version disagrees with the source", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "runtime-version-drift");
    const home = join(root, "home");
    await installRealRelease(source, home, { runtime_version: "9.9.9" });
    const status = await installationStatus(source, home);
    expect(status.issues).toContain("installed release has drifted");
  });

  test("flags an unknown requested client name", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "unknown-client");
    const home = join(root, "home");
    await installRealRelease(source, home);
    const status = await installationStatus(source, home, ["not-a-real-client"]);
    expect(status.issues).toContain("unknown requested client");
  });

  test("falls back to the manifest's own client list when none is requested", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "manifest-clients-fallback");
    const home = join(root, "home");
    await installRealRelease(source, home, { clients: ["antigravity"] });
    const status = await installationStatus(source, home);
    expect(status.links.antigravity).toBe(null);
    expect(status.issues).toContain("antigravity link is missing");
  });

  test("client link missing reports 'link is missing'", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "link-missing");
    const home = join(root, "home");
    await installRealRelease(source, home);
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.links.claude).toBe(null);
    expect(status.issues).toContain("claude link is missing");
  });

  test("client link that is a plain file (not a symlink) reports 'not a symlink'", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "link-not-symlink");
    const home = join(root, "home");
    await installRealRelease(source, home);
    const linkPath = clientLinkPaths(home).claude;
    await mkdir(dirname(linkPath), { recursive: true });
    writeFileSync(linkPath, "not a symlink");
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.links.claude).toBe(null);
    expect(status.issues).toContain("claude client path is not a symlink");
  });

  test("client symlink pointing at the wrong target reports 'wrong target'", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "link-wrong-target");
    const home = join(root, "home");
    const destination = await installRealRelease(source, home);
    const linkPath = clientLinkPaths(home).claude;
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(destination, join(dirname(linkPath), "decoy"));
    await symlink(join(dirname(linkPath), "decoy"), linkPath, "dir");
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.issues).toContain("claude link has wrong target");
  });

  test("client symlink pointing at a real, matching destination is clean", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "link-clean");
    const home = join(root, "home");
    const destination = await installRealRelease(source, home);
    const linkPath = clientLinkPaths(home).claude;
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(destination, linkPath, "dir");
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.links.claude).toBe(destination);
    expect(status.issues.some((issue) => issue.startsWith("claude"))).toBe(false);
  });

  test("client symlink pointing at the right target string that no longer resolves reports 'broken'", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "link-broken");
    const home = join(root, "home");
    // Deliberately never materialize the real skill destination: the symlink's target text still
    // matches the destination installationStatus computes, so it clears the "wrong target" check,
    // but resolving that target on disk fails, which is exactly the "broken" branch.
    const destination = join(home, ".agents", "skills", SKILL_NAME);
    const linkPath = clientLinkPaths(home).claude;
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(destination, linkPath, "dir");
    const status = await installationStatus(source, home, ["claude"]);
    expect(status.links.claude).toBe(destination);
    expect(status.issues).toContain("claude link is broken");
    expect(status.issues).not.toContain("claude link has wrong target");
  });

  test("codex and chatgpt clients record the destination without any filesystem check", async () => {
    const { source } = await installerFixture();
    const root = scratchRoot(import.meta.path, "codex-chatgpt");
    const home = join(root, "home");
    const destination = await installRealRelease(source, home, { clients: ["chatgpt", "codex"] });
    const status = await installationStatus(source, home, ["codex", "chatgpt"]);
    expect(status.links.codex).toBe(destination);
    expect(status.links.chatgpt).toBe(destination);
    expect(status.issues).not.toContain("codex link is missing");
  });
});
