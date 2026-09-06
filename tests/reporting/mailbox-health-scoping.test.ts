import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMailboxHealth } from "../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { collectDiagnosticEngines } from "../../olt/scripts/src/reporting/doctor/diagnostic-collector.ts";

describe("Mailbox Health Scoping Gate", () => {
  let tempDir: string;
  let mailboxesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbox-scoping-test-"));
    mailboxesDir = join(tempDir, ".olt", "mailboxes");
    mkdirSync(mailboxesDir, { recursive: true });

    // Setup active-agent-1: clean and valid mailbox
    const activeDir = join(mailboxesDir, "active-agent-1");
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(
      join(activeDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 0,
        last_read_id: "",
        seen_ids: [],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    writeFileSync(join(activeDir, "inbox.jsonl"), "", "utf8");
    writeFileSync(join(activeDir, "outbox.jsonl"), "", "utf8");

    // Setup dead-agent-1: corrupted cursor
    const deadDir1 = join(mailboxesDir, "dead-agent-1");
    mkdirSync(deadDir1, { recursive: true });
    writeFileSync(join(deadDir1, "cursor.json"), "{ corrupt json ...", "utf8");

    // Setup dead-agent-2: malformed envelope line
    const deadDir2 = join(mailboxesDir, "dead-agent-2");
    mkdirSync(deadDir2, { recursive: true });
    writeFileSync(
      join(deadDir2, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 0,
        last_read_id: "",
        seen_ids: [],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    writeFileSync(join(deadDir2, "inbox.jsonl"), "not a json line\n", "utf8");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("when activeAgentIds is specified, dead mailboxes are completely ignored", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
      activeAgentIds: ["active-agent-1"],
    });

    expect(res.passed).toBe(true);
    expect(res.findings.filter((f) => f.severity === "ERROR").length).toBe(0);
    const affectedAgents = res.findings.map((f) => f.details?.agentId);
    expect(affectedAgents).not.toContain("dead-agent-1");
    expect(affectedAgents).not.toContain("dead-agent-2");
  });

  test("when activeAgentIds is omitted and no state, dead mailboxes are flagged as errors", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
    });

    expect(res.passed).toBe(false);
    const errors = res.findings.filter((f) => f.severity === "ERROR");
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const affectedAgents = errors.map((f) => f.details?.agentId);
    expect(affectedAgents).toContain("dead-agent-1");
    expect(affectedAgents).toContain("dead-agent-2");
  });

  test("when active agent itself has corruption, it is correctly flagged", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
      activeAgentIds: ["dead-agent-1"],
    });

    expect(res.passed).toBe(false);
    const errors = res.findings.filter((f) => f.severity === "ERROR");
    expect(errors.some((f) => f.details?.agentId === "dead-agent-1")).toBe(true);
    expect(errors.some((f) => f.details?.agentId === "dead-agent-2")).toBe(false);
  });

  test("resolves active agents from state.agents array of objects with id or agentId", async () => {
    const resObj = await checkMailboxHealth({
      repoRoot: tempDir,
      state: { agents: [{ id: "active-agent-1" }] },
    });
    expect(resObj.passed).toBe(true);

    const resAgentId = await checkMailboxHealth({
      repoRoot: tempDir,
      state: { agents: [{ agentId: "active-agent-1" }] },
    });
    expect(resAgentId.passed).toBe(true);
  });

  test("resolves active agents from state.agents array of strings", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
      state: { agents: ["active-agent-1"] },
    });
    expect(res.passed).toBe(true);
  });

  test("collectDiagnosticEngines forwards activeAgentIds from state.agents to checkMailboxHealth", () => {
    const result = collectDiagnosticEngines({
      repoRoot: tempDir,
      state: { agents: [{ id: "active-agent-1" }] },
    });

    const mailboxResult = result.engineResults.checkMailboxHealth;
    expect(mailboxResult).toBeDefined();
    expect(mailboxResult.passed).toBe(true);
    expect(mailboxResult.findings.filter((f) => f.severity === "ERROR").length).toBe(0);
  });

  test("handles missing mailbox directory gracefully without error", async () => {
    const res = await checkMailboxHealth({
      repoRoot: join(tempDir, "nonexistent-subdir"),
    });
    expect(res.passed).toBe(true);
    expect(res.findings).toEqual([]);
  });

  test("resolves active agents from state.agents dictionary object", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
      state: { agents: { "active-agent-1": { role: "worker" } } },
    });
    expect(res.passed).toBe(true);
    expect(res.findings.filter((f) => f.severity === "ERROR").length).toBe(0);
  });

  test("filters out invalid, null, and non-string entries in state.agents", async () => {
    const res = await checkMailboxHealth({
      repoRoot: tempDir,
      state: {
        agents: [null, undefined, 42, "", "   ", {}, { id: "active-agent-1" }],
      },
    });
    expect(res.passed).toBe(true);
    expect(res.findings.filter((f) => f.severity === "ERROR").length).toBe(0);
  });

  test("collectDiagnosticEngines handles undefined and null state safely", () => {
    const resUndef = collectDiagnosticEngines({
      repoRoot: tempDir,
      state: undefined,
    });
    expect(resUndef.engineResults.checkMailboxHealth).toBeDefined();

    const resNull = collectDiagnosticEngines({
      repoRoot: tempDir,
      state: null,
    });
    expect(resNull.engineResults.checkMailboxHealth).toBeDefined();
  });
});
