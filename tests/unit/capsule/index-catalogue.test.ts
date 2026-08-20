import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import {
  buildIndex,
  indexFreshness,
  loadIndex,
  writeIndex,
} from "../../../orchestrating-long-tasks/scripts/src/store/capsule-index.ts";
import { ingestScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import { recordCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";
import { runStatus } from "../../../orchestrating-long-tasks/scripts/src/reporting/status.ts";
import { runStatusCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/run-ops.ts";
import type { RunState } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function capsule(runId = "run-index"): string {
  const root = mkdtempSync(join(tmpdir(), "capsule-index-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, runId, new TextEncoder().encode("prompt\n"), "file", true);
}

function populate(run: string): RunState {
  return transact(run, "coordinator", "plan-compiled", { task_id: "T-1" }, (state) => {
    state.tasks = {
      "T-1": {
        id: "T-1",
        status: "changes_requested",
        requirement_ids: ["REQ-1"],
        write_scope: ["src"],
        findings: [
          {
            id: "F-1",
            requirement_id: "REQ-1",
            severity: "critical",
            status: "open",
            observation: "clipped",
          },
          { id: "F-2", requirement_id: "REQ-1", severity: "minor", status: "resolved" },
        ],
        validation: { checks: [{ command_id: "C-1" }] },
      },
    };
    state.commands = {
      "C-1": {
        id: "C-1",
        status: "succeeded",
        exit_code: 0,
        task_id: "T-1",
        actor: "worker-1",
        started_at: "2026-08-19T10:00:00.000Z",
      },
    };
    state.packets = {
      "P-1": { id: "P-1", role: "implementer", agent_id: "worker-1", task_id: "T-1" },
    };
  });
}

describe("the catalogue answers the routine questions without a chain walk", () => {
  test("it exists from the first moment, empty and stamped at the head it was built for", () => {
    const run = capsule();
    const { index, manifest } = loadIndex(run);

    expect(manifest.run_id).toBe("run-index");
    expect(index.derived).toBeTrue();
    expect(index.index_of_event).toEqual({ sequence: 0, head: null });
    expect(index.tasks).toEqual([]);
    expect(index.blobs).toEqual([]);
    expect(indexFreshness(run, index)).toBe("current");
  });

  test("it catalogues tasks, findings, commands, packets and captures by what filters them", () => {
    const run = capsule("run-index-full");
    populate(run);
    ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      taskId: "T-1",
      explicitPaths: [
        (() => {
          const path = join(run, "..", "..", "shot.png");
          writeFileSync(path, "pixels", "utf-8");
          return path;
        })(),
      ],
    });
    writeFileSync(join(run, "reports", "T-1-probe-02.json"), "{}", "utf-8");
    const state = JSON.parse(readFileSync(join(run, "state.json"), "utf-8")) as RunState;
    const index = writeIndex(run, state);

    expect(index.tasks).toEqual([
      {
        id: "T-1",
        status: "changes_requested",
        requirement_ids: ["REQ-1"],
        command_ids: ["C-1"],
        finding_ids: ["F-1", "F-2"],
        open_finding_ids: ["F-1"],
      },
    ]);
    expect(index.findings.map((finding) => [finding.id, finding.status])).toEqual([
      ["F-1", "open"],
      ["F-2", "resolved"],
    ]);
    expect(index.commands[0]).toMatchObject({ id: "C-1", path: "commands/C-1", exit_code: 0 });
    expect(index.packets[0]).toMatchObject({ id: "P-1", role: "implementer", task_id: "T-1" });
    expect(index.reports).toContainEqual(
      expect.objectContaining({ name: "T-1-probe-02.json", task_id: "T-1", round: 2 }),
    );
    expect(index.captures[0]).toMatchObject({ kind: "screenshot", command_id: "C-1" });
    expect(index.blobs[0]?.references).toBe(1);
  });

  test("an index built at an older head reports itself stale rather than being trusted", () => {
    const run = capsule("run-index-stale");
    const before = loadIndex(run).index;
    populate(run);

    expect(indexFreshness(run, before)).toBe("stale");
    // The writer keeps it current on every commit, so the file on disk is not the stale one.
    expect(indexFreshness(run, loadIndex(run).index)).toBe("current");
  });

  test("a projection it cannot read leaves freshness unknown, never current", () => {
    const run = capsule("run-index-unknown");
    const index = loadIndex(run).index;
    writeFileSync(join(run, "state.json"), "not json", "utf-8");

    expect(indexFreshness(run, index)).toBe("unknown");
  });

  test("it is exactly rebuildable, so deleting it costs nothing but the rebuild", () => {
    const run = capsule("run-index-rebuild");
    const state = populate(run);
    const onDisk = loadIndex(run).index;
    rmSync(join(run, "index.json"));

    const rebuilt = buildIndex(run, state, "run-index-rebuild");

    expect({ ...rebuilt, generated_at: "" }).toEqual({ ...onDisk, generated_at: "" });
  });

  test("a file that is not a capsule index is refused rather than read as one", () => {
    const run = capsule("run-index-bad");
    writeFileSync(join(run, "index.json"), JSON.stringify({ schema: "something.else" }), "utf-8");

    expect(() => loadIndex(run)).toThrow(/is not a capsule index/u);

    writeFileSync(join(run, "index.json"), "{", "utf-8");
    expect(() => loadIndex(run)).toThrow(/unreadable/u);
  });

  test("run:status reports the catalogue and whether it still describes the run", () => {
    const run = capsule("run-index-status");
    populate(run);

    const status = runStatus(run) as { catalogue: Record<string, unknown> };

    expect(status.catalogue.available).toBeTrue();
    expect(status.catalogue.freshness).toBe("current");
    expect(status.catalogue.counts).toMatchObject({ tasks: 1, commands: 1, open_findings: 1 });
  });

  test("the run:status command an agent actually invokes surfaces the catalogue", () => {
    const run = capsule("run-index-cli");
    populate(run);

    const result = runStatusCommand({ run }) as {
      markdown: string;
      catalogue: { available: boolean; freshness: string };
    };

    expect(result.catalogue.available).toBeTrue();
    expect(result.catalogue.freshness).toBe("current");
    expect(result.markdown).toContain("**Capsule**:");
    expect(result.markdown).toContain("index current");
  });

  test("a capture recorded after the last event still reaches the catalogue", () => {
    const run = capsule("run-index-captures");
    populate(run);
    const shot = join(run, "..", "..", "after-the-event.png");
    writeFileSync(shot, "pixels", "utf-8");

    // Ingestion writes the ledger outside the chain, so no event follows the capture.
    ingestScreenshots({ runRoot: run, commandId: "C-1", explicitPaths: [shot] });

    const index = loadIndex(run).index;
    expect(index.captures.map((capture) => capture.name)).toEqual(["after-the-event.png"]);
    expect(index.blobs).toHaveLength(1);
    expect(indexFreshness(run, index)).toBe("current");
  });

  test("a ledger that moved under the catalogue makes it stale, not silently wrong", () => {
    const run = capsule("run-index-ledger-moved");
    populate(run);
    const built = loadIndex(run).index;
    recordCaptures(run, [
      {
        kind: "screenshot",
        name: "unseen.png",
        sha256: "a".repeat(64),
        bytes: 1,
        blob_path: `blobs/aa/${"a".repeat(64)}`,
        path: "evidence/screenshots/unseen.png",
        storage: "hardlink",
        original_path: "/elsewhere/unseen.png",
      },
    ]);

    // The event head has not moved, so only the ledger's own digest can expose the drift.
    expect(built.captures).toEqual([]);
    expect(indexFreshness(run, built)).toBe("stale");
  });

  test("run:status says the catalogue is unreadable rather than reporting an empty capsule", () => {
    const run = capsule("run-index-cli-broken");
    populate(run);
    rmSync(join(run, "index.json"));

    const result = runStatusCommand({ run }) as {
      markdown: string;
      catalogue: { available: boolean; freshness: string; counts?: unknown };
    };

    expect(result.catalogue.available).toBeFalse();
    expect(result.catalogue.freshness).toBe("unknown");
    expect(result.catalogue.counts).toBeUndefined();
    expect(result.markdown).toContain("counts unknown");
  });
});
