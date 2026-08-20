import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/**
 * plan:compile derives every requirement actionable (see docs/02-requirements/03), so a
 * needs_authority requirement is seeded directly rather than produced through the compiler.
 */
function gateRequirement(run: string, requirementId: string): void {
  transact(run, "test-setup", "requirement-gated-for-test", {}, (draft) => {
    const document = (draft.requirements ?? {}) as JsonObject;
    const list = (document.requirements ?? []) as JsonObject[];
    const requirement = list.find((entry) => entry.id === requirementId);
    if (!requirement) throw new Error(`requirement ${requirementId} not found`);
    requirement.disposition = "needs_authority";
  });
}

describe("authority:decide", () => {
  test("grants a needs_authority requirement and records the decision", async () => {
    const { run } = await setupCompiledRun("authority-grant-run", roots);
    gateRequirement(run, "req-core");

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-core",
      "--actor",
      "coordinator",
      "--decision",
      "grant",
      "--rationale",
      "The user approved this in the review thread.",
    ]);
    expect(String(decided.markdown)).toContain("### Authority Decision Recorded: `req-core`");
    const requirement = decided.requirement as {
      disposition: string;
      authority_status: string;
      authority_history: { decision: string; actor: string }[];
    };
    expect(requirement.disposition).toBe("needs_authority");
    expect(requirement.authority_status).toBe("granted");
    expect(requirement.authority_history).toHaveLength(1);
    expect(requirement.authority_history[0]!.decision).toBe("grant");

    const persisted = loadRun(run).state.requirements as JsonObject;
    const list = persisted.requirements as JsonObject[];
    const stored = list.find((entry) => entry.id === "req-core")!;
    expect(stored.authority_status).toBe("granted");
  });

  test("declining is permanent: a second decision on the same requirement is refused", async () => {
    const { run } = await setupCompiledRun("authority-decline-run", roots);
    gateRequirement(run, "req-sec");

    await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-sec",
      "--actor",
      "coordinator",
      "--decision",
      "decline",
      "--rationale",
      "The user declined this change.",
    ]);

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-sec",
        "--actor",
        "coordinator",
        "--decision",
        "grant",
        "--rationale",
        "Trying to reverse a terminal decision.",
      ]),
    ).rejects.toThrow("only pending needs_authority requirements can receive a decision");
  });

  test("refuses an unknown decision keyword", async () => {
    const { run } = await setupCompiledRun("authority-bad-decision-run", roots);
    gateRequirement(run, "req-core");

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-core",
        "--actor",
        "coordinator",
        "--decision",
        "maybe",
        "--rationale",
        "Unclear.",
      ]),
    ).rejects.toThrow("--decision must be grant or decline");
  });
});

/**
 * `authority:decide` is deliberately absent from every role contract because the decision it records
 * is a human's, not an agent's (docs/02-requirements/03). Nothing else in the tree would notice if a
 * grant were quietly added, so the exclusion is asserted here against the enforcement path itself.
 */
describe("authority:decide is outside every role contract", () => {
  test("no role grants it", () => {
    const dir = join(import.meta.dir, "..", "..", "..", "orchestrating-long-tasks", "roles");
    const granted = readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .flatMap((name) => {
        const frontmatter = /\ncommands:\n((?:\s*-\s*[^\n]+\n)+)/u.exec(
          readFileSync(join(dir, name), "utf-8"),
        );
        return (frontmatter?.[1] ?? "")
          .split("\n")
          .map((line) => line.replace(/^\s*-\s*/u, "").trim())
          .filter(Boolean);
      });
    expect(granted).not.toContain("authority:decide");
  });

  test("a registered coordinator is refused by the role contract, not by the recorder", async () => {
    const { run } = await setupCompiledRun("authority-granted-actor-run", roots);
    gateRequirement(run, "req-core");
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-core",
        "--actor",
        "coordinator-1",
        "--decision",
        "grant",
        "--rationale",
        "An agent cannot settle an authority gap on its own.",
      ]),
    ).rejects.toThrow("role coordinator may not invoke authority:decide");
  });
});
