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
      parameterName: "shell_argument",
      field: "shell_argument",
      threatType: "COMMAND_INJECTION",
      violationType: "command-injection",
      message: "Potential command injection characters detected in shell argument",
      details: "Potential command injection characters detected in shell argument",
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
        parameterName: "path",
        field: "path",
        threatType: "NULL_BYTE_INJECTION",
        violationType: "unsafe-characters",
        message: "Null byte detected in file path",
        details: "Null byte detected in file path",
        rawValue: pathStr,
      },
    };
  }

  const normalized = normalize(pathStr);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return {
      safePath: null,
      violation: {
        parameterName: "path",
        field: "path",
        threatType: "PATH_TRAVERSAL",
        violationType: "path-traversal",
        message: "Path traversal attempt detected with parent directory references",
        details: "Path traversal attempt detected with parent directory references",
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
          parameterName: "path",
          field: "path",
          threatType: "PATH_TRAVERSAL",
          violationType: "path-traversal",
          message: `Path '${pathStr}' is outside allowed directories: ${allowedRoots.join(", ")}`,
          details: `Path '${pathStr}' is outside allowed directories: ${allowedRoots.join(", ")}`,
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
      parameterName: "depth",
      field: "depth",
      threatType: "PAYLOAD_TOO_LARGE",
      violationType: "policy-violation",
      message: `Object nesting depth exceeds maximum allowed depth of ${maxDepth}`,
      details: `Object nesting depth exceeds maximum allowed depth of ${maxDepth}`,
      rawValue: currentDepth,
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
        parameterName: key,
        field: key,
        threatType: "PROTOTYPE_POLLUTION",
        violationType: "prototype-pollution",
        message: `Dangerous prototype property '${key}' detected in payload`,
        details: `Dangerous prototype property '${key}' detected in payload`,
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
          parameterName: path,
          field: path,
          threatType: "NULL_BYTE_INJECTION",
          violationType: "unsafe-characters",
          message: "Null byte detected in string value",
          details: "Null byte detected in string value",
          rawValue: val,
        });
      }
      if (val.length > maxStringLength) {
        violations.push({
          parameterName: path,
          field: path,
          threatType: "PAYLOAD_TOO_LARGE",
          violationType: "policy-violation",
          message: `String length ${val.length} exceeds maximum limit of ${maxStringLength}`,
          details: `String length ${val.length} exceeds maximum limit of ${maxStringLength}`,
          rawValue: val.slice(0, 100),
        });
      }
      if (policy.allowShellExecution === false) {
        const shellV = detectCommandInjection(val);
        if (shellV) violations.push({ ...shellV, parameterName: path, field: path });
      }
      if (policy.stripUnsafeHtml && DANGEROUS_HTML_PATTERN.test(val)) {
        violations.push({
          parameterName: path,
          field: path,
          threatType: "XSS_OR_SCRIPT_INJECTION",
          violationType: "unsafe-characters",
          message: "Dangerous script or HTML construct detected",
          details: "Dangerous script or HTML construct detected",
          rawValue: val,
        });
      }
      if (policy.blockedPatterns) {
        for (const pattern of policy.blockedPatterns) {
          const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
          if (regex.test(val)) {
            violations.push({
              parameterName: path,
              field: path,
              threatType: "FORBIDDEN_PATTERN",
              violationType: "policy-violation",
              message: `Value matches forbidden security pattern '${String(pattern)}'`,
              details: `Value matches forbidden security pattern '${String(pattern)}'`,
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
          parameterName: path,
          field: path,
          threatType: "PAYLOAD_TOO_LARGE",
          violationType: "policy-violation",
          message: `Array length ${val.length} exceeds maximum allowed elements ${maxArrayLength}`,
          details: `Array length ${val.length} exceeds maximum allowed elements ${maxArrayLength}`,
          rawValue: val.length,
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
    errors: violations.map((v) => ({
      field: v.field ?? v.parameterName,
      message: v.message ?? v.details ?? "Security violation",
      code: v.threatType ?? v.violationType ?? "SECURITY_VIOLATION",
    })),
    violations,
    sanitized,
    sanitizedPayload: sanitized,
  };
}

export function isSafeExecutionPayload(
  args: Record<string, unknown>,
  policy: ToolSecurityPolicy = {},
): boolean {
  return sanitizeToolInput(args, policy).safe;
}
