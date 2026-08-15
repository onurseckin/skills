import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("host adapters & two-tier architecture specifications", () => {
  const root = join(import.meta.dir, "../../..");
  const hostAdaptersPath = join(root, "orchestrating-long-tasks/references/host-adapters.md");
  const skillPath = join(root, "orchestrating-long-tasks/SKILL.md");
  const cliDocPath = join(root, "orchestrating-long-tasks/references/cli.md");

  test("host-adapters.md exists and documents all tier-1, tier-2, and tier-3 isolation rules", () => {
    expect(existsSync(hostAdaptersPath)).toBe(true);
    const content = readFileSync(hostAdaptersPath, "utf8");

    expect(content).toContain("Two-Tier Agent Architecture");
    expect(content).toContain("Tier 1: Main Interactive Chat Session");
    expect(content).toContain("Tier 2: Background Run Coordinator");
    expect(content).toContain("Tier 3:");
    expect(content).toContain("Milestone-Only Notification Protocol");
  });

  test("documents specific native host adapters for AGY, Claude Code, and Codex", () => {
    const content = readFileSync(hostAdaptersPath, "utf8");

    expect(content).toContain("Google Antigravity (AGY / Antigravity CLI)");
    expect(content).toContain("Anthropic Claude Code");
    expect(content).toContain("OpenAI Codex & ChatGPT Coding Agents");
    expect(content).toContain("Silent Worker Recovery & Heartbeats");
  });

  test("SKILL.md references two-tier isolation and host adapters", () => {
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf8");

    expect(content).toContain("Two-Tier Agent Architecture & Main Thread Isolation");
    expect(content).toContain("Background Run Coordinator");
    expect(content).toContain("references/host-adapters.md");
  });

  test("all 4 multi-agent YAML specifications exist with proper tier metadata", () => {
    const agentDir = join(root, "orchestrating-long-tasks/agents");
    const roles = ["coordinator", "worker", "validator", "critic"];

    for (const role of roles) {
      const file = join(agentDir, `${role}.yaml`);
      expect(existsSync(file)).toBe(true);
      const yaml = readFileSync(file, "utf8");
      expect(yaml).toContain(`role: "${role}"`);
      expect(yaml).toContain("tier:");
      expect(yaml).toContain("zero_json: true");
    }
  });

  test("references/cli.md documents all 18 colon commands", () => {
    expect(existsSync(cliDocPath)).toBe(true);
    const content = readFileSync(cliDocPath, "utf8");

    const commands = [
      "plan:init",
      "plan:add",
      "plan:compile",
      "plan:status",
      "queue:next",
      "queue:list",
      "queue:pop",
      "task:claim",
      "task:heartbeat",
      "task:submit",
      "task:validate-start",
      "task:review",
      "task:reject",
      "critic:start",
      "critic:review",
      "run:exec",
      "run:status",
      "run:complete",
    ];

    for (const cmd of commands) {
      expect(content).toContain(cmd);
    }
  });
});
