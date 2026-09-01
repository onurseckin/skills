import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectRepository } from "../../../../olt/scripts/src/packets/repository-snapshot.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

describe("repository directory streaming", () => {
  test("scans a non-Git repository without invoking the Git command dependency", () => {
    const repo = `/virtual/repository-directory-streaming-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(repo, { recursive: true });
    mkdirSync(join(repo, "nested"));
    writeFileSync(join(repo, "AGENTS.md"), "# Instructions\n");
    writeFileSync(join(repo, "nested", "tsconfig.json"), "{}\n");
    const snapshot = inspectRepository(repo, "current", new Date(0), {
      command: () => {
        throw new Error("Git command must not run");
      },
    });
    expect(snapshot.git).toEqual({ available: false, error: "Git metadata unavailable" });
    expect(snapshot.instruction_files.map(({ path }) => path)).toEqual(["AGENTS.md"]);
    expect(snapshot.convention_files.map(({ path }) => path)).toEqual(["nested/tsconfig.json"]);
  });
});
