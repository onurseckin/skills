// @ts-nocheck
import type {
  QuarantineCategory,
  ToolDescriptor,
  ToolInvocationContext,
  OpticalQuarantineInvariant,
} from "./types.ts";

export const PERMITTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".gif",
]);

/**
 * Explicitly blocked source code extensions for view_file
 */
export const FORBIDDEN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".lock",
  ".env",
  ".py",
  ".rs",
  ".go",
  ".c",
  ".cpp",
  ".h",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".astro",
  ".md",
  ".mdx",
  ".sql",
  ".graphql",
  ".proto",
]);

/**
 * Base lists of authorized tool names for UI Optical Validator
 */
export const AUTHORIZED_BROWSER_TOOLS: ReadonlySet<string> = new Set([
  "click",
  "fill",
  "fill_form",
  "hover",
  "press_key",
  "type_text",
  "navigate_page",
  "take_screenshot",
  "take_snapshot",
  "resize_page",
  "wait_for",
  "list_pages",
  "select_page",
  "new_page",
  "close_page",
  "handle_dialog",
  "emulate",
  "drag",
  "upload_file",
  "get_console_message",
  "list_console_messages",
  "get_network_request",
  "list_network_requests",
  "evaluate_script", // Subject to strict runtime backdoor parameter inspection
  "mcp_chrome-devtools_click",
  "mcp_chrome-devtools_fill",
  "mcp_chrome-devtools_fill_form",
  "mcp_chrome-devtools_hover",
  "mcp_chrome-devtools_press_key",
  "mcp_chrome-devtools_type_text",
  "mcp_chrome-devtools_navigate_page",
  "mcp_chrome-devtools_take_screenshot",
  "mcp_chrome-devtools_take_snapshot",
  "mcp_chrome-devtools_resize_page",
  "mcp_chrome-devtools_wait_for",
  "mcp_chrome-devtools_list_pages",
  "mcp_chrome-devtools_select_page",
  "mcp_chrome-devtools_new_page",
  "mcp_chrome-devtools_close_page",
  "mcp_chrome-devtools_handle_dialog",
  "mcp_chrome-devtools_emulate",
  "mcp_chrome-devtools_drag",
  "mcp_chrome-devtools_upload_file",
  "mcp_chrome-devtools_get_console_message",
  "mcp_chrome-devtools_list_console_messages",
  "mcp_chrome-devtools_get_network_request",
  "mcp_chrome-devtools_list_network_requests",
  "mcp_chrome-devtools_evaluate_script",
]);

export const AUTHORIZED_VISUAL_TOOLS: ReadonlySet<string> = new Set([
  "view_file", // Subject to image-extension and path-safety inspection
  "evidence:screenshots",
  "evidence:get",
  "finding:get",
  "report:get",
]);

export const AUTHORIZED_MESSAGING_TOOLS: ReadonlySet<string> = new Set([
  "msg:send",
  "msg:recv",
  "msg:poll",
  "task:brief",
  "task:validate-start",
  "task:probe",
  "task:reject",
  "task:review",
  "agent:register",
  "agent:report",
  "agent:release",
  "whoami",
  "doctor:verify",
]);

/**
 * Explicitly forbidden tools for UI Optical Validator
 */
export const FORBIDDEN_TOOLS: ReadonlyMap<string, QuarantineCategory> = new Map([
  // Source Editing
  ["replace_file_content", "FORBIDDEN_SOURCE_EDITING"],
  ["write_to_file", "FORBIDDEN_SOURCE_EDITING"],
  ["notebook_edit", "FORBIDDEN_SOURCE_EDITING"],
  ["patch_file", "FORBIDDEN_SOURCE_EDITING"],
  ["edit_file", "FORBIDDEN_SOURCE_EDITING"],
  ["append_to_file", "FORBIDDEN_SOURCE_EDITING"],

  // Command Execution
  ["run_command", "FORBIDDEN_COMMAND_EXECUTION"],
  ["run:exec", "FORBIDDEN_COMMAND_EXECUTION"],
  ["shell", "FORBIDDEN_COMMAND_EXECUTION"],
  ["exec", "FORBIDDEN_COMMAND_EXECUTION"],
  ["terminal", "FORBIDDEN_COMMAND_EXECUTION"],
  ["bash", "FORBIDDEN_COMMAND_EXECUTION"],
  ["zsh", "FORBIDDEN_COMMAND_EXECUTION"],
  ["manage_task", "FORBIDDEN_COMMAND_EXECUTION"],

  // Directory Listing
  ["list_dir", "FORBIDDEN_DIRECTORY_LISTING"],
  ["list_directory", "FORBIDDEN_DIRECTORY_LISTING"],
  ["ls", "FORBIDDEN_DIRECTORY_LISTING"],

  // Pattern Searching & Code Navigation
  ["grep_search", "FORBIDDEN_PATTERN_SEARCHING"],
  ["find_by_name", "FORBIDDEN_PATTERN_SEARCHING"],
  ["search_web", "FORBIDDEN_PATTERN_SEARCHING"],
  ["semantic_search", "FORBIDDEN_PATTERN_SEARCHING"],

  // Code Reading via external fetches
  ["read_url_content", "FORBIDDEN_SOURCE_READING"],
  ["API-retrieve-page-markdown", "FORBIDDEN_SOURCE_READING"],
  ["read_resource", "FORBIDDEN_SOURCE_READING"],
  ["list_resources", "FORBIDDEN_SOURCE_READING"],

  // Subagent Spawning
  ["invoke_subagent", "FORBIDDEN_SUBAGENT_SPAWNING"],
  ["spawn_agent", "FORBIDDEN_SUBAGENT_SPAWNING"],
  ["send_message", "FORBIDDEN_SUBAGENT_SPAWNING"], // Native host bypass forbidden; mailbox IPC must be used
]);

/**
 * Tool descriptor object representation
 */
export interface ToolDescriptor {
  readonly name: string;
  readonly description?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
}

/**
 * Invocation context for runtime validation
 */
export interface ToolInvocationContext {
  readonly agentId: string;
  readonly role: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly timestamp?: string | undefined;
  readonly callId?: string | undefined;
}

/**
 * Result of capability check
 */
export interface QuarantineCheckResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly category: QuarantineCategory;
  readonly violations: readonly string[];
}

/**
 * Result of backdoor bypass detection
 */
export interface BackdoorDetectionResult {
  readonly detected: boolean;
  readonly severity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly vector?: string | undefined;
  readonly description?: string | undefined;
  readonly matchedPattern?: string | undefined;
}

/**
 * Result of runtime boundary enforcement
 */
export interface QuarantineEnforcementResult {
  readonly action: "ALLOW" | "BLOCK" | "STRIP" | "TERMINATE";
  readonly reason: string;
  readonly bypassAttempt?: BackdoorDetectionResult | undefined;
  readonly violationInvariant?: OpticalQuarantineInvariant | undefined;
}

/**
 * Audit log entry for quarantined tool calls
 */
export interface QuarantineAuditRecord {
  readonly callId: string;
  readonly agentId: string;
  readonly role: string;
  readonly toolName: string;
  readonly timestamp: string;
  readonly decision: "ALLOWED" | "BLOCKED";
  readonly category: QuarantineCategory;
  readonly bypassDetected: boolean;
  readonly details?: string | undefined;
  readonly violationInvariant?: OpticalQuarantineInvariant | undefined;
}

/**
 * Helper to determine if a given role is an optical cognitive validator
 */
export function isOpticalValidatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "ui-optical-validator" ||
    norm === "ui-validator" ||
    norm === "optical-validator" ||
    norm === "cognitive-ui-validator" ||
    norm === "ui-optical-cognitive-validator" ||
    norm === "ui-cognitive-validator"
  );
}

/**
 * Backdoor inspection regex patterns
 */
