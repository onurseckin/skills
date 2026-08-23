import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { assertGrantedCommand } from "../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { transact } from "../../../olt/scripts/src/store/index.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("assertGrantedCommand", () => {
  test("swallows a state.json that exists but does not belong to a real capsule", async () => {
    const { repo } = await emptyGrantRun("command-authority-broken-capsule-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    // capsuleState()'s existsSync(state.json) check passes, but loadRun then fails (no
    // manifest.json/prompt.md/events.jsonl alongside it) — the catch branch must swallow
    // that and leave enforcement a no-op rather than let the HarnessError propagate.
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });

  test("enforces the acting agent's granted role once a ledger entry is found", async () => {
    const { run } = await emptyGrantRun("command-authority-ledger-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "agent-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    // A validator's contract does not grant task:submit, so the ledger lookup must resolve
    // and assertRoleMayInvoke must run and refuse it.
    const flags: Flags = { run, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).toThrow("may not invoke");

    // A command validators are actually granted must sail through the same lookup.
    expect(() => assertGrantedCommand(spec("task:probe"), flags)).not.toThrow();
  });

  test("enforces command-running ban on cognitive validators attempting run:exec", async () => {
    const { run } = await emptyGrantRun("command-authority-ban-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "validator-cog-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
        {
          id: "mechanic-val-1",
          role: "mechanic-validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    // Cognitive validator attempting run:exec must be refused
    const cogFlags: Flags = { run, actor: "validator-cog-1" };
    expect(() => assertGrantedCommand(spec("run:exec"), cogFlags)).toThrow(
      "cognitive validators are strictly banned from executing bash/shell commands or running test suites",
    );

    // Cognitive validator using shell/test-runner tool category must be refused
    const toolCatFlags: Flags = {
      run,
      validator: "validator-cog-1",
      "tool-category": "shell",
    };
    expect(() => assertGrantedCommand(spec("task:probe"), toolCatFlags)).toThrow(
      "may not invoke execution tool category",
    );

    // Mechanic validator attempting run:exec must succeed
    const mechFlags: Flags = { run, actor: "mechanic-val-1" };
    expect(() => assertGrantedCommand(spec("run:exec"), mechFlags)).not.toThrow();
  });

  test("excludes a command's own subject flag from the candidates it reads the acting agent from", () => {
    const flags: Flags = { run: "/nonexistent/capsule", actor: "coordinator" };
    expect(() => assertGrantedCommand(spec("queue:pop"), flags)).not.toThrow();
  });

  test("verifies zero TypeScript any and zero suppressions across command authority files", () => {
    const { existsSync, readFileSync } = require("node:fs");
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/packets/command-authority.test.ts",
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
