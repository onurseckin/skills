import { describe, it, expect } from "bun:test";
import {
  identifyExecutionContext,
  detectHostApp,
  buildCapabilitiesProfile,
  type HostProfile,
} from "../../../orchestrating-long-tasks/scripts/src/authority/thread-identifier";
import { whoamiCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/whoami";

describe("Agent Whoami Profiling Engine", () => {
  describe("detectHostApp", () => {
    it("should detect Claude Code", () => {
      expect(detectHostApp({ ["CLAUDE" + "_CLI"]: "1" })).toBe("Claude Code");
    });
    it("should detect Antigravity", () => {
      expect(detectHostApp({ ["ANTIGRAVITY" + "_CLI"]: "1" })).toBe("Antigravity/Gemini CLI");
    });
    it("should detect Cursor", () => {
      expect(detectHostApp({ TERM_PROGRAM: "cursor" })).toBe("Cursor");
    });
    it("should detect VSCode", () => {
      expect(detectHostApp({ TERM_PROGRAM: "vscode" })).toBe("VSCode Terminal");
    });
    it("should default to Generic Host", () => {
      expect(detectHostApp({})).toBe("Generic Host");
    });
  });

  describe("buildCapabilitiesProfile", () => {
    it("should set taxonomy based on tier", () => {
      expect(buildCapabilitiesProfile(0, {}).command_taxonomy).toBe("Full Root / All Permissions");
      expect(buildCapabilitiesProfile(1, {}).command_taxonomy).toBe("Orchestration / Delegation Only");
      expect(buildCapabilitiesProfile(2, {}).command_taxonomy).toBe("Coordination / Dispatch Only");
      expect(buildCapabilitiesProfile(3, {}).command_taxonomy).toBe("Implementation / Execution");
    });

    it("should parse tools and grants", () => {
      const capabilities = buildCapabilitiesProfile(3, {
        GRANTED_TOOLS: "bash, bun, git",
        ENVIRONMENT_GRANTS: "READ_ONLY",
      });
      expect(capabilities.tools).toEqual(["bash", "bun", "git"]);
      expect(capabilities.environment_grants).toEqual(["READ_ONLY"]);
    });
  });

  describe("identifyExecutionContext", () => {
    it("should extract tier, host app, runtime, and capabilities", () => {
      const context = identifyExecutionContext({
        env: {
          HARNESS_EXECUTION_TIER: "3",
          TERM_PROGRAM: "cursor",
          GRANTED_TOOLS: "npm, yarn",
        },
      });

      expect(context.tier).toBe(3);
      expect(context.host_profile.app_id).toBe("Cursor");
      expect(typeof context.host_profile.os_platform).toBe("string");
      expect(context.capabilities.tools).toEqual(["npm", "yarn"]);
      expect(context.capabilities.command_taxonomy).toBe("Implementation / Execution");
    });
  });

  describe("whoamiCommand", () => {
    it("should generate proper markdown and JSON output", () => {
      const result = whoamiCommand({
        agent: "worker-3",
        pid: 1234,
        ppid: 1,
      });

      expect(result.pid).toBe(1234);
      expect(result.agent_id).toBe("worker-3");
      
      const md = result.markdown as string;
      expect(md).toContain("### Thread Authority Identification");
      expect(md).toContain("PID / PPID");
      expect(md).toContain("Active Agent");
      expect(md).toContain("Host App");
      expect(md).toContain("OS Platform");
      expect(md).toContain("Runtime");
      expect(md).toContain("Taxonomy");

      const host = result.host_profile as unknown as HostProfile;
      expect(host.app_id).toBeDefined();
    });
  });
});
