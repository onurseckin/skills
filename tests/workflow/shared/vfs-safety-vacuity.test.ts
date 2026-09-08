import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createTaskFsSpies } from "../../task/session/spies.ts";
import { orig, type VirtualTaskState } from "../../task/session/types.ts";
import { createWorkflowFsSpies } from "./virtual-fs-spies.ts";
import { orig as workflowOrig } from "./virtual-fs-state.ts";

describe("VFS Safety Vacuity", () => {
  let restoreFns: Array<() => void> = [];

  afterEach(() => {
    for (const fn of restoreFns) fn();
    restoreFns = [];
  });

  it("fails closed on task session mutating operations without calling orig fs", () => {
    const origWriteSpy = spyOn(orig, "writeFileSync");
    const state: VirtualTaskState = {
      vfs: new VirtualMemoryFS(),
      openDescriptors: new Map(),
      customModes: new Map(),
      customMtimes: new Map(),
      inodeMap: new Map(),
      symlinks: new Map(),
      hardlinks: new Map(),
      nextFd: 1000,
      nextInode: 50000,
    };
    const spies = createTaskFsSpies(state);
    restoreFns.push(() => {
      for (const s of spies) s.mockRestore();
      origWriteSpy.mockRestore();
    });

    const mutate = spies.find(
      (s) => (s as { name?: string }).name === "writeFileSync",
    ) as unknown as ((p: string, d: string) => void) | undefined;
    expect(mutate).toBeDefined();
    if (!mutate) throw new Error("writeFileSync spy not found");
    expect(() => mutate("/disallowed/non-virtual/test.txt", "payload")).toThrow(
      /\[VFS_SAFETY\] Disallowed mutating fs call/,
    );
    expect(origWriteSpy).not.toHaveBeenCalled();
  });

  it("fails closed on workflow shared mutating operations without calling orig fs", () => {
    const origWriteSpy = spyOn(workflowOrig, "writeFileSync");
    const vfs = new VirtualMemoryFS();
    const descriptors = new Map();
    const { spies, cleanup } = createWorkflowFsSpies(vfs, descriptors);
    restoreFns.push(() => {
      cleanup();
      origWriteSpy.mockRestore();
    });

    const mutate = spies.find((s) => s.name === "writeFileSync");
    expect(mutate).toBeDefined();
    if (!mutate) throw new Error("writeFileSync spy not found");
    expect(() => mutate("/disallowed/non-virtual/test.txt", "payload")).toThrow(
      /\[VFS_SAFETY\] Disallowed mutating fs call/,
    );
    expect(origWriteSpy).not.toHaveBeenCalled();
  });
});
