import { afterEach, describe, expect, test } from "bun:test";
import { O_NONBLOCK, O_NOFOLLOW } from "node:constants";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { captureGatePathBindings } from "../../../olt/scripts/src/engine/runner/signing/gate-path-bindings.ts";
import type { GatePathHooks } from "../../../olt/scripts/src/engine/runner/signing/gate-path-tree.ts";
import {
  getRunnerVfs,
  openVirtualFile,
  statVirtualFile,
  tempRoot,
  cleanupTempRoots,
} from "../command/fixture.ts";

afterEach(cleanupTempRoots);

function repository(): string {
  return tempRoot("gate-path-special");
}

function special(path: string): Stats {
  const s = statVirtualFile(path);
  return {
    ...s,
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => false,
  } as Stats;
}

describe("gate path special-file safety", () => {
  test("rejects a direct special repository operand before opening it", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    vfs.writeFileSync(join(root, "target"), "regular fixture\n");
    const target = join(root, "target");
    let opens = 0;
    const hooks: GatePathHooks = {
      lstatPath: (path) => (path === target ? special(path) : statVirtualFile(path)),
      openPath: (path, flags) => {
        opens += 1;
        return openVirtualFile(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./target"], undefined, hooks)).toThrow(
      /regular file or directory/i,
    );
    expect(opens).toBe(0);
  });

  test("rejects a nested special entry without opening that entry", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    vfs.mkdirSync(join(root, "suite"), { recursive: true });
    vfs.writeFileSync(join(root, "suite", "nested"), "regular fixture\n");
    const nested = join(root, "suite", "nested");
    const opened: string[] = [];
    const hooks: GatePathHooks = {
      lstatPath: (path) => (path === nested ? special(path) : statVirtualFile(path)),
      openPath: (path, flags) => {
        opened.push(path);
        return openVirtualFile(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./suite"], undefined, hooks)).toThrow(
      /regular file or directory/i,
    );
    expect(opened).not.toContain(nested);
  });

  test("opens repository files with nonblocking no-follow flags", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    vfs.writeFileSync(join(root, "verify"), "#!/bin/sh\n", { mode: 0o700 });
    const executable = join(root, "verify");
    let flags = 0;
    const hooks: GatePathHooks = {
      openPath: (path, value) => {
        if (path === executable) flags = value;
        return openVirtualFile(path, value);
      },
    };
    captureGatePathBindings(root, root, ["./verify"], undefined, hooks);
    expect(flags & O_NONBLOCK).toBe(O_NONBLOCK);
    expect(flags & O_NOFOLLOW).toBe(O_NOFOLLOW);
  });

  test("rejects a file-to-directory race after the nonblocking open", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    const lexical = join(root, "raced");
    vfs.writeFileSync(lexical, "regular fixture\n");
    const raced = lexical;
    const hooks: GatePathHooks = {
      openPath: (path, flags) => {
        if (path === raced) {
          vfs.unlinkSync(path);
          vfs.mkdirSync(path, { recursive: true });
        }
        return openVirtualFile(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./raced"], undefined, hooks)).toThrow(
      /changed while opening/i,
    );
  });
});
