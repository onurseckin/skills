import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mindEscalateCommand } from "../../../../../olt/scripts/src/cli/commands/mind-escalate.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, loadRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";

describe("mind-escalate CLI command coverage suite", () => {
  let tempDir: string;
  let runRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mind-escalate-test-"));
    runRoot = initRun(tempDir, "escalate-run", new TextEncoder().encode("prompt"), "file", true);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("throws HarnessError on missing required flags", () => {
    expect(() => mindEscalateCommand({})).toThrow(HarnessError);
    expect(() => mindEscalateCommand({ run: runRoot })).toThrow(HarnessError);
    expect(() => mindEscalateCommand({ run: runRoot, actor: "orchestrator" })).toThrow(
      HarnessError,
    );
    expect(() => mindEscalateCommand({ run: runRoot, reason: "Blocked" })).toThrow(HarnessError);
  });

  test("records escalation without severity and generates markdown log and brief", () => {
    const res = mindEscalateCommand({
      run: runRoot,
      actor: "subagent-1",
      reason: "Blocked waiting on external API token",
    });

    expect(res).toBeDefined();
    expect(res.run_root).toBe(runRoot);
    expect(res.actor).toBe("subagent-1");
    expect(res.reason).toBe("Blocked waiting on external API token");
    expect(res.severity).toBeUndefined();
    expect(typeof res.escalation_id).toBe("string");
    expect((res.escalation_id as string).startsWith("esc-manual-")).toBe(true);
    expect(typeof res.escalated_at).toBe("string");
    expect(typeof res.markdown).toBe("string");
    expect((res.markdown as string).includes("Mind Escalation Recorded")).toBe(true);

    // Verify state store
    const loaded = loadRun(runRoot);
    const escalations = loaded.state.escalations;
    expect(Array.isArray(escalations)).toBe(true);
    expect(escalations.length).toBe(1);
    const first = escalations[0] as Record<string, unknown>;
    expect(first.id).toBe(res.escalation_id);
    expect(first.reason).toBe("Blocked waiting on external API token");
    expect(first.resolved_at).toBeNull();

    // Verify escalation.md file on disk
    const logPath = join(runRoot, "escalation.md");
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("# Mind Escalation Log");
    expect(content).toContain(`## ${res.escalation_id}`);
    expect(content).toContain("- **Actor**: `subagent-1`");
    expect(content).toContain("- **Reason**: Blocked waiting on external API token");
  });

  test("records escalation with explicit severity flag", () => {
    const res = mindEscalateCommand({
      run: runRoot,
      actor: "watchdog",
      reason: "Kernel panic detected in sandboxed container",
      severity: "critical",
    });

    expect(res.severity).toBe("critical");
    expect((res.markdown as string).includes("- **Severity**: `critical`")).toBe(true);

    const loaded = loadRun(runRoot);
    const escalations = loaded.state.escalations;
    const first = escalations[0] as Record<string, unknown>;
    expect(first.severity).toBe("critical");

    const logPath = join(runRoot, "escalation.md");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("- **Severity**: `critical`");
  });

  test("appends sequential escalations to both state and escalation.md", () => {
    const res1 = mindEscalateCommand({
      run: runRoot,
      actor: "agent-alpha",
      reason: "First block reason",
      severity: "low",
    });

    const res2 = mindEscalateCommand({
      run: runRoot,
      actor: "agent-beta",
      reason: "Second block reason",
      severity: "high",
    });

    const loaded = loadRun(runRoot);
    const escalations = loaded.state.escalations;
    expect(escalations.length).toBe(2);

    const first = escalations[0] as Record<string, unknown>;
    const second = escalations[1] as Record<string, unknown>;
    expect(first.id).toBe(res1.escalation_id);
    expect(second.id).toBe(res2.escalation_id);

    const logPath = join(runRoot, "escalation.md");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain(`## ${res1.escalation_id}`);
    expect(content).toContain(`## ${res2.escalation_id}`);
    expect(content).toContain("- **Actor**: `agent-alpha`");
    expect(content).toContain("- **Actor**: `agent-beta`");
  });

  test("recovers cleanly when working.escalations in state is uninitialized", () => {
    transact(runRoot, "system", "wipe-escalations", {}, (working) => {
      delete (working as Record<string, unknown>).escalations;
    });

    const res = mindEscalateCommand({
      run: runRoot,
      actor: "healer",
      reason: "Recovered uninitialized state",
    });

    expect(res.reason).toBe("Recovered uninitialized state");
    const loaded = loadRun(runRoot);
    expect(Array.isArray(loaded.state.escalations)).toBe(true);
    expect(loaded.state.escalations.length).toBe(1);
  });
});
