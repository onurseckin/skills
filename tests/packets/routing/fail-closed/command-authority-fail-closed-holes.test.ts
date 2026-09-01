import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGrantedCommand,
  cleanupVirtualAuthorityFS,
  setupVirtualAuthorityFS,
  spec,
} from "../authority/command-authority-fixture.ts";
import { assertGrantedCommand as assertRawGrantedCommand } from "../../../../olt/scripts/src/packets/command-authority.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";

beforeAll(() => {
  setupVirtualAuthorityFS();
});

afterAll(() => {
  cleanupVirtualAuthorityFS();
});

describe("assertGrantedCommand hole 2: no acting identity resolves", () => {
  test("denies a non-allowlisted command with --run but no identity flag", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "verified caller session",
    );
  });

  test("permits task:check with --run but no identity flag, the retired-actor bricking trap", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("task:check"), flags)).not.toThrow();
  });

  test("permits doctor with --run but no identity flag", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("doctor"), flags)).not.toThrow();
  });

  test("permits plan:brainstorm without --run only for the prompt-only in-memory form", () => {
    expect(() => assertGrantedCommand(spec("plan:brainstorm"), {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { prompt: "in-memory prompt" }),
    ).not.toThrow();
  });
});

describe("assertGrantedCommand hole 3: capsule state cannot load", () => {
  test("denies a non-allowlisted command against an unreadable capsule", async () => {
    const { repo } = await emptyGrantRun("fail-closed-hole3-deny-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("denies agent:register against an unreadable capsule because genesis requires a readable empty ledger", async () => {
    const { repo } = await emptyGrantRun("fail-closed-hole3-permit-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, actor: "first-orchestrator" };
    expect(() => assertRawGrantedCommand(spec("agent:register"), flags)).toThrow(
      "first-grant genesis requires a readable empty agent ledger",
    );
  });

  test("permits plan:brainstorm without an agent grant only for a readable capsule", async () => {
    const { run } = await emptyGrantRun("fail-closed-brainstorm-empty-grant-");
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run, actor: "planner-no-grant" }),
    ).not.toThrow();
  });

  test("denies plan:brainstorm against an unreadable capsule even though it is grant-bootstrap exempt", async () => {
    const { repo } = await emptyGrantRun("fail-closed-brainstorm-unreadable-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run: brokenRoot, actor: "planner-no-grant" }),
    ).toThrow("not on the grant bootstrap allowlist for missing capsules");
  });
});

describe("assertGrantedCommand hole 4: id absent from ledger", () => {
  test("denies a non-allowlisted command for an unregistered ghost actor", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole4-ghost-");
    const flags: Flags = { run, agent: "ghost-actor-not-in-ledger" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});

describe("assertGrantedCommand fail-closed does not flip open for legitimate run-scoped-grant-free flows", () => {
  test("permits orchestrator:run with no --run and no --actor, the fresh-capsule bootstrap case", () => {
    expect(() => assertGrantedCommand(spec("orchestrator:run"), {})).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("orchestrator:run"), { repo: ".", prompt: "hi" }),
    ).not.toThrow();
  });

  test("permits orchestrator:run against an unresolvable --run with no --actor", () => {
    const flags: Flags = { run: "/nonexistent/probe-run" };
    expect(() => assertGrantedCommand(spec("orchestrator:run"), flags)).not.toThrow();
  });

  test("permits structurally identity-free read-only commands with a --run but no identity flag", async () => {
    const { run } = await emptyGrantRun("fail-closed-readonly-");
    expect(() => assertGrantedCommand(spec("queue:wave"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("plan:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:next"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:list"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("report"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("dag"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("run:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("agent:list"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("branch:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("summary:view"), { run })).not.toThrow();
  });

  test("still denies a command that declares an identity flag even when it goes unsupplied against a real run", async () => {
    const { run } = await emptyGrantRun("fail-closed-identity-declared-");
    expect(() => assertGrantedCommand(spec("task:submit"), { run })).toThrow(
      "verified caller session",
    );
  });
});
