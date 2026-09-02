import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as childProcess from "node:child_process";
import * as fsp from "node:fs/promises";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import * as nativeRename from "../../olt/scripts/src/installer/native-rename.ts";
import * as platform from "../../olt/scripts/src/platform/index.ts";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Virtual FS Spies - Async & Process Spies", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual", { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("handles fsp.mkdtemp, mkdir, writeFile, readFile, readdir, stat, lstat, rm, unlink", async () => {
    const tmp = await fsp.mkdtemp("/virtual/async-tmp-");
    expect(tmp.startsWith("/virtual/async-tmp-")).toBe(true);

    await fsp.mkdir(`${tmp}/nested/dir`, { recursive: true });
    await fsp.writeFile(`${tmp}/nested/dir/file.txt`, "async-data");
    const content = await fsp.readFile(`${tmp}/nested/dir/file.txt`, "utf8");
    expect(content).toBe("async-data");

    const entries = await fsp.readdir(`${tmp}/nested`);
    expect(entries).toContain("dir");

    const st = await fsp.stat(`${tmp}/nested/dir/file.txt`);
    expect(st.size).toBe(10);
    const lst = await fsp.lstat(`${tmp}/nested/dir/file.txt`);
    expect(lst.isFile()).toBe(true);

    await fsp.unlink(`${tmp}/nested/dir/file.txt`);
    expect(vfs.existsSync(`${tmp}/nested/dir/file.txt`)).toBe(false);

    await fsp.rm(`${tmp}`, { recursive: true, force: true });
    expect(vfs.existsSync(tmp)).toBe(false);
  });

  it("handles fsp.cp, rename, chmod, symlink, link, readlink, realpath", async () => {
    await fsp.writeFile("/virtual/source.txt", "payload");
    await fsp.cp("/virtual/source.txt", "/virtual/copied.txt");
    expect(await fsp.readFile("/virtual/copied.txt", "utf8")).toBe("payload");

    await fsp.rename("/virtual/copied.txt", "/virtual/renamed.txt");
    expect(vfs.existsSync("/virtual/copied.txt")).toBe(false);
    expect(await fsp.readFile("/virtual/renamed.txt", "utf8")).toBe("payload");

    await fsp.chmod("/virtual/renamed.txt", 0o600);
    expect((await fsp.stat("/virtual/renamed.txt")).mode & 0o777).toBe(0o600);

    await fsp.symlink("/virtual/renamed.txt", "/virtual/async-link.txt");
    expect(await fsp.readlink("/virtual/async-link.txt")).toBe("/virtual/renamed.txt");
    const buf = await fsp.readlink("/virtual/async-link.txt", "buffer");
    expect(Buffer.isBuffer(buf)).toBe(true);

    await fsp.link("/virtual/renamed.txt", "/virtual/hard-link.txt");
    expect(vfs.existsSync("/virtual/hard-link.txt")).toBe(true);

    expect(await fsp.realpath("/virtual/async-link.txt")).toBe("/virtual/async-link.txt");
    await expect(fsp.realpath("/virtual/nonexistent-path-999")).rejects.toThrow();
  });

  it("handles fsp.truncate expanding and shrinking file contents", async () => {
    await fsp.writeFile("/virtual/trunc.txt", "0123456789");
    await fsp.truncate("/virtual/trunc.txt", 5);
    expect(await fsp.readFile("/virtual/trunc.txt", "utf8")).toBe("01234");

    await fsp.truncate("/virtual/trunc.txt", 8);
    const expanded = await fsp.readFile("/virtual/trunc.txt");
    expect(expanded.length).toBe(8);

    await fsp.truncate("/virtual/trunc.txt", 8);
    expect((await fsp.readFile("/virtual/trunc.txt")).length).toBe(8);
  });

  it("handles fsp.open FileHandle complete lifecycle and methods", async () => {
    await fsp.writeFile("/virtual/handle-test.txt", "hello-handle");
    const handle = await fsp.open("/virtual/handle-test.txt", "r+", 0o644);
    expect(handle.fd).toBeGreaterThanOrEqual(3000);

    const st = await handle.stat();
    expect(st.size).toBe(12);

    const readBuf = Buffer.alloc(5);
    const readRes = await handle.read(readBuf, 0, 5, 0);
    expect(readRes.bytesRead).toBe(5);
    expect(readBuf.toString()).toBe("hello");

    const writeRes = await handle.write("WORLD", 0, 5, 0);
    expect(writeRes.bytesWritten).toBe(5);

    await handle.truncate(5);
    expect(await fsp.readFile("/virtual/handle-test.txt", "utf8")).toBe("WORLD");

    await handle.chmod(0o700);
    await handle.sync();
    await handle.datasync();
    await handle.close();
  });

  it("mocks platform exclusive flock functions", () => {
    expect(platform.tryExclusiveFlock(1)).toBe(true);
    expect(() => platform.releaseFlock(1)).not.toThrow();
  });

  it("mocks child_process execFileSync, execSync, and execFile", async () => {
    const outFileSync = childProcess.execFileSync("git", ["status"]);
    expect(outFileSync.toString()).toBe("main\n");

    const outSync = childProcess.execSync("git branch");
    expect(outSync.toString()).toBe("main\n");

    const psOut = await new Promise<string>((resolve, reject) => {
      childProcess.execFile("ps", ["-ef"], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    expect(psOut).toContain(`${process.pid}`);

    const gitOut = await new Promise<string>((resolve, reject) => {
      childProcess.execFile("git", ["rev-parse", "HEAD"], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    expect(gitOut).toBe("main\n");
  });

  it("mocks Bun.spawn commands and exit codes", async () => {
    const echoProc = Bun.spawn({ cmd: ["echo", "hello", "world"] });
    expect(echoProc.pid).toBe(999999);
    const echoText = await new Response(echoProc.stdout).text();
    expect(echoText.trim()).toBe("hello world");
    expect(await echoProc.exited).toBe(0);

    const psProc = Bun.spawn({ cmd: ["ps"] });
    const psText = await new Response(psProc.stdout).text();
    expect(psText).toContain(`${process.pid}`);

    const sleepProc = Bun.spawn({ cmd: ["sleep", "10"] });
    sleepProc.ref();
    sleepProc.unref();
    sleepProc.kill();
    expect(await sleepProc.exited).toBe(143);
  });

  it("mocks nativeRename.renameNoReplace and nativeRename.exchangePaths", () => {
    vfs.writeFileSync("/virtual/rn1.txt", "file 1");
    vfs.writeFileSync("/virtual/rn2.txt", "file 2");

    expect(() =>
      nativeRename.renameNoReplace("/virtual/rn1.txt", "/virtual/rn2.txt", "LABEL"),
    ).toThrow(HarnessError);

    expect(() =>
      nativeRename.renameNoReplace("/virtual/missing.txt", "/virtual/rn3.txt", "LABEL"),
    ).toThrow(HarnessError);

    nativeRename.renameNoReplace("/virtual/rn1.txt", "/virtual/rn3.txt", "LABEL");
    expect(vfs.existsSync("/virtual/rn3.txt")).toBe(true);
    expect(vfs.existsSync("/virtual/rn1.txt")).toBe(false);

    nativeRename.exchangePaths("/virtual/rn2.txt", "/virtual/rn3.txt", "EXCHANGE");
    expect(vfs.readFileSync("/virtual/rn2.txt", "utf8")).toBe("file 1");
    expect(vfs.readFileSync("/virtual/rn3.txt", "utf8")).toBe("file 2");

    expect(() =>
      nativeRename.exchangePaths("/virtual/missing.txt", "/virtual/rn2.txt", "EXCHANGE"),
    ).toThrow(HarnessError);
  });

  it("mocks process.cwd and process.chdir bound to virtual fs state", () => {
    expect(process.cwd()).toBe("/");
    vfs.mkdirSync("/virtual/dir-x", { recursive: true });
    process.chdir("/virtual/dir-x");
    expect(process.cwd()).toBe("/virtual/dir-x");
    process.chdir("/");
    expect(process.cwd()).toBe("/");
  });
});
