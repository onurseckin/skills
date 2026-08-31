import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_REGISTRY } from "../../olt/scripts/src/cli/registry/index.ts";

describe("host adapters & two-tier architecture specifications", () => {
  const root = join(import.meta.dir, "../../..");
  const hostAdaptersPath = join(root, "olt/references/host-adapters.md");
  const skillPath = join(root, "olt/SKILL.md");
  const cliDocPath = join(root, "olt/references/cli.md");

  test("host-adapters.md exists and documents tier-0 through tier-3 isolation rules", () => {
    expect(existsSync(hostAdaptersPath)).toBe(true);
    const content = readFileSync(hostAdaptersPath, "utf8");

    expect(content).toContain("Tiered Agent Architecture");
    expect(content).toContain("Tier 0: Main Interactive Chat Session");
    expect(content).toContain("Tier 1: Background Loop Orchestrator");
    expect(content).toContain("Tier 2: Background Run Coordinator");
    expect(content).toContain("Tier 3:");
    expect(content).toContain("Milestone-Only Notification Protocol");
  });

  // D4: the main thread has to have something to hand off to. Tier 0 spawns exactly one
  // orchestrator and nothing else; the orchestrator, not the main thread, is what dispatches a
  // coordinator per round.
  test("tier 0 hands off to exactly one orchestrator, never straight to a coordinator or worker", () => {
    const content = readFileSync(hostAdaptersPath, "utf8");

    expect(content).toContain("Spawns **exactly one** background orchestrator agent");
    expect(content).toContain("agents/orchestrator.yaml");
    expect(content).not.toContain("Spawns **exactly one** background coordinator agent");
  });

  test("names every supported host's own dispatch mechanism, not one host's", () => {
    const content = readFileSync(hostAdaptersPath, "utf8");

    // A coordinator reads this to learn which mechanism it has. Naming one host's tool as though it
    // were universal is what sent every non-Antigravity coordinator at a tool that does not exist.
    expect(content).toContain("Claude Code");
    expect(content).toContain("Antigravity");
    expect(content).toContain("Codex");
    expect(content).toContain("Cursor");

    expect(content).toContain("Agent` tool");
    expect(content).toContain("invoke_subagent");
    expect(content).toContain("spawn_agent");
    expect(content).toContain("Task` tool");

    expect(content).toContain("Silent Worker Recovery & Heartbeats");
  });

  test("states how a run degrades when a host cannot do something", () => {
    const content = readFileSync(hostAdaptersPath, "utf8");

    // A missing capability has to reach the reader. Emitting a command the host cannot run fails
    // confusingly; staying silent about a run with no independent validator is worse.
    expect(content).toContain("single-agent");
    expect(content).toContain("validation was not");
    expect(content).toContain("Never emit a command the host cannot execute");
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
    const agentDir = join(root, "olt/agents");
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
    expect(content).toContain("cli-capabilities/index.jsonl");
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
