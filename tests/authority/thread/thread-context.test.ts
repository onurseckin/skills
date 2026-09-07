import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  MAIN_THREAD_ADVISORY,
  TIER_NAMES,
} from "../../../olt/scripts/src/authority/thread/constants.ts";
import {
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
} from "../../../olt/scripts/src/authority/thread/context.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Thread Context & Execution Identification", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  it("detects host applications across various terminal and CLI indicators", () => {
    expect(detectHostApp({ CLAUDE_CODE_VERSION: "1.0.0" })).toBe("Claude Code");
    expect(detectHostApp({ CLAUDE_CLI: "1" })).toBe("Claude Code");
    expect(detectHostApp({ ANTIGRAVITY_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ GEMINI_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ ANTIGRAVITY_VERSION: "0.9.0" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ TERM_PROGRAM: "cursor" })).toBe("Cursor");
    expect(detectHostApp({ CURSOR_VERSION: "0.40.0" })).toBe("Cursor");
    expect(detectHostApp({ OPENCODE: "1" })).toBe("OpenCode");
    expect(detectHostApp({ OPENCODE_VERSION: "1.2.0" })).toBe("OpenCode");
    expect(detectHostApp({ CODEX: "1" })).toBe("Codex");
    expect(detectHostApp({ CODEX_VERSION: "0.5.0" })).toBe("Codex");
    expect(detectHostApp({ TERM_PROGRAM: "vscode" })).toBe("VSCode Terminal");
    expect(detectHostApp({})).toBe("Generic Host");
  });

  it("builds capabilities profiles with correct command taxonomy and tokenized tool grants", () => {
    const tier0Caps = buildCapabilitiesProfile(0, {
      GRANTED_TOOLS: "view_file, write_to_file, run_command",
      ENVIRONMENT_GRANTS: "grant_root, grant_network",
    });
    expect(tier0Caps.command_taxonomy).toBe("Full Root / All Permissions");
    expect(tier0Caps.tools).toEqual(["view_file", "write_to_file", "run_command"]);
    expect(tier0Caps.environment_grants).toEqual(["grant_root", "grant_network"]);

    const tier1Caps = buildCapabilitiesProfile(1, {});
    expect(tier1Caps.command_taxonomy).toBe("Orchestration / Delegation Only");
    expect(tier1Caps.tools).toEqual([]);
    expect(tier1Caps.environment_grants).toEqual([]);

    const tier2Caps = buildCapabilitiesProfile(2, {});
    expect(tier2Caps.command_taxonomy).toBe("Coordination / Dispatch Only");

    const tier3Caps = buildCapabilitiesProfile(3, {
      AVAILABLE_TOOLS: "view_file, replace_file_content",
      TOOL_GRANTS: "grant_workspace",
    });
    expect(tier3Caps.command_taxonomy).toBe("Implementation / Execution");
    expect(tier3Caps.tools).toEqual(["view_file", "replace_file_content"]);
    expect(tier3Caps.environment_grants).toEqual(["grant_workspace"]);
  });

  it("identifies interactive main thread execution and applies restrained compliance with advisory", () => {
    const context = identifyExecutionContext({
      pid: 12345,
      ppid: 1000,
      env: {
        INTERACTIVE_MAIN_THREAD: "1",
        CONVERSATION_ID: "conv-main-001",
      },
    });

    expect(context.pid).toBe(12345);
    expect(context.ppid).toBe(1000);
    expect(context.tier).toBe(0);
    expect(context.is_main_thread).toBe(true);
    expect(context.compliance_state).toBe("restrained");
    expect(context.advisory).toBe(MAIN_THREAD_ADVISORY);
    expect(context.tier_name).toBe("Main Interactive Agent Thread");
    expect(context.defect).toBeNull();
  });

  it("identifies subagent execution context as Tier 3 and compliant", () => {
    const context = identifyExecutionContext({
      pid: 23456,
      ppid: 12345,
      env: {
        HOST_SUBAGENT: "1",
        SUBAGENT_CONVERSATION_ID: "subagent-conv-777",
        SUBAGENT_ROLE: "implementer",
        HARNESS_AGENT_ID: "implementer_task-88",
      },
    });

    expect(context.pid).toBe(23456);
    expect(context.ppid).toBe(12345);
    expect(context.tier).toBe(3);
    expect(context.role).toBe("implementer");
    expect(context.agent_id).toBe("implementer_task-88");
    expect(context.is_main_thread).toBe(false);
    expect(context.compliance_state).toBe("compliant");
    expect(context.advisory).toBeNull();
    expect(context.tier_name).toBe(TIER_NAMES[3]);
  });

  it("traps main thread direct execution defect and records into virtual memory fs", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-context/defects";
    vfs.mkdirSync(sandbox, { recursive: true });
    vfs.mkdirSync(join(sandbox, ".olt"), { recursive: true });

    const context = identifyExecutionContext({
      pid: 9999,
      ppid: 1,
      isInteractiveMainThread: true,
      argv: ["bun", "test", "some-file.test.ts"],
      cwd: sandbox,
      runRoot: sandbox,
      recordDefectInTest: true,
    });

    expect(context.is_main_thread).toBe(true);
    expect(context.defect).not.toBeNull();
    expect(context.defect?.type).toBe("main_thread_direct_execution");
    expect(context.defect?.severity).toBe("critical");
    expect(context.defect?.context.matched_action).toBe("test");

    // Verify defect was appended to virtual file without touching physical disk
    const defectLogPath = join(sandbox, "defects.jsonl");
    expect(vfs.existsSync(defectLogPath)).toBe(true);
    const defectLines = vfs.readFileSync(defectLogPath, "utf-8").trim().split("\n");
    expect(defectLines.length).toBeGreaterThan(0);
    const logged = JSON.parse(defectLines[defectLines.length - 1]);
    expect(logged.id).toBe(context.defect?.id);
    expect(logged.type).toBe("main_thread_direct_execution");
  });

  it("formats comprehensive thread authority identification brief in markdown", () => {
    const context = identifyExecutionContext({
      pid: 4444,
      ppid: 2222,
      tier: 2,
      role: "coordinator",
      agentId: "coordinator_wave-3",
      env: {
        GRANTED_TOOLS: "view_file, send_message",
        ENVIRONMENT_GRANTS: "grant_subagent",
        ANTIGRAVITY_CLI: "1",
      },
    });

    const brief = formatThreadIdentificationBrief(context);
    expect(brief).toContain("### Thread Authority Identification (`whoami`)");
    expect(brief).toContain("- **PID / PPID**: `4444` / `2222`");
    expect(brief).toContain(`- **Execution Tier**: \`Tier 2\` (${TIER_NAMES[2]})`);
    expect(brief).toContain("- **Active Agent**: `coordinator_wave-3` (role: `coordinator`)");
    expect(brief).toContain("- **Compliance**: `COMPLIANT`");
    expect(brief).toContain("- **Host App**: `Antigravity/Gemini CLI`");
    expect(brief).toContain("- **Taxonomy**: `Coordination / Dispatch Only`");
    expect(brief).toContain("- **Tools**: view_file, send_message");
    expect(brief).toContain("- **Environment Grants**: grant_subagent");
  });

  it("resolves conflicting environment spoofing safely by enforcing restrained main thread boundary", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-context/spoofing";
    vfs.mkdirSync(sandbox, { recursive: true });

    // Payload spoofing both main thread and subagent indicators
    const context = identifyExecutionContext({
      pid: 8888,
      ppid: 1,
      env: {
        INTERACTIVE_MAIN_THREAD: "1",
        HOST_SUBAGENT: "1",
        SUBAGENT_ROLE: "implementer",
      },
      argv: ["node", "run:exec", "deploy.ts"],
      cwd: sandbox,
      runRoot: sandbox,
      recordDefectInTest: true,
    });

    // Interactive main thread indicator forces restrained compliance and defects on forbidden actions
    expect(context.is_main_thread).toBe(true);
    expect(context.compliance_state).toBe("restrained");
    expect(context.advisory).toBe(MAIN_THREAD_ADVISORY);
    expect(context.defect).not.toBeNull();
    expect(context.defect?.type).toBe("main_thread_direct_execution");
    expect(context.defect?.context.matched_action).toBe("run:exec");

    const defectsFile = join(sandbox, "defects.jsonl");
    expect(vfs.existsSync(defectsFile)).toBe(true);
    const lines = vfs.readFileSync(defectsFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  it("guarantees linearizable atomic sequential defect logging into VirtualMemoryFS", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-context/atomic-seq";
    vfs.mkdirSync(sandbox, { recursive: true });

    const actions = ["test", "write_to_file", "replace_file"];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      identifyExecutionContext({
        pid: 5000 + i,
        ppid: 1,
        isInteractiveMainThread: true,
        argv: ["bun", action],
        cwd: sandbox,
        runRoot: sandbox,
        recordDefectInTest: true,
      });
    }

    const defectsFile = join(sandbox, "defects.jsonl");
    expect(vfs.existsSync(defectsFile)).toBe(true);
    const lines = vfs.readFileSync(defectsFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    for (let i = 0; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      expect(parsed.type).toBe("main_thread_direct_execution");
      expect(parsed.context.matched_action).toBe(actions[i]);
      expect(parsed.pid).toBe(5000 + i);
    }
  });
});
