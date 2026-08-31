import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preplanPacketPort } from "../../../olt/scripts/src/packets/preplan-port.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function fixtureRun(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "preplan-port-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  return initRun(repo, "preplan-port-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("preplanPacketPort", () => {
  test("read() on a freshly initialized run returns the empty-state defaults", async () => {
    const run = await fixtureRun();
    const state = preplanPacketPort(run).read();
    expect(state.tasks).toEqual({});
    expect(state.requirements).toEqual([]);
    expect(state.gates).toEqual([]);
    expect(state.commands).toEqual({});
    expect(state.orphan_evidence).toEqual([]);
    expect(state.graph_revision).toBe(0);
    expect(state.packets).toEqual({});
  });

  test("read() projects a populated graph, requirements and revision from raw state", async () => {
    const run = await fixtureRun();
    transact(run, "test-setup", "seed", {}, (draft) => {
      draft.graph = { gates: [{ id: "gate-run-completion", scope: "run" }], revision: 3 };
      draft.requirements = { requirements: [{ id: "R-1", status: "open" }] };
      draft.tasks = { "T-1": { id: "T-1", status: "queued" } };
      draft.commands = { "C-1": { id: "C-1", status: "succeeded" } };
      draft.orphan_evidence = [{ note: "stray" }];
      draft.packets = { "pkt-1": { id: "pkt-1", status: "published" } };
    });

    const state = preplanPacketPort(run).read();
    expect(state.gates).toEqual([{ id: "gate-run-completion", scope: "run" }] as never);
    expect(state.requirements).toEqual([{ id: "R-1", status: "open" }] as never);
    expect(state.graph_revision).toBe(3);
    expect(state.tasks).toEqual({ "T-1": { id: "T-1", status: "queued" } } as never);
    expect(state.commands).toEqual({ "C-1": { id: "C-1", status: "succeeded" } } as never);
    expect(state.orphan_evidence).toEqual([{ note: "stray" }]);
    expect(state.packets).toEqual({ "pkt-1": { id: "pkt-1", status: "published" } } as never);
  });

  test("read() falls back to defaults when graph/requirements are the wrong shape", async () => {
    const run = await fixtureRun();
    transact(run, "test-setup", "seed", {}, (draft) => {
      draft.graph = "not-an-object";
      draft.requirements = ["not", "an", "object"];
    });

    const state = preplanPacketPort(run).read();
    expect(state.gates).toEqual([]);
    expect(state.requirements).toEqual([]);
    expect(state.graph_revision).toBe(0);
  });

  test("read() defaults graph_revision when the revision field is not a safe integer", async () => {
    const run = await fixtureRun();
    transact(run, "test-setup", "seed", {}, (draft) => {
      draft.graph = { gates: [], revision: "3" };
    });

    const state = preplanPacketPort(run).read();
    expect(state.graph_revision).toBe(0);
  });

  test("transact() persists only the mutator's packets writes back to the run, dropping other state edits", async () => {
    const run = await fixtureRun();
    const port = preplanPacketPort(run);

    const mutated = port.transact("planner-1", "seed-orphan", {}, (state) => {
      state.orphan_evidence.push({ note: "found during transact" });
      state.packets = { "pkt-2": { id: "pkt-2", status: "draft" } as never };
    });

    // preplanPacketPort's transact only writes `draft.packets = state.packets` back onto the
    // draft it re-derives from; every other field on the mutated view is re-projected from the
    // (unchanged) raw draft, so a mutation like orphan_evidence.push is silently discarded.
    expect(mutated.packets).toEqual({ "pkt-2": { id: "pkt-2", status: "draft" } } as never);
    expect(mutated.orphan_evidence).toEqual([]);

    const reread = port.read();
    expect(reread.packets).toEqual({ "pkt-2": { id: "pkt-2", status: "draft" } } as never);
    expect(reread.orphan_evidence).toEqual([]);
  });

  test("transact() defaults draft.packets to an empty object when the mutator clears it", async () => {
    const run = await fixtureRun();
    const port = preplanPacketPort(run);

    const mutated = port.transact("planner-1", "clear-packets", {}, (state) => {
      state.packets = undefined;
    });

    expect(mutated.packets).toEqual({});
  });
});
