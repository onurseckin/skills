import type { QuarantineCategory } from "./types.ts";

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
  ".txt",
  ".log",
  ".sql",
  ".prisma",
  ".graphql",
  ".gql",
]);

/**
 * Whitelist of authorized browser-use tools
 */
export const AUTHORIZED_BROWSER_TOOLS: ReadonlySet<string> = new Set([
  // Core Navigation & Viewport
  "navigate_page",
  "take_screenshot",
  "take_snapshot",
  "resize_page",
  "select_page",
  "list_pages",
  "new_page",
  "close_page",
  "handle_dialog",
  "emulate",

  // Interaction (Pure User-level actions)
  "click",
  "fill",
  "fill_form",
  "type_text",
  "press_key",
  "hover",
  "drag",
  "upload_file",

  // Observation & Auditing
  "get_console_message",
  "list_console_messages",
  "get_network_request",
  "list_network_requests",
  "performance_start_trace",
  "performance_stop_trace",
  "performance_analyze_insight",
  "lighthouse_audit",

  // Safe client-side DOM evaluation
  "evaluate_script",

  // Native prefixed tool aliases
  "chrome-devtools:click",
  "chrome-devtools:fill",
  "chrome-devtools:fill_form",
  "chrome-devtools:hover",
  "chrome-devtools:press_key",
  "chrome-devtools:type_text",
  "chrome-devtools:take_screenshot",
  "chrome-devtools:take_snapshot",
  "chrome-devtools:navigate_page",
  "chrome-devtools:resize_page",
  "chrome-devtools:select_page",
  "chrome-devtools:list_pages",
  "chrome-devtools:new_page",
  "chrome-devtools:close_page",
  "chrome-devtools:handle_dialog",
  "chrome-devtools:emulate",
  "chrome-devtools:drag",
  "chrome-devtools:upload_file",
  "chrome-devtools:get_console_message",
  "chrome-devtools:list_console_messages",
  "chrome-devtools:get_network_request",
  "chrome-devtools:list_network_requests",
  "chrome-devtools:performance_start_trace",
  "chrome-devtools:performance_stop_trace",
  "chrome-devtools:performance_analyze_insight",
  "chrome-devtools:lighthouse_audit",
  "chrome-devtools:evaluate_script",

  // MCP format aliases
  "mcp_chrome-devtools_click",
  "mcp_chrome-devtools_fill",
  "mcp_chrome-devtools_fill_form",
  "mcp_chrome-devtools_hover",
  "mcp_chrome-devtools_press_key",
  "mcp_chrome-devtools_type_text",
  "mcp_chrome-devtools_take_screenshot",
  "mcp_chrome-devtools_take_snapshot",
  "mcp_chrome-devtools_navigate_page",
  "mcp_chrome-devtools_resize_page",
  "mcp_chrome-devtools_select_page",
  "mcp_chrome-devtools_list_pages",
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
  "view_file",
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
  ["send_message", "FORBIDDEN_SUBAGENT_SPAWNING"],
]);
