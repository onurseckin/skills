import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readlink, symlink } from "node:fs/promises";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  applyClientLinks,
  clientLinkPaths,
  preflightClientLinks,
  type ClientLinkPlan,
} from "../../../olt/scripts/src/installer/client-links.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { cleanInstallerFixtures } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("clientLinkPaths", () => {
  test("builds the claude and antigravity link paths under home", () => {
    const paths = clientLinkPaths("/home/user");
    expect(paths.claude).toBe(join("/home/user", ".claude", "skills", "olt"));
    expect(paths.antigravity).toBe(join("/home/user", ".gemini", "config", "skills", "olt"));
  });
});

describe("preflightClientLinks", () => {
  test("returns no plans when no clients are requested", async () => {
    const root = scratchRoot(import.meta.path, "preflight-none");
    const plans = await preflightClientLinks(root, join(root, "target"), new Set());
    expect(plans).toEqual([]);
  });

  test("returns a plan with previous=null when no link exists yet", async () => {
    const root = scratchRoot(import.meta.path, "preflight-fresh");
    const target = join(root, "target");
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.client).toBe("claude");
    expect(plans[0]?.previous).toBeNull();
  });

  test("captures a snapshot of an existing symlink as previous", async () => {
    const root = scratchRoot(import.meta.path, "preflight-existing");
    const target = join(root, "target");
    const oldTarget = join(root, "old-target");
    const linkPath = clientLinkPaths(root).claude;
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(oldTarget, linkPath, "dir");
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    expect(plans[0]?.previous?.target).toBe(oldTarget);
  });

  test("preflights both claude and antigravity when both are requested, in that order", async () => {
    const root = scratchRoot(import.meta.path, "preflight-both");
    const plans = await preflightClientLinks(
      root,
      join(root, "target"),
      new Set(["antigravity", "claude"]),
    );
    expect(plans.map((plan) => plan.client)).toEqual(["claude", "antigravity"]);
  });

  test("throws when the existing client path is not a symlink", async () => {
    const root = scratchRoot(import.meta.path, "preflight-not-symlink");
    const linkPath = clientLinkPaths(root).claude;
    mkdirSync(dirname(linkPath), { recursive: true });
    writeFileSync(linkPath, "not a symlink");
    await expect(
      preflightClientLinks(root, join(root, "target"), new Set(["claude"])),
    ).rejects.toBeInstanceOf(HarnessError);
  });
});

describe("applyClientLinks: fresh install (no previous link)", () => {
  test("creates the symlink, calls beforePublish, and reports the applied paths", async () => {
    const root = scratchRoot(import.meta.path, "apply-fresh");
    const target = join(root, "target");
    mkdirSync(target);
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    let hookPlan: ClientLinkPlan | undefined;
    const applied = await applyClientLinks(plans, {
      beforePublish(plan) {
        hookPlan = plan;
      },
    });
    expect(hookPlan?.client).toBe("claude");
    expect(applied.paths).toEqual(plans.map((plan) => plan.path));
    expect(await readlink(clientLinkPaths(root).claude)).toBe(target);
  });

  test("rollback() removes a freshly created link", async () => {
    const root = scratchRoot(import.meta.path, "apply-fresh-rollback");
    const target = join(root, "target");
    mkdirSync(target);
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    const applied = await applyClientLinks(plans);
    expect(await pathIdentity(clientLinkPaths(root).claude)).not.toBeNull();
    await applied.rollback();
    expect(await pathIdentity(clientLinkPaths(root).claude)).toBeNull();
  });
});

describe("applyClientLinks: replacing an existing link", () => {
  async function setupExistingLink(label: string) {
    const root = scratchRoot(import.meta.path, label);
    const target = join(root, "target");
    const oldTarget = join(root, "old-target");
    mkdirSync(target);
    mkdirSync(oldTarget);
    const linkPath = clientLinkPaths(root).claude;
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(oldTarget, linkPath, "dir");
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    return { root, target, oldTarget, linkPath, plans };
  }

  test("replaces the link to point at the new target", async () => {
    const { target, linkPath, plans } = await setupExistingLink("apply-replace");
    await applyClientLinks(plans);
    expect(await readlink(linkPath)).toBe(target);
  });

  test("is a no-op when the existing link already points at the requested target", async () => {
    const root = scratchRoot(import.meta.path, "apply-noop");
    const target = join(root, "target");
    mkdirSync(target);
    const linkPath = clientLinkPaths(root).claude;
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath, "dir");
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    let hookCalled = false;
    const applied = await applyClientLinks(plans, {
      beforePublish() {
        hookCalled = true;
      },
    });
    expect(hookCalled).toBe(false);
    expect(applied.paths).toEqual(plans.map((plan) => plan.path));
    // rollback() on a no-op application (nothing was actually applied) must be a safe no-op too.
    await expect(applied.rollback()).resolves.toBeUndefined();
    expect(await readlink(linkPath)).toBe(target);
  });

  test("rollback() restores the previous target after a successful replace", async () => {
    const { oldTarget, linkPath, plans } = await setupExistingLink("apply-replace-rollback");
    const applied = await applyClientLinks(plans);
    await applied.rollback();
    expect(await readlink(linkPath)).toBe(oldTarget);
  });
});

describe("applyClientLinks: race detection and recovery", () => {
  test("fails publication when the link changes underneath a fresh (previous=null) install, with nothing left behind", async () => {
    const root = scratchRoot(import.meta.path, "race-fresh");
    const target = join(root, "target");
    const decoyTarget = join(root, "decoy-target");
    mkdirSync(target);
    mkdirSync(decoyTarget);
    const linkPath = clientLinkPaths(root).claude;
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    await expect(
      applyClientLinks(plans, {
        beforePublish() {
          mkdirSync(dirname(linkPath), { recursive: true });
          symlinkSync(decoyTarget, linkPath, "dir");
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);
    // The decoy the hook planted is left in place; publish() never removed it because it didn't
    // create it, and there was no earlier temporary link to clean up on this (previous=null) path.
    expect(await readlink(linkPath)).toBe(decoyTarget);
  });

  test("fails publication when the link changes underneath a replace (previous!=null), cleaning up its own temporary link", async () => {
    const root = scratchRoot(import.meta.path, "race-replace");
    const target = join(root, "target");
    const oldTarget = join(root, "old-target");
    mkdirSync(target);
    mkdirSync(oldTarget);
    const linkPath = clientLinkPaths(root).claude;
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(oldTarget, linkPath, "dir");
    const plans = await preflightClientLinks(root, target, new Set(["claude"]));
    const decoyTarget = dirname(linkPath);
    await expect(
      applyClientLinks(plans, {
        beforePublish() {
          rmSync(linkPath);
          symlinkSync(decoyTarget, linkPath, "dir");
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);
    expect(await readlink(linkPath)).toBe(decoyTarget);
  });

  test("rolls back an earlier successfully applied plan when a later plan fails", async () => {
    const root = scratchRoot(import.meta.path, "race-multi-plan-rollback");
    const target = join(root, "target");
    mkdirSync(target);
    const plans = await preflightClientLinks(root, target, new Set(["antigravity", "claude"]));
    const antigravityLink = clientLinkPaths(root).antigravity;
    await expect(
      applyClientLinks(plans, {
        beforePublish(plan) {
          if (plan.client === "claude") {
            const decoy = join(root, "decoy");
            mkdirSync(decoy, { recursive: true });
            symlinkSync(decoy, plan.path, "dir");
          }
        },
      }),
    ).rejects.toBeInstanceOf(HarnessError);
    // antigravity was published first and should have been rolled back (removed, since it had no
    // previous link) once claude's publish failed.
    expect(await pathIdentity(antigravityLink)).toBeNull();
  });
});
