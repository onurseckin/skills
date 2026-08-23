import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRun } from "../../../olt/scripts/src/store/index.ts";
import { ingestScreenshots } from "../../../olt/scripts/src/reporting/screenshot-ingestion.ts";
import { capsuleCatalogue, runStatus } from "../../../olt/scripts/src/reporting/status.ts";
import { runDoctor, versionAtLeast } from "../../../olt/scripts/src/reporting/doctor.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("versionAtLeast", () => {
  test("an exact version match is at least the minimum, falling through every component check", () => {
    expect(versionAtLeast("1.3.0", "1.3.0")).toBe(true);
  });

  test("a lower component at any position fails the check, regardless of later components", () => {
    expect(versionAtLeast("1.2.9", "1.3.0")).toBe(false);
    expect(versionAtLeast("0.9.9", "1.3.0")).toBe(false);
  });

  test("a higher component short-circuits true without inspecting shorter or missing segments", () => {
    expect(versionAtLeast("2.0.0", "1.3.0")).toBe(true);
    expect(versionAtLeast("1.3", "1.3.0")).toBe(true);
  });

  test("a missing trailing component on the minimum side is treated as zero", () => {
    expect(versionAtLeast("1.3.0.1", "1.3.0")).toBe(true);
  });
});

describe("capsule catalogue byte accounting", () => {
  test("stored_bytes sums the actual size of every stored blob", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-catalogue-"));
    roots.push(repo);
    const run = initRun(repo, "catalogue-run", new TextEncoder().encode("Prompt"), "file", true);

    const source = join(repo, "shot.png");
    await writeFile(source, "0123456789", "utf-8");
    ingestScreenshots({ runRoot: run, explicitPaths: [source] });

    const catalogue = capsuleCatalogue(run);
    expect(catalogue.available).toBe(true);
    expect(catalogue.counts?.captures).toBe(1);
    expect(catalogue.counts?.blobs).toBe(1);
    expect(catalogue.stored_bytes).toBe(10);

    const status = runStatus(run);
    expect((status.catalogue as { stored_bytes: number }).stored_bytes).toBe(10);
  });

  test("an unreadable index is reported as unavailable rather than thrown", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-catalogue-broken-"));
    roots.push(repo);
    const run = initRun(repo, "broken-index-run", new TextEncoder().encode("Prompt"), "file", true);
    await writeFile(join(run, "index.json"), "{not json", "utf-8");

    expect(capsuleCatalogue(run)).toEqual({ available: false, freshness: "unknown" });
  });
});

describe("doctor integrity reporting", () => {
  test("a corrupt state.json is surfaced as a code-labelled integrity issue", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doctor-corrupt-"));
    roots.push(repo);
    const run = initRun(repo, "corrupt-run", new TextEncoder().encode("Prompt"), "file", true);
    await writeFile(join(run, "state.json"), "{not json", "utf-8");

    const report = await runDoctor(run);

    expect(report.healthy).toBe(false);
    expect((report.integrity_issues as { code: string }[]).length).toBeGreaterThan(0);
    expect((report.issues as string[]).some((issue) => issue.startsWith("STATE_JSON:"))).toBe(true);
  });
});
