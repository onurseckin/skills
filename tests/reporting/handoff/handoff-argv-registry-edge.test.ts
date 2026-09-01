import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { renderHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { dispatchFailures, handoffArgv } from "../core/dispatchable.ts";
import { STATUSES } from "./handoff-statuses.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../browser/browser-virtual-fs.ts";
import { capsule, roots, sharedRoots } from "./handoff-argv-registry-core.test.ts";

export const handoffArgvRegistryEdgeSuiteName = "handoff argv shape and state dispatch validation";

export async function preplanCapsule(name: string, sink: string[] = roots): Promise<string> {
  setupVirtualBrowserFS();
  const repo = tempDir(`argv-preplan-${name}`);
  sink.push(repo);
  return initRun(repo, `argv-preplan-${name}`, new TextEncoder().encode("Ship it"), "file", true);
}

const statusArgv = new Map<string, string[][]>();
const shapeArgv = new Map<string, string[][]>();

export async function argvForStatus(status: string): Promise<string[][]> {
  const cached = statusArgv.get(status);
  if (cached !== undefined) return cached;
  const argv = handoffArgv(renderHandoff(await capsule(status, status, () => {}, sharedRoots)));
  statusArgv.set(status, argv);
  return argv;
}

export async function argvForShape(
  name: string,
  status: string,
  mutate: (state: RunState) => void,
): Promise<string[][]> {
  const cached = shapeArgv.get(name);
  if (cached !== undefined) return cached;
  const argv = handoffArgv(renderHandoff(await capsule(name, status, mutate, sharedRoots)));
  shapeArgv.set(name, argv);
  return argv;
}

describe(handoffArgvRegistryEdgeSuiteName, () => {
  afterEach(() => {
    roots.length = 0;
  });

  afterAll(() => {
    sharedRoots.length = 0;
    cleanupVirtualBrowserFS();
  });

  test("every status yields commands the CLI can dispatch", async () => {
    for (const status of STATUSES) {
      const argv = await argvForStatus(status);
      expect(argv.length).toBeGreaterThan(0);
      const failures = dispatchFailures(argv);
      expect(failures).toEqual([]);
    }
  });

  test("preplan capsule yields commands the CLI can dispatch", async () => {
    const preplanRun = await preplanCapsule("test-preplan");
    const argv = handoffArgv(renderHandoff(preplanRun));
    expect(argv.length).toBeGreaterThan(0);
    const failures = dispatchFailures(argv);
    expect(failures).toEqual([]);
  });

  test("dispatches cleanly for empty argv list", () => {
    expect(dispatchFailures([])).toEqual([]);
  });
});
