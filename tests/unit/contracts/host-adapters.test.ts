import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_REGISTRY } from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";

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

  test("SKILL.md routes to host-adapters.md instead of restating the tier ladder", () => {
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf8");

    expect(content).toContain("references/host-adapters.md");
    expect(content).toContain("main-thread isolation");
    // The ladder itself is specified once, in host-adapters.md.
    expect(content).not.toContain("Tier 1 (Main Interactive Thread)");
    expect(content).not.toContain("Tier 3 (Implementer, Validator & Critic Subagents)");
  });

  test("all 4 multi-agent YAML specifications exist with proper tier metadata", () => {
    const agentDir = join(root, "orchestrating-long-tasks/agents");
    const personas = {
      coordinator: "coordinator",
      worker: "implementer",
      validator: "validator",
      critic: "completeness-critic",
    };

    for (const [persona, role] of Object.entries(personas)) {
      const file = join(agentDir, `${persona}.yaml`);
      expect(existsSync(file)).toBe(true);
      const yaml = readFileSync(file, "utf8");
      expect(yaml).toContain(`role: "${role}"`);
      expect(yaml).toContain("tier:");
      expect(yaml).toContain("zero_json: true");
    }
  });

  test("references/cli.md points at the generated manifest instead of copying it", () => {
    expect(existsSync(cliDocPath)).toBe(true);
    const content = readFileSync(cliDocPath, "utf8");

    expect(content).toContain("cli-capabilities.md");
    expect(content).toContain("cli-capabilities.json");
    expect(content).toContain("bun harness.ts help <command>");
    // A per-command flag table is the drift the generated manifest exists to prevent.
    expect(content).not.toContain("| Flag | Type |");
    expect(content).not.toContain("**Flags**");
    expect(content.split("\n").length).toBeLessThan(60);
  });

  test("every command cli.md names by hand exists in the registry", () => {
    const content = readFileSync(cliDocPath, "utf8");
    const known = new Set(COMMAND_REGISTRY.map((spec) => spec.name));
    const named = [...content.matchAll(/`([a-z][a-z-]*:[a-z][a-z-]*)`/gu)].map((match) => match[1]);
    for (const command of named) expect(known).toContain(command);
  });
});
