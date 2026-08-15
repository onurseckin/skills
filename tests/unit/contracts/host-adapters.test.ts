import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("host adapters specification", () => {
  const root = join(import.meta.dir, "../../..");
  const hostAdaptersPath = join(root, "orchestrating-long-tasks/references/host-adapters.md");
  const skillPath = join(root, "orchestrating-long-tasks/SKILL.md");

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
});
