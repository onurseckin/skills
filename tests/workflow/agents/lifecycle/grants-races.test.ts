import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun, loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { readAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";

const REGISTRATION_RACER = join(import.meta.dir, "./agent-registration-racer.fixture.ts");

async function waitForBarrier(path: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`registration racer did not reach start barrier: ${path}`);
}

async function raceConditionalGenesis(
  firstId: string,
  secondId: string,
): Promise<readonly { readonly ok: boolean; readonly code?: string }[]> {
  const repo = mkdtempSync(join(tmpdir(), "grants-race-"));
  try {
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    const barrier = join(repo, "registration-race");
    mkdirSync(barrier);
    const racers = [
      ["first", firstId],
      ["second", secondId],
    ].map(([label, agentId]) =>
      Bun.spawn(["bun", REGISTRATION_RACER, runRoot, barrier, label!, agentId!], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    await Promise.all(
      racers.map((_, index) =>
        waitForBarrier(join(barrier, `${index === 0 ? "first" : "second"}.ready`)),
      ),
    );
    writeFileSync(join(barrier, "start"), "go", "utf8");
    const results = await Promise.all(
      racers.map(async (racer) => {
        const [exit, stdout] = await Promise.all([racer.exited, new Response(racer.stdout).text()]);
        expect(exit).toBe(0);
        const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT::"));
        expect(line).toBeDefined();
        return JSON.parse(line!.slice("RESULT::".length)) as { ok: boolean; code?: string };
      }),
    );
    expect(
      readAgentLedger(loadRun(runRoot).state).filter((grant) => grant.status === "active"),
    ).toHaveLength(1);
    expect(
      loadRun(runRoot).events.filter((event) => event.kind === "agent-registered"),
    ).toHaveLength(1);
    return results;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("workflow/agents/grants: concurrency races", () => {
  test("serializes real same-run conditional-genesis racers for distinct and identical agent ids", async () => {
    for (const [firstId, secondId] of [
      ["genesis-distinct-a", "genesis-distinct-b"],
      ["genesis-same", "genesis-same"],
    ]) {
      const results = await raceConditionalGenesis(firstId, secondId);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)[0]?.code).toBe(
        firstId === secondId ? "INVALID_STATE" : "AUTHENTICATION_FAILURE",
      );
    }
  }, 15000);
});
