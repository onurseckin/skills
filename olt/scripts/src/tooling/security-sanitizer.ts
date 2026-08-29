import { isAbsolute, normalize, resolve } from "node:path";
import type {
  SanitizationPolicyType,
  SanitizationResult,
  SecurityViolation,
  ToolSecurityPolicy,
} from "./types.ts";

const SHELL_INJECTION_PATTERN = /[;&|`$><\n\r]/;
const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DANGEROUS_HTML_PATTERN = /<\s*script[^>]*>|javascript\s*:|data\s*:\s*text\/html|on\w+\s*=/i;

export function sanitizeShellArgument(arg: string): string {
  if (!arg) return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function detectCommandInjection(input: string): SecurityViolation | null {
  if (SHELL_INJECTION_PATTERN.test(input)) {
    return {
      field: "shell_argument",
      threatType: "COMMAND_INJECTION",
      message: "Potential command injection characters detected in shell argument",
      rawValue: input,
    };
  }
  return null;
}

export function sanitizePathTraversal(
  pathStr: string,
  allowedRoots?: readonly string[],
): { readonly safePath: string | null; readonly violation?: SecurityViolation } {
  if (pathStr.includes("\0")) {
    return {
      safePath: null,
      violation: {
        field: "path",
        threatType: "NULL_BYTE_INJECTION",
        message: "Null byte detected in file path",
        rawValue: pathStr,
      },
    };
  }

  const normalized = normalize(pathStr);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return {
      safePath: null,
      violation: {
        field: "path",
        threatType: "PATH_TRAVERSAL",
        message: "Path traversal attempt detected with parent directory references",
        rawValue: pathStr,
      },
    };
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const resolvedPath = resolve(pathStr);
    const isAllowed = allowedRoots.some((root) => {
      const resolvedRoot = resolve(root);
      return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
    });
    if (!isAllowed) {
      return {
        safePath: null,
        violation: {
          field: "path",
          threatType: "PATH_TRAVERSAL",
          message: `Path '${pathStr}' is outside allowed directories: ${allowedRoots.join(", ")}`,
          rawValue: pathStr,
        },
      };
    }
  }

  return { safePath: normalized };
}

export function detectPrototypePollution(
  value: unknown,
  currentDepth = 0,
  maxDepth = 20,
): SecurityViolation | null {
  if (currentDepth > maxDepth) {
    return {
      field: "depth",
      threatType: "PAYLOAD_TOO_LARGE",
      message: `Object nesting depth exceeds maximum allowed depth of ${maxDepth}`,
    };
  }
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const v = detectPrototypePollution(item, currentDepth + 1, maxDepth);
      if (v) return v;
    }
    return null;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      return {
        field: key,
        threatType: "PROTOTYPE_POLLUTION",
        message: `Dangerous prototype property '${key}' detected in payload`,
        rawValue: key,
      };
    }
    const nestedViolation = detectPrototypePollution(obj[key], currentDepth + 1, maxDepth);
    if (nestedViolation) return nestedViolation;
  }

  return null;
}

export function sanitizeHtmlContent(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

export function sanitizeValueByPolicy(
  value: unknown,
  policy: SanitizationPolicyType,
): unknown {
  if (typeof value !== "string") return value;

  switch (policy) {
    case "strict-alphanumeric":
      return value.replace(/[^a-zA-Z0-9_-]/g, "");
    case "path": {
      const res = sanitizePathTraversal(value);
      return res.safePath ?? value.replace(/\.\./g, "");
    }
    case "shell-arg":
      return sanitizeShellArgument(value);
    case "html-escape":
      return sanitizeHtmlContent(value);
    case "json-safe":
      return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    default:
      return value;
  }
}

export function sanitizeToolInput(
  args: Record<string, unknown>,
  policy: ToolSecurityPolicy = {},
): SanitizationResult {
  const violations: SecurityViolation[] = [];
  const maxDepth = policy.maxDepth ?? 20;
  const maxStringLength = policy.maxStringLength ?? 1_000_000;
  const maxArrayLength = policy.maxArrayLength ?? 10_000;

  const protoViolation = detectPrototypePollution(args, 0, maxDepth);
  if (protoViolation && policy.preventPrototypePollution !== false) {
    violations.push(protoViolation);
  }

  function sanitizeRecursive(val: unknown, path: string, depth: number): unknown {
    if (depth > maxDepth) return val;
    if (val === null || val === undefined) return val;

    if (typeof val === "string") {
      if (val.includes("\0")) {
        violations.push({
          field: path,
          threatType: "NULL_BYTE_INJECTION",
          message: "Null byte detected in string value",
          rawValue: val,
        });
      }
      if (val.length > maxStringLength) {
        violations.push({
          field: path,
          threatType: "PAYLOAD_TOO_LARGE",
          message: `String length ${val.length} exceeds maximum limit of ${maxStringLength}`,
          rawValue: val.slice(0, 100),
        });
      }
      if (policy.allowShellExecution === false) {
        const shellV = detectCommandInjection(val);
        if (shellV) violations.push({ ...shellV, field: path });
      }
      if (policy.stripUnsafeHtml && DANGEROUS_HTML_PATTERN.test(val)) {
        violations.push({
          field: path,
          threatType: "XSS_OR_SCRIPT_INJECTION",
          message: "Dangerous script or HTML construct detected",
          rawValue: val,
        });
      }
      if (policy.blockedPatterns) {
        for (const pattern of policy.blockedPatterns) {
          const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
          if (regex.test(val)) {
            violations.push({
              field: path,
              threatType: "FORBIDDEN_PATTERN",
              message: `Value matches forbidden security pattern '${String(pattern)}'`,
              rawValue: val,
            });
          }
        }
      }
      return val;
    }

    if (Array.isArray(val)) {
      if (val.length > maxArrayLength) {
        violations.push({
          field: path,
          threatType: "PAYLOAD_TOO_LARGE",
          message: `Array length ${val.length} exceeds maximum allowed elements ${maxArrayLength}`,
        });
      }
      return val.map((item, idx) => sanitizeRecursive(item, `${path}[${idx}]`, depth + 1));
    }

    if (typeof val === "object") {
      const res: Record<string, unknown> = {};
      const obj = val as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(k)) continue;
        res[k] = sanitizeRecursive(v, `${path}.${k}`, depth + 1);
      }
      return res;
    }

    return val;
  }

  const sanitized = sanitizeRecursive(args, "root", 0) as Record<string, unknown>;

  return {
    valid: violations.length === 0,
    safe: violations.length === 0,
    errors: violations.map((v) => v.message ?? "Security violation"),
    violations,
    sanitized,
  };
}

export function isSafeExecutionPayload(
  args: Record<string, unknown>,
  policy: ToolSecurityPolicy = {},
): boolean {
  return sanitizeToolInput(args, policy).safe;
}
