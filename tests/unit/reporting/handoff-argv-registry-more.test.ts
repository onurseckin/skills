import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "../../../olt/scripts/src/core/contracts/capsule.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { renderHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { commandRecord } from "../workflow/test-port.ts";
import { dispatchFailures, handoffArgv } from "./dispatchable.ts";
import { STATUSES } from "./handoff-statuses.ts";
import {
  argvForShape,
  argvForStatus,
  capsule,
  preplanCapsule,
  roots,
  SHAPES,
  sharedRoots,
} from "./handoff-argv-registry.test.ts";

const REPORTING = fileURLToPath(new URL("../../../olt/scripts/src/reporting/", import.meta.url));

/** `registryArgv(entrypoint, "task:claim"` — the command name written into the call itself. */
const LITERAL_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g;
/** `registryArgv(entrypoint, name` — the name arrives from a list the next pattern reads. */
const INDIRECT_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*[,)]/g;
/** `const PREPLAN_NEXT_COMMANDS: readonly string[] = ["plan:status", ...]` */
const NAME_LIST = /:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/g;
const QUOTED = /"([^"]+)"/g;

/** Command names a module can hand to `registryArgv`, whether written inline or via a list. */
function namesIn(source: string): string[] {
  const names = [...source.matchAll(LITERAL_INVOCATION)].map(([, name]) => name!);
  for (const [, body] of source.matchAll(NAME_LIST)) {
    names.push(...[...body!.matchAll(QUOTED)].map(([, name]) => name!));
  }
  return names;
}

interface ReportingSource {
  file: string;
  source: string;
}

/** `registry-argv.ts` is the resolver; the names it mentions are its own parameters, not commands. */
function reportingSources(): ReportingSource[] {
  return readdirSync(REPORTING)
    .filter((file) => file.endsWith(".ts") && file !== "registry-argv.ts")
    .map((file) => ({ file, source: readFileSync(join(REPORTING, file), "utf-8") }));
}

const SOURCES = reportingSources();
const EMITTABLE = [...new Set(SOURCES.flatMap(({ source }) => namesIn(source)))].sort();

/**
 * Names the restart document has to be able to reach for a run to stay resumable: orientation,
 * dispatch, the task lifecycle, branch collection, completion and recovery. Asserted so a scan that
 * silently matched nothing cannot pass for a scan that found everything in order.
 */
const REQUIRED = [
  "branch:collect",
  "critic:review",
  "doctor",
  "plan:compile",
  "queue:wave",
  "recover",
  "run:complete",
  "run:exec",
  "run:status",
  "task:claim",
  "task:probe",
  "task:review",
  "task:submit",
];

describe("every argv line the rendered document prints", () => {
  test.each(STATUSES)("dispatches from a capsule whose task is %s", async (status) => {
    const argv = await argvForStatus(status);

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test.each(SHAPES)("dispatches from a capsule shaped as %s", async (name, status, mutate) => {
    const argv = await argvForShape(name, status, mutate);

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test("across every shape names the whole lifecycle, and nothing the scan did not predict", async () => {
    const named = new Set<string>();
    for (const status of STATUSES) {
      for (const argv of await argvForStatus(status)) named.add(argv[2]!);
    }
    for (const [name, status, mutate] of SHAPES) {
      for (const argv of await argvForShape(name, status, mutate)) named.add(argv[2]!);
    }
    // The pre-plan document is a second renderer with its own command list, so a walk that skipped
    // it would leave the whole path out of an uncompiled capsule unchecked.
    for (const argv of handoffArgv(renderHandoff(await preplanCapsule("union", sharedRoots)))) {
      named.add(argv[2]!);
    }

    // The anchor the equality below cannot supply: two sets that shrank together still match, so a
    // run that quietly stopped naming the commands that move work forward would pass on equality
    // alone. These are named outright.
    for (const name of REQUIRED) expect([...named]).toContain(name);
    // The two halves are the same set, which says both things at once: nothing the document printed
    // escaped the source scan that checks names against the registry, and no name the source can
    // reach for is unreachable in practice — an emission path no capsule state arrives at is dead
    // code that the registry check would go on certifying forever.
    expect([...named].sort()).toEqual(EMITTABLE);
  });

  test("dispatches from a capsule whose plan was never applied", async () => {
    const argv = handoffArgv(renderHandoff(await preplanCapsule("alone")));

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test("names an entrypoint that is on disk, on both renderers", async () => {
    const harness = fileURLToPath(new URL("../../../olt/scripts/harness.ts", import.meta.url));
    const documents = [
      renderHandoff(await capsule("entrypoint", "ready")),
      renderHandoff(await preplanCapsule("entrypoint")),
    ];

    for (const document of documents) {
      const argv = handoffArgv(document);
      expect(argv.length).toBeGreaterThan(0);
      // A registry-valid command behind a path that is not there still fails on paste, so the
      // entrypoint is checked against the filesystem rather than assumed from its shape.
      expect(argv.map(([, entrypoint]) => entrypoint).filter((path) => !existsSync(path!))).toEqual(
        [],
      );
      expect([...new Set(argv.map(([, entrypoint]) => entrypoint))]).toEqual([harness]);
    }
  });

  test("names the revision the capsule recorded, and refuses a graph that recorded none", async () => {
    expect(renderHandoff(await capsule("revision", "ready"))).toContain("Graph revision: 1");

    const repo = await mkdtemp(join(tmpdir(), "harness-argv-revisionless-"));
    roots.push(repo);
    const bare = initRun(
      repo,
      "argv-revisionless",
      new TextEncoder().encode("Ship it"),
      "file",
      true,
    );
    transact(bare, "planner", "plan-applied", {}, (state: RunState) => {
      state.graph = { gates: [] };
      state.tasks = {};
      state.requirements = { requirements: [] };
    });

    // Refused rather than described: a document that printed a revision here would be naming a plan
    // the capsule never recorded, which is the one thing this document must never do.
    expect(() => renderHandoff(bare)).toThrow("workflow requires a valid graph revision");
  });
});
