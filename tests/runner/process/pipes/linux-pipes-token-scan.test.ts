import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import {
  OWNERSHIP_ENV,
  linuxTokenOwnerIdentities,
} from "../../../../olt/scripts/src/engine/runner/process/linux-pipes.ts";
import {
  chmodVirtualFile,
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

describe("linuxTokenOwnerIdentities against a fixture procfs", () => {
  test("returns immediately for an empty token without scanning", async () => {
    const root = await fakeProc("token-empty");
    expect(linuxTokenOwnerIdentities("", root)).toEqual([]);
  });

  test("matches a live process whose environment carries the ownership token", async () => {
    const root = await fakeProc("token-match");
    const marker = `FOO=bar\0${OWNERSHIP_ENV}=secret-token\0BAZ=qux\0`;
    await makeProcess(root, 4008, { parent: 1, group: 4008, birth: "1000", environ: marker });

    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([
      { pid: 4008, parent: 1, group: 4008, birth: "1000" },
    ]);
  });

  test("excludes a live process whose environment lacks the ownership token", async () => {
    const root = await fakeProc("token-nomatch");
    await makeProcess(root, 4009, { parent: 1, group: 4009, birth: "1000", environ: "FOO=bar\0" });

    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("skips a pid that owns no stat file, even though it passes the ownership check", () => {
    const root = fakeProc("token-nostat");
    const vfs = getRunnerVfs();
    const dir = join(root, "4010");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "environ"), `${OWNERSHIP_ENV}=secret-token\0`);

    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("skips a pid that vanished before its ownership could be confirmed", () => {
    const root = fakeProc("token-vanished");
    const vfs = getRunnerVfs();
    vfs.mkdirSync(join(root, "4012"), { recursive: true });
    vfs.rmSync(join(root, "4012"), { recursive: true });

    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("never reports the scanning process itself even if it carries the token", () => {
    const root = fakeProc("token-self");
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    makeProcess(root, process.pid, { group: process.pid, birth: "1000", environ: marker });

    expect(linuxTokenOwnerIdentities("secret-token", root)).toEqual([]);
  });

  test("rethrows the same error when the environment scan exceeds the per-process budget", () => {
    const root = fakeProc("token-environ-too-large");
    const giant = Buffer.allocUnsafe(4 * 1024 * 1024 + 1);
    makeProcess(root, 4013, { group: 4013, birth: "1000", environ: giant });

    expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
      /environment scan is too large/,
    );
  });

  test("wraps a non-harness read failure as an inspection error", () => {
    const root = fakeProc("token-environ-is-dir");
    const vfs = getRunnerVfs();
    const dir = join(root, "4011");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "stat"), statLine(4011, 1, 4011, "1000"));
    vfs.mkdirSync(join(dir, "environ"), { recursive: true });
    expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
      /cannot inspect ownership token/,
    );
  });

  test("throws cannot determine process ownership when statSync fails with EACCES", () => {
    const root = fakeProc("token-sameuser-eacces");
    const vfs = getRunnerVfs();
    const sub = join(root, "sub");
    vfs.mkdirSync(sub, { recursive: true });
    vfs.writeFileSync(join(sub, "target"), "target");
    createVirtualSymlink(join(sub, "target"), join(root, "4019"));
    chmodVirtualFile(sub, 0o000);
    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "cannot determine process ownership during token scan for pid 4019",
      );
    } finally {
      chmodVirtualFile(sub, 0o755);
    }
  });

  test("detects process identity change after reading environment", () => {
    const root = fakeProc("token-identity-change");
    const vfs = getRunnerVfs();
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    makeProcess(root, 4020, { group: 4020, birth: "1000", environ: marker });

    const origAlloc = Buffer.allocUnsafe;
    let hooked = false;
    Buffer.allocUnsafe = function (size: number) {
      if (!hooked) {
        hooked = true;
        vfs.writeFileSync(join(root, "4020", "stat"), statLine(4020, 1, 4020, "2000"));
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

  test("detects process identity change when reading environment throws", () => {
    const root = fakeProc("token-identity-change-on-throw");
    const vfs = getRunnerVfs();
    const marker = `${OWNERSHIP_ENV}=secret-token\0`;
    makeProcess(root, 4021, { group: 4021, birth: "1000", environ: marker });

    const origAlloc = Buffer.allocUnsafe;
    let hooked = false;
    Buffer.allocUnsafe = function (_size: number) {
      if (!hooked) {
        hooked = true;
        vfs.writeFileSync(join(root, "4021", "stat"), statLine(4021, 1, 4021, "2000"));
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

  test("throws cannot enumerate processes when readdirSync fails", () => {
    const root = fakeProc("token-file-not-dir");
    const vfs = getRunnerVfs();
    const filePath = join(root, "file.txt");
    vfs.writeFileSync(filePath, "test");
    expect(() => linuxTokenOwnerIdentities("secret-token", filePath)).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
  });

  test("throws ownership-token process scan is too large when process count exceeds cap", () => {
    const root = fakeProc("token-too-many-pids");
    const vfs = getRunnerVfs();
    const oversizedPids = Object.assign(Array.from({ length: 65537 }), {
      filter: () => oversizedPids,
      map: () => oversizedPids,
    });
    const origReaddir = vfs.readdirSync.bind(vfs);
    const spy = spyOn(vfs, "readdirSync").mockImplementation(((p: string, opts?: unknown) => {
      if (p === root || p.replace(/\\/g, "/").includes("token-too-many-pids")) {
        return oversizedPids as unknown as ReturnType<typeof vfs.readdirSync>;
      }
      return origReaddir(p, opts as never);
    }) as never);
    try {
      expect(() => linuxTokenOwnerIdentities("secret-token", root)).toThrow(
        "ownership-token process scan is too large",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
