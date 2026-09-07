import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  linuxPipeHandles,
  linuxPipeOwners,
  linuxProcessIdentity,
  parseLinuxProcessIdentity,
} from "../../../../olt/scripts/src/engine/runner/process/linux-pipes.ts";
import {
  cleanupTempRoots,
  createVirtualSymlink,
  getRunnerVfs,
  tempRoot,
} from "../../command/fixture.ts";

function fakeProc(label: string): string {
  return tempRoot(label);
}

function statLine(
  pid: number,
  parent: number,
  group: number,
  birth: string,
  comm = "name",
): string {
  const fields = ["S", String(parent), String(group), ...Array(16).fill("0"), birth];
  return `${pid} (${comm}) ${fields.join(" ")}`;
}

function makeProcess(
  root: string,
  pid: number,
  options: { parent?: number; group?: number; birth?: string; environ?: Buffer | string } = {},
): void {
  const vfs = getRunnerVfs();
  const dir = join(root, String(pid));
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(
    join(dir, "stat"),
    statLine(pid, options.parent ?? 1, options.group ?? pid, options.birth ?? "1000"),
  );
  if (options.environ !== undefined) vfs.writeFileSync(join(dir, "environ"), options.environ);
}

afterEach(cleanupTempRoots);

describe("linuxProcessIdentity against a fixture procfs", () => {
  test("parses a live process's stat file", async () => {
    const root = await fakeProc("identity-live");
    await makeProcess(root, 4001, { parent: 1, group: 4001, birth: "55555" });
    expect(linuxProcessIdentity(4001, root)).toEqual({
      pid: 4001,
      parent: 1,
      group: 4001,
      birth: "55555",
    });
  });

  test("returns undefined when the process has no stat file", async () => {
    const root = await fakeProc("identity-missing");
    expect(linuxProcessIdentity(4002, root)).toBeUndefined();
  });
});

describe("parseLinuxProcessIdentity edge cases", () => {
  test("rejects a stat line with no closing paren around comm", () => {
    expect(parseLinuxProcessIdentity("40 (unterminated S 1 1", 40)).toBeUndefined();
  });

  test("rejects a stat line whose birth field is not numeric", () => {
    expect(
      parseLinuxProcessIdentity("40 (name) S 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 not-a-number", 40),
    ).toBeUndefined();
  });
});

describe("linuxPipeHandles against a fixture procfs", () => {
  test("collects pipe inode numbers and ignores non-pipe descriptors", () => {
    const root = fakeProc("pipes-valid");
    const vfs = getRunnerVfs();
    const dir = join(root, "4003", "fd");
    vfs.mkdirSync(dir, { recursive: true });
    createVirtualSymlink("pipe:[12345]", join(dir, "0"));
    createVirtualSymlink("pipe:[67890]", join(dir, "1"));
    createVirtualSymlink("socket:[99999]", join(dir, "2"));
    createVirtualSymlink("/dev/null", join(dir, "3"));

    expect(linuxPipeHandles(4003, root)).toEqual(new Set([12345n, 67890n]));
  });

  test("returns an empty set when the process has no fd directory", () => {
    const root = fakeProc("pipes-missing");
    expect(linuxPipeHandles(4004, root)).toEqual(new Set());
  });
});

describe("linuxPipeOwners against a fixture procfs", () => {
  test("returns only pids whose fds touch one of the anchor inodes", () => {
    const root = fakeProc("pipe-owners");
    const vfs = getRunnerVfs();
    const pid1Fd = join(root, "4005", "fd");
    const pid2Fd = join(root, "4006", "fd");
    const pid3Fd = join(root, "4007", "fd");
    vfs.mkdirSync(pid1Fd, { recursive: true });
    vfs.mkdirSync(pid2Fd, { recursive: true });
    vfs.mkdirSync(pid3Fd, { recursive: true });
    createVirtualSymlink("pipe:[100]", join(pid1Fd, "0"));
    createVirtualSymlink("pipe:[200]", join(pid2Fd, "0"));
    createVirtualSymlink("pipe:[300]", join(pid3Fd, "0"));

    const anchors = new Set([100n, 300n]);
    expect(linuxPipeOwners(anchors, root)).toEqual(new Set([4005, 4007]));
  });

  test("never reports the scanning process itself even if its name collides", () => {
    const root = fakeProc("pipe-owners-self");
    const vfs = getRunnerVfs();
    const selfFd = join(root, String(process.pid), "fd");
    vfs.mkdirSync(selfFd, { recursive: true });
    createVirtualSymlink("pipe:[100]", join(selfFd, "0"));

    expect(linuxPipeOwners(new Set([100n]), root)).toEqual(new Set());
  });
});
