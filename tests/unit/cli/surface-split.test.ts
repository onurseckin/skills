import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { helpRequest, renderHelp } from "../../../olt/scripts/src/cli/help.ts";
import {
  COMMAND_REGISTRY,
  INTERNAL_COMMANDS,
  PRIMARY_COMMANDS,
  PRIMARY_VERBS,
  commandTier,
  findCommand,
  getInternalCommands,
  getPrimaryCommands,
  isInternalCommand,
  isPrimaryCommand,
  type CommandSpec,
} from "../../../olt/scripts/src/cli/registry/index.ts";

const entrypoint = join(import.meta.dir, "..", "..", "..", "olt", "scripts", "harness.ts");

async function harness(args: readonly string[]) {
  const spawned = Bun.spawn(["bun", entrypoint, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    exit: await spawned.exited,
    stdout: await new Response(spawned.stdout).text(),
    stderr: await new Response(spawned.stderr).text(),
  };
}

describe("2-Tier CLI Surface Split (REMED-005)", () => {
  test("exposes exactly the 6 high-level primary verbs", () => {
    expect(PRIMARY_VERBS).toEqual(["plan", "queue", "task", "run", "doctor", "mind"]);
    expect(PRIMARY_VERBS.length).toBe(6);
  });

  test("classifies commands into primary vs internal tiers cleanly", () => {
    expect(PRIMARY_COMMANDS.length).toBeGreaterThan(0);
    expect(INTERNAL_COMMANDS.length).toBeGreaterThan(0);
    expect(PRIMARY_COMMANDS.length + INTERNAL_COMMANDS.length).toBe(COMMAND_REGISTRY.length);

    expect(getPrimaryCommands()).toEqual(PRIMARY_COMMANDS);
    expect(getInternalCommands()).toEqual(INTERNAL_COMMANDS);

    for (const spec of PRIMARY_COMMANDS) {
      expect(isPrimaryCommand(spec)).toBeTrue();
      expect(isInternalCommand(spec)).toBeFalse();
      expect(commandTier(spec)).toBe("primary");
    }

    for (const spec of INTERNAL_COMMANDS) {
      expect(isInternalCommand(spec)).toBeTrue();
      expect(isPrimaryCommand(spec)).toBeFalse();
      expect(commandTier(spec)).toBe("internal");
    }
  });

  test("correctly assigns known workflow commands to the primary tier", () => {
    const primaryNames = [
      "orchestrate",
      "plan:init",
      "plan:enhance",
      "plan:add",
      "plan:compile",
      "queue:next",
      "queue:wave",
      "task:claim",
      "task:submit",
      "run:exec",
      "run:status",
      "doctor",
      "doctor:repair",
      "mind:init",
      "mind:pulse",
    ];

    for (const name of primaryNames) {
      const spec = findCommand(name);
      expect(spec).toBeDefined();
      if (spec) {
        expect(commandTier(spec)).toBe("primary");
        expect(isPrimaryCommand(spec)).toBeTrue();
      }
    }
  });

  test("correctly assigns lower-level/diagnostic utilities to the internal tier", () => {
    const internalNames = [
      "agent:register",
      "agent:list",
      "authority:decide",
      "whoami",
      "branch:open",
      "branch:claim",
      "capture:init",
      "critic:review",
      "diagnostics",
      "defect:audit",
      "coverage:check",
      "health",
      "recover",
      "explain",
      "gate:prove",
      "finding:get",
      "install",
      "orchestrator:supervise",
      "orphan:dispose",
      "report",
      "summary:export",
      "coordinator:pushback",
    ];

    for (const name of internalNames) {
      const spec = findCommand(name);
      if (spec) {
        expect(commandTier(spec)).toBe("internal");
        expect(isInternalCommand(spec)).toBeTrue();
      }
    }
  });

  test("parses --internal in helpRequest across various invocations", () => {
    expect(helpRequest(["help"])).toEqual({ command: null });
    expect(helpRequest(["help", "--internal"])).toEqual({ command: null, internal: true });
    expect(helpRequest(["help", "-i"])).toEqual({ command: null, internal: true });
    expect(helpRequest(["help", "task:claim"])).toEqual({ command: "task:claim" });
    expect(helpRequest(["help", "task:claim", "--internal"])).toEqual({
      command: "task:claim",
      internal: true,
    });
    expect(helpRequest(["help", "--internal", "task:claim"])).toEqual({
      command: "task:claim",
      internal: true,
    });
    expect(helpRequest(["--help"])).toEqual({ command: null });
    expect(helpRequest(["--help", "--internal"])).toEqual({ command: null, internal: true });
    expect(helpRequest(["--internal", "--help"])).toEqual({ command: null, internal: true });
    expect(helpRequest(["--internal"])).toEqual({ command: null, internal: true });
    expect(helpRequest(["task:claim", "--help"])).toEqual({ command: "task:claim" });
    expect(helpRequest(["task:claim", "--help", "--internal"])).toEqual({
      command: "task:claim",
      internal: true,
    });
  });

  test("renders default overview presenting only the clean 2-tier primary surface", () => {
    const overview = renderHelp(null);
    const lines = overview.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toBe("### Harness CLI");

    for (const verb of PRIMARY_VERBS) {
      expect(overview).toContain(`| ${verb} |`);
    }

    expect(overview).not.toContain("| authority |");
    expect(overview).not.toContain("| branch |");
    expect(overview).not.toContain("| orphan |");
    expect(overview).not.toContain("| capture |");
    expect(overview).not.toContain("| critic |");

    expect(overview).toContain(
      "Pass `--internal` to view lower-level internal and diagnostic commands.",
    );
  });

  test("renders internal tier overview when internal option is true", () => {
    const internalOverview = renderHelp(null, { internal: true });
    const lines = internalOverview.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toBe("### Harness CLI (Internal Tier)");

    const internalDomains = [
      "agent",
      "authority",
      "branch",
      "capture",
      "critic",
      "diagnostics",
      "gate",
      "inspection",
      "install",
      "orchestrator",
      "orphan",
      "reporting",
      "summary",
    ];
    for (const domain of internalDomains) {
      expect(internalOverview).toContain(`| ${domain} |`);
    }

    const boolOptionOverview = renderHelp(null, true);
    expect(boolOptionOverview).toBe(internalOverview);
  });

  test("renders tier metadata in individual command help", () => {
    const primaryHelp = renderHelp("task:claim");
    expect(primaryHelp).toContain("### `task:claim`");
    expect(primaryHelp).toContain("- **Domain**: task");
    expect(primaryHelp).toContain("- **Tier**: primary");

    const internalHelp = renderHelp("authority:decide");
    expect(internalHelp).toContain("### `authority:decide`");
    expect(internalHelp).toContain("- **Domain**: authority");
    expect(internalHelp).toContain("- **Tier**: internal");
  });

  test("dispatches help and --internal cleanly via CLI entrypoint", async () => {
    const primaryHelp = await harness(["help"]);
    expect(primaryHelp.exit).toBe(0);
    expect(primaryHelp.stdout).toContain("### Harness CLI");
    expect(primaryHelp.stdout).toContain("| plan |");
    expect(primaryHelp.stdout).toContain("| doctor |");
    expect(primaryHelp.stdout).not.toContain("| authority |");

    const internalHelp = await harness(["help", "--internal"]);
    expect(internalHelp.exit).toBe(0);
    expect(internalHelp.stdout).toContain("### Harness CLI (Internal Tier)");
    expect(internalHelp.stdout).toContain("| authority |");
    expect(internalHelp.stdout).toContain("| branch |");

    const bareInternalHelp = await harness(["--internal"]);
    expect(bareInternalHelp.exit).toBe(0);
    expect(bareInternalHelp.stdout).toContain("### Harness CLI (Internal Tier)");

    const flagInternalHelp = await harness(["--help", "--internal"]);
    expect(flagInternalHelp.exit).toBe(0);
    expect(flagInternalHelp.stdout).toContain("### Harness CLI (Internal Tier)");

    const commandDetail = await harness(["help", "task:claim"]);
    expect(commandDetail.exit).toBe(0);
    expect(commandDetail.stdout).toContain("- **Tier**: primary");

    const internalCommandDetail = await harness(["help", "orphan:dispose"]);
    expect(internalCommandDetail.exit).toBe(0);
    expect(internalCommandDetail.stdout).toContain("- **Tier**: internal");
  });

  test("custom/synthetic CommandSpec classification works with explicit tier flags and defaults", () => {
    const primarySpec: CommandSpec = {
      name: "custom:primary",
      aliases: [],
      domain: "plan",
      tier: "primary",
      summary: "custom primary",
      description: "custom primary",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [],
      examples: [],
      handler: () => ({ ok: true }),
    };
    expect(isPrimaryCommand(primarySpec)).toBeTrue();
    expect(isInternalCommand(primarySpec)).toBeFalse();
    expect(commandTier(primarySpec)).toBe("primary");

    const explicitInternalInPlanDomain: CommandSpec = {
      name: "plan:internal-helper",
      aliases: [],
      domain: "plan",
      internal: true,
      summary: "plan helper",
      description: "plan helper",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [],
      examples: [],
      handler: () => ({ ok: true }),
    };
    expect(isPrimaryCommand(explicitInternalInPlanDomain)).toBeFalse();
    expect(isInternalCommand(explicitInternalInPlanDomain)).toBeTrue();
    expect(commandTier(explicitInternalInPlanDomain)).toBe("internal");

    const doctorNamedSpec: CommandSpec = {
      name: "doctor:sub-check",
      aliases: [],
      domain: "diagnostics",
      summary: "doctor sub check",
      description: "doctor sub check",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [],
      examples: [],
      handler: () => ({ ok: true }),
    };
    expect(isPrimaryCommand(doctorNamedSpec)).toBeTrue();
    expect(commandTier(doctorNamedSpec)).toBe("primary");
  });
});
