import { extname } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  ToolDescriptor,
  ToolInvocationContext,
  QuarantineCheckResult,
  BackdoorDetectionResult,
} from "./types.ts";
import {
  AUTHORIZED_BROWSER_TOOLS,
  AUTHORIZED_VISUAL_TOOLS,
  AUTHORIZED_MESSAGING_TOOLS,
  FORBIDDEN_TOOLS,
  PERMITTED_IMAGE_EXTENSIONS,
  FORBIDDEN_SOURCE_EXTENSIONS,
} from "./constants.ts";
import {
  EVALUATE_SCRIPT_HOST_FS_PATTERNS,
  SHELL_INJECTION_PATTERNS,
  LOCAL_URL_BYPASS_PATTERNS,
} from "./patterns.ts";

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

export function verifyCapability(
  toolName: string,
  role = "ui-optical-validator",
): QuarantineCheckResult {
  const norm = toolName.trim();

  if (!isOpticalValidatorRole(role)) {
    return {
      allowed: true,
      reason: `Role '${role}' is not subject to optical tool quarantine.`,
      category: "AUTHORIZED_OPTICAL_VISUAL",
      violations: [],
    };
  }

  // Check explicit forbidden map
  const forbiddenCategory = FORBIDDEN_TOOLS.get(norm);
  if (forbiddenCategory) {
    return {
      allowed: false,
      reason: `Tool '${norm}' is forbidden for UI Optical Validator under category ${forbiddenCategory}.`,
      category: forbiddenCategory,
      violations: [
        forbiddenCategory === "FORBIDDEN_COMMAND_EXECUTION"
          ? "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"
          : forbiddenCategory === "FORBIDDEN_SOURCE_EDITING"
            ? "ZERO_SOURCE_EDITS"
            : forbiddenCategory === "FORBIDDEN_SOURCE_READING"
              ? "ZERO_SOURCE_READS"
              : forbiddenCategory === "FORBIDDEN_DIRECTORY_LISTING"
                ? "ZERO_DIRECTORY_LISTINGS"
                : "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK",
      ],
    };
  }

  // Check forbidden prefixes/patterns
  if (
    norm.startsWith("run_") ||
    norm.startsWith("exec_") ||
    norm.startsWith("shell_") ||
    norm.startsWith("terminal_") ||
    norm.includes("command")
  ) {
    return {
      allowed: false,
      reason: `Command execution tool '${norm}' violates COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK.`,
      category: "FORBIDDEN_COMMAND_EXECUTION",
      violations: ["COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK"],
    };
  }

  if (
    norm.startsWith("write_") ||
    norm.startsWith("replace_") ||
    norm.startsWith("edit_") ||
    norm.startsWith("patch_")
  ) {
    return {
      allowed: false,
      reason: `Source mutation tool '${norm}' violates ZERO_SOURCE_EDITS.`,
      category: "FORBIDDEN_SOURCE_EDITING",
      violations: ["ZERO_SOURCE_EDITS"],
    };
  }

  if (
    norm.startsWith("list_") &&
    !AUTHORIZED_BROWSER_TOOLS.has(norm) &&
    !AUTHORIZED_VISUAL_TOOLS.has(norm)
  ) {
    return {
      allowed: false,
      reason: `Directory listing tool '${norm}' violates ZERO_DIRECTORY_LISTINGS.`,
      category: "FORBIDDEN_DIRECTORY_LISTING",
      violations: ["ZERO_DIRECTORY_LISTINGS"],
    };
  }

  if (norm.startsWith("grep_") || norm.startsWith("search_") || norm.startsWith("find_")) {
    return {
      allowed: false,
      reason: `Pattern search tool '${norm}' violates ZERO_SOURCE_READS.`,
      category: "FORBIDDEN_PATTERN_SEARCHING",
      violations: ["ZERO_SOURCE_READS"],
    };
  }

  // Check authorized sets
  if (
    AUTHORIZED_BROWSER_TOOLS.has(norm) ||
    norm.startsWith("chrome-devtools:") ||
    norm.startsWith("mcp_chrome-devtools_")
  ) {
    return {
      allowed: true,
      reason: `Browser interaction tool '${norm}' is authorized for optical validation.`,
      category: "AUTHORIZED_BROWSER_INTERACTION",
      violations: [],
    };
  }

  if (AUTHORIZED_VISUAL_TOOLS.has(norm) || norm.startsWith("evidence:")) {
    return {
      allowed: true,
      reason: `Visual inspection tool '${norm}' is authorized for optical validation.`,
      category: "AUTHORIZED_OPTICAL_VISUAL",
      violations: [],
    };
  }

  if (
    AUTHORIZED_MESSAGING_TOOLS.has(norm) ||
    norm.startsWith("msg:") ||
    norm.startsWith("task:") ||
    norm.startsWith("agent:")
  ) {
    return {
      allowed: true,
      reason: `Messaging & coordination tool '${norm}' is authorized for optical validation.`,
      category: "AUTHORIZED_MESSAGING_COORDINATION",
      violations: [],
    };
  }

  // Unknown tools default to blocked for cognitive safety
  return {
    allowed: false,
    reason: `Unrecognized tool '${norm}' is blocked by default under optical quarantine.`,
    category: "FORBIDDEN_SOURCE_READING",
    violations: ["ZERO_SOURCE_READS"],
  };
}

/**
 * Detect potential backdoor bypass vectors in tool invocation arguments
 */

export function detectBackdoorBypass(
  toolName: string,
  args: Record<string, unknown>,
): BackdoorDetectionResult {
  const normTool = toolName.trim();

  // 1. Inspect evaluate_script
  if (
    normTool === "evaluate_script" ||
    normTool === "mcp_chrome-devtools_evaluate_script" ||
    normTool.endsWith("evaluate_script")
  ) {
    const scriptArg = args.script ?? args.expression ?? args.code ?? args.functionDeclaration;
    if (typeof scriptArg === "string") {
      for (const pattern of EVALUATE_SCRIPT_HOST_FS_PATTERNS) {
        if (pattern.test(scriptArg)) {
          return {
            detected: true,
            severity: "CRITICAL",
            vector: "EVALUATE_SCRIPT_HOST_FS_OR_PROCESS_ESCAPE",
            description: `Backdoor attempt detected in evaluate_script: script matches dangerous host/process access pattern ${pattern.source}`,
            matchedPattern: pattern.source,
          };
        }
      }
    }
  }

  // 2. Inspect navigate_page or URL-based parameters
  const urlArg = args.url ?? args.Url ?? args.targetUrl ?? args.uri ?? args.href;
  if (typeof urlArg === "string") {
    const trimmedUrl = urlArg.trim();
    for (const pattern of LOCAL_URL_BYPASS_PATTERNS) {
      if (pattern.test(trimmedUrl)) {
        return {
          detected: true,
          severity: "CRITICAL",
          vector: "LOCAL_FILESYSTEM_OR_DATA_URL_BYPASS",
          description: `Backdoor attempt detected in navigation URL: '${trimmedUrl}' attempts local filesystem or pseudoprotocol access.`,
          matchedPattern: pattern.source,
        };
      }
    }
  }

  // 3. Inspect view_file target path and extension
  if (normTool === "view_file" || normTool.endsWith("view_file")) {
    const filePath =
      args.AbsolutePath ?? args.absolutePath ?? args.path ?? args.targetFile ?? args.filePath;
    if (typeof filePath === "string") {
      const ext = extname(filePath).toLowerCase();

      // Check if explicitly forbidden source code
      if (FORBIDDEN_SOURCE_EXTENSIONS.has(ext)) {
        return {
          detected: true,
          severity: "HIGH",
          vector: "SOURCE_CODE_READ_ATTEMPT_VIA_VIEW_FILE",
          description: `Attempt to inspect source code file '${filePath}' (extension '${ext}') via view_file. Optical validators may only view screenshot image artifacts.`,
          matchedPattern: ext,
        };
      }

      // Must match permitted image extension if not empty
      if (ext.length > 0 && !PERMITTED_IMAGE_EXTENSIONS.has(ext)) {
        return {
          detected: true,
          severity: "MEDIUM",
          vector: "NON_IMAGE_ARTIFACT_VIEW_ATTEMPT",
          description: `File '${filePath}' has non-image extension '${ext}'. Optical review is restricted to image screenshots (.png, .jpg, .webp, .svg).`,
          matchedPattern: ext,
        };
      }
    }
  }

  // 4. Inspect all string arguments for shell injection meta-characters
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === "string") {
      for (const pattern of SHELL_INJECTION_PATTERNS) {
        if (pattern.test(val)) {
          return {
            detected: true,
            severity: "CRITICAL",
            vector: "SHELL_INJECTION_IN_ARGUMENT",
            description: `Backdoor attempt detected in parameter '${key}': contains shell command injection pattern ${pattern.source}`,
            matchedPattern: pattern.source,
          };
        }
      }
    }
  }

  return {
    detected: false,
    severity: "NONE",
  };
}

/**
 * Enforce runtime boundary on a specific tool invocation
 */
