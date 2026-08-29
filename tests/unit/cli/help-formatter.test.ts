import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  formatCommandHelp,
  formatCommandTable,
  formatDomainSummary,
  renderHelp,
} from "../../../olt/scripts/src/cli/help.ts";
import {
  DEFAULT_EXIT_CODES,
  PRIMARY_VERBS,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
} from "../../../olt/scripts/src/cli/registry/types.ts";

const SAMPLE_SPEC: CommandSpec = {
  name: "task:sample",
  aliases: ["sample"],
  domain: "task",
  tier: "primary",
  internal: false,
  summary: "Sample task command summary.",
  description: "Detailed description of the sample task command.",
  flags: [
    requiredFlag("id", "string", "Identifier of the task."),
    optionalFlag("timeout", "int", "Timeout in seconds.", 30),
    optionalFlag("verbose", "bool", "Enable verbose output."),
  ],
  readsStdin: true,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts task:sample --id task-1 --timeout 60"],
  handler: () => ({ ok: true }),
};

describe("CLI Help Formatter & Cowan Table Layout", () => {
  it("formatCommandTable formats headers and rows with Cowan markdown syntax", () => {
    const headers = ["Flag", "Type", "Required", "Default", "Description"];
    const rows = [
      ["`--id`", "string", "yes", "-", "Task ID"],
      ["`--timeout`", "int", "no", "`30`", "Timeout in seconds"],
    ];

    const tableLines = formatCommandTable(headers, rows);

    expect(tableLines.length).toBe(4);
    expect(tableLines[0]).toBe("| Flag | Type | Required | Default | Description |");
    expect(tableLines[1]).toBe("| :--- | :--- | :--- | :--- | :--- |");
    expect(tableLines[2]).toBe("| `--id` | string | yes | - | Task ID |");
    expect(tableLines[3]).toBe("| `--timeout` | int | no | `30` | Timeout in seconds |");
  });

  it("formatDomainSummary formats domain and command list row", () => {
    const row = formatDomainSummary("task", [
      "task:claim",
      "task:submit",
      "task:complete",
    ]);

    expect(row).toBe("| task | `task:claim`, `task:submit`, `task:complete` |");
  });

  it("formatDomainSummary supports CommandSpec array", () => {
    const row = formatDomainSummary("task", [SAMPLE_SPEC]);
    expect(row).toBe("| task | `task:sample` |");
  });

  it("formatCommandHelp formats rich command documentation", () => {
    const formatted = formatCommandHelp(SAMPLE_SPEC);

    expect(formatted).toContain("### `task:sample`");
    expect(formatted).toContain("Sample task command summary.");
    expect(formatted).toContain("Detailed description of the sample task command.");
    expect(formatted).toContain("- **Domain**: task");
    expect(formatted).toContain("- **Tier**: primary");
    expect(formatted).toContain("- **Aliases**: `sample`");
    expect(formatted).toContain("- **Stdin**: reads stdin when `--prompt-stdin` is set");
    expect(formatted).toContain("- **Arguments after `--`**: rejected");
    expect(formatted).toContain("| `--id` | string | yes | no | - | Identifier of the task. |");
    expect(formatted).toContain("| `--timeout` | int | no | no | `30` | Timeout in seconds. |");
    expect(formatted).toContain("| `--verbose` | bool | no | no | - | Enable verbose output. |");
    expect(formatted).toContain("**Exit codes**");
    expect(formatted).toContain("- `0`: SUCCESS");
    expect(formatted).toContain("**Examples**");
    expect(formatted).toContain("bun harness.ts task:sample --id task-1 --timeout 60");
  });

  it("formatCommandHelp accepts command name string and resolves from registry", () => {
    const formatted = formatCommandHelp("task:claim");

    expect(formatted).toContain("### `task:claim`");
    expect(formatted).toContain("- **Domain**: task");
    expect(formatted).toContain("- **Tier**: primary");
  });

  it("formatCommandHelp throws HarnessError for unknown command", () => {
    expect(() => formatCommandHelp("nonexistent:command")).toThrow(HarnessError);
  });

  it("renderHelp renders 2-tier primary overview with Cowan table bounds", () => {
    const overview = renderHelp(null);
    const lines = overview.split("\n");

    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toBe("### Harness CLI");

    for (const verb of PRIMARY_VERBS) {
      expect(overview).toContain(`| ${verb} |`);
    }

    expect(overview).toContain(
      "Pass `--internal` to view lower-level internal and diagnostic commands.",
    );
  });

  it("renderHelp renders internal tier overview when internal is true", () => {
    const internalOverview = renderHelp(null, { internal: true });
    const lines = internalOverview.split("\n");

    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toBe("### Harness CLI (Internal Tier)");
    expect(internalOverview).toContain("| agent |");
    expect(internalOverview).toContain("| authority |");
    expect(internalOverview).toContain("| branch |");
    expect(internalOverview).toContain("| critic |");
    expect(internalOverview).toContain("| diagnostics |");
  });
});
