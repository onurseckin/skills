import { installSkill } from "../../installer/install.ts";
import { installationStatus } from "../../installer/installation-status.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type Flags } from "../options.ts";

function clientNames(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export async function installCommand(flags: Flags): Promise<Record<string, unknown>> {
  const source = textFlag(flags, "source")!;
  const home = textFlag(flags, "home")!;
  const clients = clientNames(textFlag(flags, "clients")!);
  const result = await installSkill(source, home, clients);

  const lines = [
    `### Skill Installed`,
    `- **Destination**: \`${result.destination}\``,
    `- **Source Digest**: \`${result.digest}\``,
    `- **Clients**: ${clients.join(", ")}`,
    ...result.links.map((path) => `  - linked \`${path}\``),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    destination: result.destination,
    digest: result.digest,
    links: result.links,
    clients,
  };
}

export async function installationStatusCommand(flags: Flags): Promise<Record<string, unknown>> {
  const source = textFlag(flags, "source")!;
  const home = textFlag(flags, "home")!;
  const requested = textFlag(flags, "clients", false);
  const status = await installationStatus(
    source,
    home,
    requested === undefined ? undefined : clientNames(requested),
  );

  const lines = [
    `### Installation Status`,
    `- **Installed**: ${status.installed ? "yes" : "no"}`,
    `- **Drifted**: ${status.drifted ? "yes" : "no"}`,
    `- **Destination**: \`${status.destination}\``,
    ...Object.entries(status.links).map(
      ([client, target]) => `  - ${client}: ${target === null ? "missing" : `\`${target}\``}`,
    ),
    ...(status.issues.length > 0 ? ["- **Issues**:"] : []),
    ...status.issues.map((issue) => `  - ${issue}`),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    installed: status.installed,
    drifted: status.drifted,
    destination: status.destination,
    links: status.links,
    issues: status.issues,
  };
}
