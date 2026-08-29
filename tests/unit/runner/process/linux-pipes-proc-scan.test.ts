import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OWNERSHIP_ENV,
  linuxPipeHandles,
  linuxPipeOwners,
  linuxProcessIdentity,
  linuxTokenOwnerIdentities,
  parseLinuxProcessIdentity,
} from "../../../../olt/scripts/src/engine/runner/process/linux-pipes.ts";

/**
 * There is no real /proc on this platform (or in CI generally), and the production code only
 * ever calls these functions when `process.platform === "linux"`. `root` is an injected seam
 * (default "/proc", unused by any production call site) so these tests can point the scan at a
 * fixture directory shaped like a procfs, without changing behaviour for the real Linux path.
 */
const roots: string[] = [];

async function fakeProc(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  roots.push(root);
  return root;
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

async function makeProcess(
  root: string,
  pid: number,
  options: { parent?: number; group?: number; birth?: string; environ?: Buffer | string } = {},
): Promise<void> {
  const dir = join(root, String(pid));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "stat"),
    statLine(pid, options.parent ?? 1, options.group ?? pid, options.birth ?? "1000"),
  );
  if (options.environ !== undefined) await writeFile(join(dir, "environ"), options.environ);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
    const fields = ["S", "1", "1", ...Array(16).fill("0"), "not-a-number"];
    expect(parseLinuxProcessIdentity(`40 (name) ${fields.join(" ")}`, 40)).toBeUndefined();
  });
});

describe("linuxPipeHandles against a fixture procfs", () => {
  test("collects pipe inode numbers and ignores non-pipe descriptors", async () => {
    const root = await fakeProc("pipe-handles");
    const fdDir = join(root, "4003", "fd");
    await mkdir(fdDir, { recursive: true });
    await symlink("pipe:[9001]", join(fdDir, "0"));
    await symlink("pipe:[9002]", join(fdDir, "1"));
    await symlink("socket:[7]", join(fdDir, "2"));
    await writeFile(join(fdDir, "3"), "not a symlink");
    expect(linuxPipeHandles(4003, root)).toEqual(new Set([9001n, 9002n]));
  });

  test("returns an empty set when the process has no fd directory", async () => {
    const root = await fakeProc("pipe-handles-missing");
    expect(linuxPipeHandles(4004, root)).toEqual(new Set());
  });
});

describe("linuxPipeOwners against a fixture procfs", () => {
  test("returns only pids whose fds touch one of the anchor inodes", async () => {
    const root = await fakeProc("pipe-owners");
    await makeProcess(root, 4005);
    await mkdir(join(root, "4005", "fd"), { recursive: true });
    await symlink("pipe:[8001]", join(root, "4005", "fd", "0"));
    await makeProcess(root, 4006);
    await mkdir(join(root, "4006", "fd"), { recursive: true });
    await symlink("pipe:[8002]", join(root, "4006", "fd", "0"));
    expect(linuxPipeOwners(new Set([8001n]), root)).toEqual(new Set([4005]));
  });

  test("never reports the scanning process itself even if its name collides", async () => {
    const root = await fakeProc("pipe-owners-self");
    const own = String(process.pid);
    await mkdir(join(root, own, "fd"), { recursive: true });
    await symlink("pipe:[8003]", join(root, own, "fd", "0"));
    expect(linuxPipeOwners(new Set([8003n]), root)).toEqual(new Set());
  });
});

describe("linuxTokenOwnerIdentities against a fixture procfs", () => {
  test("returns immediately for an empty token without scanning", () => {
    expect(linuxTokenOwnerIdentities("", "/does/not/exist")).toEqual([]);
  });

  test("matches a live process whose environment carries the ownership token", async () => {
    const root = await fakeProc("token-match");
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    await makeProcess(root, 4007, { group: 4007, birth: "77777", environ: `PATH=/bin\0${marker}` });
    const owners = linuxTokenOwnerIdentities("secret-token", root);
    expect(owners).toEqual([{ pid: 4007, parent: 1, group: 4007, birth: "77777" }]);
  });

  test("excludes a live process whose environment lacks the ownership token", async () => {
    const root = await fakeProc("token-no-match");
    await makeProcess(root, 4008, { environ: "PATH=/bin\0OTHER=1\0" });
    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("skips a pid that owns no stat file, even though it passes the ownership check", async () => {
    const root = await fakeProc("token-skip-no-stat");
    // "4009" enumerates as a pid and statSync succeeds on it (a plain file we own), so ownership
    // passes; but `${root}/4009/stat` has a non-directory path component, so linuxProcessIdentity
    // throws internally and returns undefined, which must skip the pid rather than crash the scan.
    await writeFile(join(root, "4009"), "a file, not a process directory");
    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("skips a pid that vanished before its ownership could be confirmed", async () => {
    const root = await fakeProc("token-skip-vanished");
    // A dangling symlink named "4013" is a real directory entry (so processIds enumerates it),
    // but statSync follows the link to a target that no longer exists, so sameUser reports
    // `undefined` rather than `true`/`false` and the scan must skip it, not throw.
    await symlink("/does/not/exist/4013", join(root, "4013"));
    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("never reports the scanning process itself even if it carries the token", async () => {
    const root = await fakeProc("token-self");
    const own = String(process.pid);
    await makeProcess(root, Number(own), {
      environ: `${OWNERSHIP_ENV}=secret-token\0`,
    });
    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("rethrows the same error when the environment scan exceeds the per-process budget", async () => {
    const root = await fakeProc("token-budget");
    const oversized = Buffer.alloc(4 * 1024 * 1024 + 1024, 0);
    await makeProcess(root, 4010, { group: 4010, birth: "99999", environ: oversized });
    expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
      /environment scan is too large/,
    );
  });

  test("wraps a non-harness read failure as an inspection error", async () => {
    const root = await fakeProc("token-environ-is-dir");
    const dir = join(root, "4011");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "stat"), statLine(4011, 1, 4011, "1000"));
    // Make environ a directory instead of a file: openSync succeeds (directories are openable
    // read-only on POSIX) but readSync on a directory fd raises a plain EISDIR, not a HarnessError.
    await mkdir(join(dir, "environ"), { recursive: true });
    expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
      /cannot inspect ownership token/,
    );
  });

  test("throws cannot determine process ownership when statSync fails with EACCES", async () => {
    const root = await fakeProc("token-sameuser-eacces");
    const sub = join(root, "sub");
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, "target"), "target");
    await symlink(join(sub, "target"), join(root, "4019"));
    const { chmod } = await import("node:fs/promises");
    await chmod(sub, 0o000);
    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "cannot determine process ownership during token scan for pid 4019",
      );
    } finally {
      await chmod(sub, 0o755);
    }
  });

  test("detects process identity change after reading environment", async () => {
    const root = await fakeProc("token-identity-change");
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    await makeProcess(root, 4020, { group: 4020, birth: "1000", environ: marker });

    const origAlloc = Buffer.allocUnsafe;
    let hooked = false;
    Buffer.allocUnsafe = function (size: number) {
      if (!hooked) {
        hooked = true;
        const { writeFileSync } = require("node:fs");
        writeFileSync(join(root, "4020", "stat"), statLine(4020, 1, 4020, "2000"));
      }
      return origAlloc.call(Buffer, size);
    };

    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "process identity changed during ownership-token scan for pid 4020",
      );
    } finally {
      Buffer.allocUnsafe = origAlloc;
    }
  });

  test("detects process identity change when reading environment throws", async () => {
    const root = await fakeProc("token-identity-change-on-throw");
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    await makeProcess(root, 4021, { group: 4021, birth: "1000", environ: marker });

    const origAlloc = Buffer.allocUnsafe;
    let hooked = false;
    Buffer.allocUnsafe = function (_size: number) {
      if (!hooked) {
        hooked = true;
        const { writeFileSync } = require("node:fs");
        writeFileSync(join(root, "4021", "stat"), statLine(4021, 1, 4021, "2000"));
        throw new Error("read error");
      }
      return origAlloc.call(Buffer, _size);
    };

    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "process identity changed during ownership-token scan for pid 4021",
      );
    } finally {
      Buffer.allocUnsafe = origAlloc;
    }
  });

  test("throws cannot enumerate processes when readdirSync fails", async () => {
    const root = await fakeProc("token-file-not-dir");
    const filePath = join(root, "file.txt");
    await writeFile(filePath, "test");
    expect(() => linuxTokenOwnerIdentities("secret-token", filePath)).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
  });

  test("throws ownership-token process scan is too large when process count exceeds cap", async () => {
    const root = await fakeProc("token-too-many-pids");
    const fs = await import("node:fs");
    const oversizedPids = Array.from({ length: 65537 }, (_, i) => String(i + 1));
    const spy = spyOn(fs, "readdirSync").mockImplementation((path) => {
      if (path === root) {
        return oversizedPids as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return spy.getMockImplementation()?.(path) ?? [];
    });
    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "ownership-token process scan is too large",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
