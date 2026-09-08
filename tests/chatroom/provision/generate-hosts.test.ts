import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  ProvisionError,
  type SupportedHost,
} from "../../../chatroom/scripts/src/provision/detect.ts";
import {
  generateCommunicator,
  generateCommunicatorAgent,
  resolveDisplayTitle,
  type GenerateCommunicatorOptions,
} from "../../../chatroom/scripts/src/provision/generate.ts";
import {
  cleanupVirtualChatroomFS,
  setupVirtualChatroomFS,
  type VirtualChatroomContext,
} from "../helpers.ts";

interface AntigravityAgentConfig {
  readonly name: string;
  readonly role: string;
  readonly TypeName: string;
  readonly Role: string;
  readonly model: string;
  readonly thinking: string;
  readonly dispatch: {
    readonly tool: string;
    readonly subagent_type_default: string;
    readonly workspace: string;
  };
  readonly instructions: string;
}

describe("generateCommunicator host provisioning", () => {
  let context: VirtualChatroomContext;
  let vfs: VirtualChatroomContext["vfs"];
  const fakeHome = "/virtual/home";
  const fakeRepo = "/virtual/repo";

  beforeEach(() => {
    context = setupVirtualChatroomFS();
    vfs = context.vfs;
    vfs.mkdirSync(fakeHome, { recursive: true });
    vfs.mkdirSync(fakeRepo, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualChatroomFS();
  });

  describe("canonical host artifact generation", () => {
    it("generates valid antigravity json config in home directory", () => {
      const opts: GenerateCommunicatorOptions = {
        host: "antigravity",
        room: "eng-team",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      };
      const result = generateCommunicator(opts);
      const expectedPath = join(fakeHome, ".antigravity", "agents", "communicator-eng-team.json");

      expect(result.agentName).toBe("communicator_eng-team");
      expect(result.artifactPath).toBe(expectedPath);
      expect(vfs.existsSync(expectedPath)).toBe(true);

      const raw = vfs.readFileSync(expectedPath, "utf8");
      const parsed = JSON.parse(raw) as AntigravityAgentConfig;

      expect(parsed.name).toBe("communicator_eng-team");
      expect(parsed.role).toBe("Eng Team Communicator");
      expect(parsed.TypeName).toBe("communicator_eng-team");
      expect(parsed.Role).toBe("Eng Team Communicator");
      expect(parsed.model).toBe("gemini-3.7-flash");
      expect(parsed.thinking).toBe("medium");
      expect(parsed.dispatch.tool).toBe("invoke_subagent");
      expect(parsed.dispatch.subagent_type_default).toBe("self");
      expect(parsed.dispatch.workspace).toBe("inherit");
      expect(parsed.instructions).toContain(
        "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.",
      );
      expect(parsed.instructions).toContain("Zero task execution, zero file edits.");
      expect(parsed.instructions).toContain(
        "Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
      );
    });

    it("generates valid claude_code markdown with frontmatter in repo root", () => {
      const opts: GenerateCommunicatorOptions = {
        host: "claude_code",
        room: "ops_pipeline",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      };
      const result = generateCommunicator(opts);
      const expectedPath = join(fakeRepo, ".claude", "agents", "communicator-ops_pipeline.md");

      expect(result.agentName).toBe("communicator_ops_pipeline");
      expect(result.artifactPath).toBe(expectedPath);
      expect(vfs.existsSync(expectedPath)).toBe(true);

      const content = vfs.readFileSync(expectedPath, "utf8");
      expect(content).toContain("---");
      expect(content).toContain("name: communicator_ops_pipeline");
      expect(content).toContain("model: claude-5-sonnet");
      expect(content).toContain("tools:");
      expect(content).toContain("  - Bash");
      expect(content).toContain("  - SendMessage");
      expect(content).toContain("# Ops Pipeline Communicator");
      expect(content).toContain("TypeName: communicator_ops_pipeline");
      expect(content).toContain("Role: Ops Pipeline Communicator");
      expect(content).toContain(
        "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.",
      );
      expect(content).toContain(
        "Zero task execution, zero file edits, zero test runs, zero git commands.",
      );
      expect(content).toContain(
        "Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
      );
      expect(content).toContain("Latency budget: <= 30 seconds per action.");
    });

    it("generates valid codex toml agent config in home directory", () => {
      const opts: GenerateCommunicatorOptions = {
        host: "codex",
        room: "arch.core",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      };
      const result = generateCommunicator(opts);
      const expectedPath = join(fakeHome, ".codex", "agents", "communicator-arch.core.toml");

      expect(result.agentName).toBe("communicator_arch.core");
      expect(result.artifactPath).toBe(expectedPath);
      expect(vfs.existsSync(expectedPath)).toBe(true);

      const content = vfs.readFileSync(expectedPath, "utf8");
      expect(content).toContain("[agent]");
      expect(content).toContain('name = "communicator_arch.core"');
      expect(content).toContain('role = "Arch Core Communicator"');
      expect(content).toContain('TypeName = "communicator_arch.core"');
      expect(content).toContain('Role = "Arch Core Communicator"');
      expect(content).toContain('model = "gpt-5.6-terra"');
      expect(content).toContain('reasoning_effort = "medium"');
      expect(content).toContain(
        'instructions = "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.',
      );
      expect(content).toContain(
        "Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise.",
      );
    });

    it("generates valid cursor markdown agent config in home directory", () => {
      const opts: GenerateCommunicatorOptions = {
        host: "cursor",
        room: "ui-dev",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      };
      const result = generateCommunicator(opts);
      const expectedPath = join(fakeHome, ".cursor", "agents", "communicator-ui-dev.md");

      expect(result.agentName).toBe("communicator_ui-dev");
      expect(result.artifactPath).toBe(expectedPath);
      expect(vfs.existsSync(expectedPath)).toBe(true);

      const content = vfs.readFileSync(expectedPath, "utf8");
      expect(content).toContain("---");
      expect(content).toContain("name: communicator_ui-dev");
      expect(content).toContain("model: cursor-latest");
      expect(content).toContain("# Ui Dev Communicator");
      expect(content).toContain("TypeName: communicator_ui-dev");
      expect(content).toContain("Role: Ui Dev Communicator");
      expect(content).toContain(
        "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack.",
      );
      expect(content).toContain(
        "Zero task execution, zero file edits, zero test runs, zero git commands.",
      );
      expect(content).toContain("Latency budget: <= 30 seconds per action.");
    });
  });

  describe("resolveDisplayTitle and title options", () => {
    it("formats hyphenated, underscored, and dot-separated room names", () => {
      expect(resolveDisplayTitle("alpha-beta-gamma")).toBe("Alpha Beta Gamma");
      expect(resolveDisplayTitle("release_candidate_one")).toBe("Release Candidate One");
      expect(resolveDisplayTitle("service.auth.prod")).toBe("Service Auth Prod");
      expect(resolveDisplayTitle("mixed-case_dots.here")).toBe("Mixed Case Dots Here");
      expect(resolveDisplayTitle("single")).toBe("Single");
    });

    it("preserves custom titles and trims surrounding whitespace", () => {
      expect(resolveDisplayTitle("room-name", "Custom Title")).toBe("Custom Title");
      expect(resolveDisplayTitle("room-name", "   Spaced Title   ")).toBe("Spaced Title");
    });

    it("falls back to formatted room name when title is empty or whitespace", () => {
      expect(resolveDisplayTitle("fallback-room", "")).toBe("Fallback Room");
      expect(resolveDisplayTitle("fallback-room", "    ")).toBe("Fallback Room");
      expect(resolveDisplayTitle("fallback-room", undefined)).toBe("Fallback Room");
    });

    it("applies custom title to generated agent definitions across hosts", () => {
      const result = generateCommunicator({
        host: "antigravity",
        room: "custom-test",
        title: "Mission Controller",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const content = vfs.readFileSync(result.artifactPath, "utf8");
      const parsed = JSON.parse(content) as AntigravityAgentConfig;
      expect(parsed.role).toBe("Mission Controller Communicator");
      expect(parsed.Role).toBe("Mission Controller Communicator");
    });
  });

  describe("alias and default path resolution", () => {
    it("exposes generateCommunicator as alias to generateCommunicatorAgent", () => {
      expect(generateCommunicator).toBe(generateCommunicatorAgent);
    });

    it("uses default homedir and cwd when homeDir and repoRoot are omitted", () => {
      const result = generateCommunicator({
        host: "antigravity",
        room: "default-paths",
      });
      expect(result.agentName).toBe("communicator_default-paths");
      expect(result.artifactPath).toContain(".antigravity/agents/communicator-default-paths.json");
      expect(vfs.existsSync(result.artifactPath)).toBe(true);
    });

    it("overwrites existing artifact cleanly when regenerated", () => {
      const first = generateCommunicator({
        host: "codex",
        room: "overwrite-test",
        title: "Initial Title",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const firstContent = vfs.readFileSync(first.artifactPath, "utf8");
      expect(firstContent).toContain("Initial Title Communicator");

      const second = generateCommunicator({
        host: "codex",
        room: "overwrite-test",
        title: "Updated Title",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const secondContent = vfs.readFileSync(second.artifactPath, "utf8");
      expect(secondContent).toContain("Updated Title Communicator");
      expect(first.artifactPath).toBe(second.artifactPath);
    });
  });

  describe("error handling and edge cases", () => {
    it("throws ProvisionError when an unsupported host is provided", () => {
      const invalidHost = "unknown_host" as unknown as SupportedHost;
      let thrownError: unknown = null;
      try {
        generateCommunicator({
          host: invalidHost,
          room: "fail-room",
          homeDir: fakeHome,
          repoRoot: fakeRepo,
        });
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError instanceof ProvisionError).toBe(true);
      const provErr = thrownError as ProvisionError;
      expect(provErr.code).toBe("UNSUPPORTED_HOST");
      expect(provErr.message).toContain("Unsupported host: unknown_host");
    });

    it("throws ProvisionError when room is empty or whitespace-only", () => {
      let emptyRoomError: unknown = null;
      try {
        generateCommunicator({
          host: "cursor",
          room: "",
          homeDir: fakeHome,
          repoRoot: fakeRepo,
        });
      } catch (err) {
        emptyRoomError = err;
      }
      expect(emptyRoomError instanceof ProvisionError).toBe(true);
      expect((emptyRoomError as ProvisionError).code).toBe("INVALID_ROOM");

      let whitespaceRoomError: unknown = null;
      try {
        generateCommunicator({
          host: "cursor",
          room: "   ",
          homeDir: fakeHome,
          repoRoot: fakeRepo,
        });
      } catch (err) {
        whitespaceRoomError = err;
      }
      expect(whitespaceRoomError instanceof ProvisionError).toBe(true);
      expect((whitespaceRoomError as ProvisionError).code).toBe("INVALID_ROOM");
    });
  });

  describe("vacuity and host discriminator assertions", () => {
    it("differentiates model identifiers and artifact locations across all 4 hosts", () => {
      const resAgy = generateCommunicator({
        host: "antigravity",
        room: "diff-test",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const resClaude = generateCommunicator({
        host: "claude_code",
        room: "diff-test",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const resCodex = generateCommunicator({
        host: "codex",
        room: "diff-test",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });
      const resCursor = generateCommunicator({
        host: "cursor",
        room: "diff-test",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });

      const paths = new Set([
        resAgy.artifactPath,
        resClaude.artifactPath,
        resCodex.artifactPath,
        resCursor.artifactPath,
      ]);
      expect(paths.size).toBe(4);

      const agyContent = vfs.readFileSync(resAgy.artifactPath, "utf8");
      const claudeContent = vfs.readFileSync(resClaude.artifactPath, "utf8");
      const codexContent = vfs.readFileSync(resCodex.artifactPath, "utf8");
      const cursorContent = vfs.readFileSync(resCursor.artifactPath, "utf8");

      expect(agyContent).toContain("gemini-3.7-flash");
      expect(claudeContent).toContain("claude-5-sonnet");
      expect(codexContent).toContain("gpt-5.6-terra");
      expect(cursorContent).toContain("cursor-latest");

      expect(claudeContent).toContain("- Bash");
      expect(cursorContent.includes("- Bash")).toBe(false);
    });

    it("proves artifact is absent before generation and present after generation", () => {
      const targetPath = join(fakeHome, ".antigravity", "agents", "communicator-before-after.json");
      expect(vfs.existsSync(targetPath)).toBe(false);

      generateCommunicator({
        host: "antigravity",
        room: "before-after",
        homeDir: fakeHome,
        repoRoot: fakeRepo,
      });

      expect(vfs.existsSync(targetPath)).toBe(true);
    });
  });
});
