export {
  linuxLibcCandidates,
  libraryCandidates,
  tryExclusiveFlock,
  releaseFlock,
  loadBindings,
} from "./fs/flock-ffi.ts";

export {
  withRunLock,
  type RunLockOptions,
  clearObserver,
  publishObserver,
} from "./process/run-lock.ts";
export {
  buildAgentRegisterCommand,
  buildTaskClaimCommand,
  buildTaskHeartbeatCommand,
  buildTaskSubmitCommand,
  buildMandatoryCliSequence,
  verifyAgentRegistration,
  assertAgentRegistered,
  type CliRegistrationOptions,
} from "./process/cli-registration.ts";
export { ANTIGRAVITY_CAPABILITIES, AntigravityHostAdapter } from "./host/antigravity.ts";
export { CHATGPT_CAPABILITIES, ChatGptHostAdapter } from "./host/chatgpt.ts";
export { CLAUDE_CODE_CAPABILITIES, ClaudeCodeHostAdapter } from "./host/claude-code.ts";
export { CODEX_CAPABILITIES, CodexHostAdapter } from "./host/codex.ts";
export { CURSOR_CAPABILITIES, CursorHostAdapter } from "./host/cursor.ts";
export {
  getHostAdapter,
  listSupportedHostProviders,
  listHostCapabilities,
  resolveHostProvider,
  dispatchSubagent,
} from "./host/host-adapter-registry.ts";
export { HOST_PROVIDERS, isHostProvider } from "./host/types.ts";
export type {
  HostProvider,
  WorkspaceIsolationMode,
  HostCapabilities,
  SubagentDispatchPacket,
  MechanicalDispatchResult,
  CognitiveFallbackPromptResult,
  DispatchResult,
  MandatoryCliActionSequence,
  UnfulfilledDemandItem,
  UnfulfilledDemandPushbackReport,
  HostAdapter,
} from "./host/types.ts";
export {
  evaluateUnfulfilledDemands,
  assertNoUnfulfilledDemands,
} from "./host/unfulfilled-demand.ts";
export type { UnfulfilledDemandEvaluationOptions } from "./host/unfulfilled-demand.ts";
export {
  CODE_EDIT_TOOL_NAMES_BY_HOST,
  CODE_EDIT_TOOLS,
  isCodeEditTool,
} from "./host/code-edit-tools.ts";
export { detectActiveHost, CANONICAL_HOST_TYPES, isHostType } from "./host-autodetect.ts";
export type { HostType } from "./host-autodetect.ts";
