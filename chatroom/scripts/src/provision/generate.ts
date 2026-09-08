import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ProvisionError, type SupportedHost } from "./detect.ts";

export interface GenerateCommunicatorOptions {
  readonly host: SupportedHost;
  readonly room: string;
  readonly title?: string;
  readonly homeDir?: string;
  readonly repoRoot?: string;
}

export interface GenerateCommunicatorResult {
  readonly agentName: string;
  readonly artifactPath: string;
}

function resolveDisplayTitle(room: string, title?: string): string {
  if (title && title.trim().length > 0) {
    return title.trim();
  }
  return room
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function generateAntigravityArtifact(
  agentName: string,
  displayTitle: string,
  artifactPath: string,
): void {
  const content = JSON.stringify(
    {
      name: agentName,
      role: `${displayTitle} Communicator`,
      TypeName: agentName,
      Role: `${displayTitle} Communicator`,
      model: "gemini-3.7-flash",
      thinking: "medium",
      dispatch: {
        tool: "invoke_subagent",
        subagent_type_default: "self",
        workspace: "inherit",
      },
      instructions:
        "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack. Zero task execution, zero file edits. Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
    },
    null,
    2,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, content + "\n", "utf8");
}

function generateClaudeArtifact(
  agentName: string,
  displayTitle: string,
  artifactPath: string,
): void {
  const lines = [
    "---",
    `name: ${agentName}`,
    "model: claude-5-sonnet",
    "tools:",
    "  - Bash",
    "  - SendMessage",
    "---",
    "",
    `# ${displayTitle} Communicator`,
    "",
    `TypeName: ${agentName}`,
    `Role: ${displayTitle} Communicator`,
    "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.",
    "Zero task execution, zero file edits, zero test runs, zero git commands.",
    "Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
    "Latency budget: <= 30 seconds per action.",
    "",
  ];
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, lines.join("\n"), "utf8");
}

function generateCodexArtifact(
  agentName: string,
  displayTitle: string,
  artifactPath: string,
): void {
  const lines = [
    "[agent]",
    `name = "${agentName}"`,
    `role = "${displayTitle} Communicator"`,
    `TypeName = "${agentName}"`,
    `Role = "${displayTitle} Communicator"`,
    'model = "gpt-5.6-terra"',
    'reasoning_effort = "medium"',
    'instructions = "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack. Zero task execution, zero file edits. Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise."',
    "",
  ];
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, lines.join("\n"), "utf8");
}

function generateCursorArtifact(
  agentName: string,
  displayTitle: string,
  artifactPath: string,
): void {
  const lines = [
    "---",
    `name: ${agentName}`,
    "model: cursor-latest",
    "---",
    "",
    `# ${displayTitle} Communicator`,
    "",
    `TypeName: ${agentName}`,
    `Role: ${displayTitle} Communicator`,
    "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.",
    "Zero task execution, zero file edits, zero test runs, zero git commands.",
    "Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
    "Latency budget: <= 30 seconds per action.",
    "",
  ];
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, lines.join("\n"), "utf8");
}

export function generateCommunicatorAgent(
  options: GenerateCommunicatorOptions,
): GenerateCommunicatorResult {
  if (!options.room || options.room.trim().length === 0) {
    throw new ProvisionError("INVALID_ROOM", "Room name must be a non-empty string");
  }
  const home = options.homeDir ?? homedir();
  const repo = options.repoRoot ?? process.cwd();
  const agentName = `communicator_${options.room}`;
  const displayTitle = resolveDisplayTitle(options.room, options.title);

  let artifactPath = "";
  if (options.host === "antigravity") {
    artifactPath = join(home, ".antigravity", "agents", `communicator-${options.room}.json`);
    generateAntigravityArtifact(agentName, displayTitle, artifactPath);
  } else if (options.host === "claude_code") {
    artifactPath = join(repo, ".claude", "agents", `communicator-${options.room}.md`);
    generateClaudeArtifact(agentName, displayTitle, artifactPath);
  } else if (options.host === "codex") {
    artifactPath = join(home, ".codex", "agents", `communicator-${options.room}.toml`);
    generateCodexArtifact(agentName, displayTitle, artifactPath);
  } else if (options.host === "cursor") {
    artifactPath = join(home, ".cursor", "agents", `communicator-${options.room}.md`);
    generateCursorArtifact(agentName, displayTitle, artifactPath);
  } else {
    throw new ProvisionError("UNSUPPORTED_HOST", `Unsupported host: ${String(options.host)}`);
  }

  return { agentName, artifactPath };
}

export const generateCommunicator = generateCommunicatorAgent;
export { resolveDisplayTitle };
