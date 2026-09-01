import { afterEach, describe, expect, test } from "bun:test";
import {
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { captureGatePathBindings } from "../../../olt/scripts/src/engine/runner/signing/gate-path-bindings.ts";
import type { GatePathHooks } from "../../../olt/scripts/src/engine/runner/signing/gate-path-tree.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

function repository(): string {
  return tempRoot("gate-path-special");
}

function special(path: string): Stats {
  return {
    ...lstatSync(path),
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => false,
  } as Stats;
}

describe("gate path special-file safety", () => {
  test("rejects a direct special repository operand before opening it", () => {
    const root = repository();
    writeFileSync(join(root, "target"), "regular fixture\n");
    const target = realpathSync(join(root, "target"));
    let opens = 0;
    const hooks: GatePathHooks = {
      lstatPath: (path) => (path === target ? special(path) : lstatSync(path)),
      openPath: (path, flags) => {
        opens += 1;
        return openSync(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./target"], undefined, hooks)).toThrow(
      /regular file or directory/i,
    );
    expect(opens).toBe(0);
  });

  test("rejects a nested special entry without opening that entry", () => {
    const root = repository();
    mkdirSync(join(root, "suite"));
    writeFileSync(join(root, "suite", "nested"), "regular fixture\n");
    const nested = realpathSync(join(root, "suite", "nested"));
    const opened: string[] = [];
    const hooks: GatePathHooks = {
      lstatPath: (path) => (path === nested ? special(path) : lstatSync(path)),
      openPath: (path, flags) => {
        opened.push(path);
        return openSync(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./suite"], undefined, hooks)).toThrow(
      /regular file or directory/i,
    );
    expect(opened).not.toContain(nested);
  });

  test("opens repository files with nonblocking no-follow flags", () => {
    const root = repository();
    writeFileSync(join(root, "verify"), "#!/bin/sh\n", { mode: 0o700 });
    const executable = realpathSync(join(root, "verify"));
    let flags = 0;
    const hooks: GatePathHooks = {
      openPath: (path, value) => {
        if (path === executable) flags = value;
        return openSync(path, value);
      },
    };
    captureGatePathBindings(root, root, ["./verify"], undefined, hooks);
    expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });

  test("rejects a file-to-directory race after the nonblocking open", () => {
    const root = repository();
    const lexical = join(root, "raced");
    writeFileSync(lexical, "regular fixture\n");
    const raced = realpathSync(lexical);
    const hooks: GatePathHooks = {
      openPath: (path, flags) => {
        if (path === raced) {
          unlinkSync(path);
          mkdirSync(path);
        }
        return openSync(path, flags);
      },
    };
    expect(() => captureGatePathBindings(root, root, ["./raced"], undefined, hooks)).toThrow(
      /changed while opening/i,
    );
  });
});
