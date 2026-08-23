import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { MINIMUM_BUN_VERSION } from "../config/constants.ts";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { verifyCapsuleDeep, verifyIntegrity } from "../engine/store/index.ts";
import { verifyStrictRepositoryCapsuleRoot } from "./capsule-root.ts";
import { verifyUnifiedEvidenceLocation } from "./evidence-location.ts";
import { auditTierConfinement } from "./tier-confinement.ts";

export type MutationKind =
  | "syntax_error"
  | "assertion_flip"
  | "return_override"
  | "empty_file"
  | "exception_injection"
  | "custom";

export interface CounterfactualMutation {
  readonly id: string;
  readonly filePath: string;
  readonly mutationKind: MutationKind;
  readonly originalContent: string;
  readonly mutatedContent: string;
  readonly appliedAt: string;
  readonly description: string;
}

export interface MutateScopeResult {
  readonly mutation: CounterfactualMutation;
  readonly revert: () => void;
}

export interface MutationOptions {
  readonly kind?: MutationKind;
  readonly customMutator?: (content: string) => string;
  readonly description?: string;
  readonly now?: string | number | Date;
}

export interface AdversarialCheckResult {
  readonly checkId: string;
  readonly name: string;
  readonly targetPath: string;
  readonly passed: boolean;
  readonly falsified: boolean;
  readonly baselinePassed: boolean;
  readonly mutation?: CounterfactualMutation | undefined;
  readonly output?: string | undefined;
  readonly exitCode?: number | null | undefined;
  readonly durationMs?: number | undefined;
  readonly message?: string | undefined;
  readonly error?: string | undefined;
}

export type HealthCheckCategory =
  | "bun_version"
  | "capsule_root"
  | "evidence_location"
  | "tier_confinement"
  | "integrity"
  | "git_status"
  | "adversarial_falsifiability"
  | "custom";

export type HealthCheckStatus = "pass" | "fail" | "warn";

export interface HarnessHealthCheck {
  readonly name: string;
  readonly category: HealthCheckCategory;
  readonly status: HealthCheckStatus;
  readonly passed: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly remediation?: string | undefined;
}

export interface DoctorCertificationReport {
  readonly certified: boolean;
  readonly runRoot: string;
  readonly certifiedAt: string;
  readonly bunVersion: string;
  readonly bunSupported: boolean;
  readonly healthChecks: readonly HarnessHealthCheck[];
  readonly adversarialChecks: readonly AdversarialCheckResult[];
  readonly totalChecks: number;
  readonly passedChecks: number;
  readonly failedChecks: number;
  readonly criticalIssues: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: string;
  readonly markdown: string;
}

export interface AdversarialCheckOptions {
  readonly checkName?: string;
  readonly mutationKind?: MutationKind;
  readonly customMutator?: (content: string) => string;
  readonly timeoutMs?: number;
  readonly testRunner?: (
    filePath: string,
  ) =>
    | Promise<{ success: boolean; output?: string; exitCode?: number }>
    | { success: boolean; output?: string; exitCode?: number };
  readonly testCommand?: readonly string[];
  readonly cwd?: string;
}

export interface DoctorDiagnosticOptions {
  readonly runRoot?: string;
  readonly state?: Record<string, unknown> | null;
  readonly repoRoot?: string;
  readonly checkTierConfinement?: boolean;
  readonly checkCapsuleRoot?: boolean;
  readonly checkUnifiedEvidence?: boolean;
  readonly checkBunVersion?: boolean;
  readonly checkIntegrity?: boolean;
  readonly minimumBunVersion?: string;
  readonly customChecks?: readonly (() => HarnessHealthCheck | Promise<HarnessHealthCheck>)[];
}

export interface DoctorCertificationOptions extends DoctorDiagnosticOptions {
  readonly writeScope?: readonly string[];
  readonly adversarialTestRunner?: (
    filePath: string,
  ) =>
    | Promise<{ success: boolean; output?: string; exitCode?: number }>
    | { success: boolean; output?: string; exitCode?: number };
  readonly runAdversarialChecks?: boolean;
  readonly mutationKind?: MutationKind;
  readonly now?: string | number | Date;
}

export function compareSemver(actual: string, minimum: string): boolean {
  const left = actual.split("./").map((part) => Number.parseInt(part, 10));
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const leftVal = left[i];
    const rightVal = right[i];
    const l = typeof leftVal === "number" && !Number.isNaN(leftVal) ? leftVal : 0;
    const r = typeof rightVal === "number" && !Number.isNaN(rightVal) ? rightVal : 0;
    if (l !== r) {
      return l > r;
    }
  }
  return true;
}

function parseIsoTimestamp(input?: string | number | Date): string {
  if (typeof input === "number") {
    return new Date(input).toISOString();
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Applies a counterfactual mutation to a file within write scope and provides a deterministic revert mechanism.
 */
export function mutateWriteScopeForCounterfactual(
  filePath: string,
  options: MutationOptions = {},
): MutateScopeResult {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "File path for counterfactual mutation must be a non-empty string",
    );
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Target file for counterfactual mutation does not exist: "${resolvedPath}"`,
    );
  }

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Target path for counterfactual mutation is not a regular file: "${resolvedPath}"`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to inspect target file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let originalContent: string;
  try {
    originalContent = readFileSync(resolvedPath, "utf-8");
  } catch (err: unknown) {
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to read target file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const kind: MutationKind = options.kind !== undefined ? options.kind : "syntax_error";
  let mutatedContent: string;

  switch (kind) {
    case "syntax_error":
      mutatedContent = `${originalContent}\n\n/* HARNESS ADVERSARIAL SYNTAX ERROR INJECTION */\n>>> INJECTED_ADVERSARIAL_SYNTAX_ERROR <<<\n`;
      break;

    case "assertion_flip": {
      let replaced = false;
      const patterns: Record<string, string> = {
        "toBe(true)": "toBe(false)",
        "toBe(false)": "toBe(true)",
        "toBeTrue()": "toBeFalse()",
        "toBeFalse()": "toBeTrue()",
        "=== true": "=== false",
        "=== false": "=== true",
        "!== true": "!== false",
        "!== false": "!== true",
      };
      const regex =
        /toBe\(true\)|toBe\(false\)|toBeTrue\(\)|toBeFalse\(\)|=== true|=== false|!== true|!== false/g;
      let temp = originalContent.replace(regex, (match) => {
        replaced = true;
        const mapped = patterns[match];
        return typeof mapped === "string" ? mapped : match;
      });

      if (!replaced) {
        temp = `${originalContent}\n\n/* HARNESS ADVERSARIAL ASSERTION FLIP */\nthrow new Error("HARNESS_ADVERSARIAL_ASSERTION_FLIP: Test assertion failure injected");\n`;
      }
      mutatedContent = temp;
      break;
    }

    case "return_override":
      mutatedContent = `/* HARNESS ADVERSARIAL RETURN OVERRIDE */\nthrow new Error("HARNESS_ADVERSARIAL_RETURN_OVERRIDE: Function execution halted");\n${originalContent}`;
      break;

    case "empty_file":
      mutatedContent = "";
      break;

    case "exception_injection":
      mutatedContent = `/* HARNESS ADVERSARIAL EXCEPTION INJECTION */\nthrow new Error("HARNESS_ADVERSARIAL_EXCEPTION: Diagnostic probe failure");\n${originalContent}`;
      break;

    case "custom":
      if (typeof options.customMutator !== "function") {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "Custom mutator function required when mutation kind is 'custom'",
        );
      }
      mutatedContent = options.customMutator(originalContent);
      break;

    default: {
      const exhaustiveCheck: never = kind;
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Unsupported mutation kind: ${String(exhaustiveCheck)}`,
      );
    }
  }

  try {
    writeFileSync(resolvedPath, mutatedContent, "utf-8");
  } catch (err: unknown) {
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to write mutated content to "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const mutationId = `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const appliedAt = parseIsoTimestamp(options.now);
  const description =
    typeof options.description === "string" && options.description.length > 0
      ? options.description
      : `Counterfactual mutation (${kind}) applied to ${basename(resolvedPath)}`;

  const mutation: CounterfactualMutation = {
    id: mutationId,
    filePath: resolvedPath,
    mutationKind: kind,
    originalContent,
    mutatedContent,
    appliedAt,
    description,
  };

  const revert = (): void => {
    try {
      writeFileSync(resolvedPath, originalContent, "utf-8");
    } catch (err: unknown) {
      throw new HarnessError(
        "INVALID_STATE",
        `Failed to revert counterfactual mutation on "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return { mutation, revert };
}

/**
 * Runs an adversarial counterfactual check against a target file or gate test.
 * Confirms that the test suite passes on original code (baseline) AND fails when mutated (falsifiable).
 */
export async function runAdversarialCounterfactualCheck(
  targetPath: string,
  options: AdversarialCheckOptions = {},
): Promise<AdversarialCheckResult> {
  const checkId = `adv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const resolvedPath = resolve(targetPath);
  const name =
    typeof options.checkName === "string" && options.checkName.length > 0
      ? options.checkName
      : `adversarial-falsifiability-${basename(resolvedPath)}`;
  const startTime = Date.now();

  if (!existsSync(resolvedPath)) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      message: `Target path does not exist: "${resolvedPath}"`,
      error: `File not found: ${resolvedPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  const cwd =
    typeof options.cwd === "string" && options.cwd.length > 0 ? options.cwd : process.cwd();

  const executeTest = async (
    path: string,
  ): Promise<{ success: boolean; output?: string; exitCode?: number }> => {
    if (typeof options.testRunner === "function") {
      return await options.testRunner(path);
    }

    if (Array.isArray(options.testCommand) && options.testCommand.length > 0) {
      try {
        const cmd = options.testCommand[0];
        const args = options.testCommand.slice(1);
        if (!cmd) {
          return { success: false, output: "Empty test command", exitCode: 1 };
        }
        const proc = spawnSync(cmd, args, {
          cwd,
          encoding: "utf-8",
        });
        const stdoutText = proc.stdout ? String(proc.stdout) : "";
        const stderrText = proc.stderr ? String(proc.stderr) : "";
        const combinedOutput = `${stdoutText}\n${stderrText}`.trim();
        return {
          success: proc.status === 0,
          output: combinedOutput,
          exitCode: proc.status ?? (proc.error ? 1 : 0),
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    }

    // Default test execution: if file is a test file, run bun test
    if (path.endsWith(".test.ts") || path.endsWith(".spec.ts")) {
      try {
        const proc = spawnSync("bun", ["test", path], {
          cwd,
          encoding: "utf-8",
        });
        const stdoutText = proc.stdout ? String(proc.stdout) : "";
        const stderrText = proc.stderr ? String(proc.stderr) : "";
        const combinedOutput = `${stdoutText}\n${stderrText}`.trim();
        return {
          success: proc.status === 0,
          output: combinedOutput,
          exitCode: proc.status ?? (proc.error ? 1 : 0),
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    }

    return {
      success: true,
      output: "No test runner configured; baseline assumed clean",
      exitCode: 0,
    };
  };

  // Step 1: Run baseline test runner on pristine code
  let baselineResult: { success: boolean; output?: string; exitCode?: number };
  try {
    baselineResult = await executeTest(resolvedPath);
  } catch (err: unknown) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      message: `Baseline test execution threw an error before mutation: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }

  if (!baselineResult.success) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      output: baselineResult.output,
      exitCode: baselineResult.exitCode,
      message:
        "Baseline test failed before adversarial mutation was applied; target is currently failing",
      durationMs: Date.now() - startTime,
    };
  }

  // Step 2: Apply counterfactual mutation and assert falsifiability
  let mutation: CounterfactualMutation | undefined;
  let revertFn: (() => void) | undefined;
  let mutatedTestResult: { success: boolean; output?: string; exitCode?: number };

  try {
    const mutationKind: MutationKind =
      options.mutationKind !== undefined ? options.mutationKind : "syntax_error";
    const mutResult = mutateWriteScopeForCounterfactual(resolvedPath, {
      kind: mutationKind,
      ...(options.customMutator !== undefined ? { customMutator: options.customMutator } : {}),
    });
    mutation = mutResult.mutation;
    revertFn = mutResult.revert;

    mutatedTestResult = await executeTest(resolvedPath);
  } catch (err: unknown) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: true,
      mutation,
      message: `Error occurred while executing adversarial mutation test: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (revertFn) {
      try {
        revertFn();
      } catch (err: unknown) {
        // Critical: Failed to revert mutation!
        throw new HarnessError(
          "INVALID_STATE",
          `CRITICAL: Failed to revert counterfactual mutation on "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const falsified = !mutatedTestResult.success;
  const passed = baselineResult.success && falsified;
  const message = falsified
    ? `Adversarial counterfactual check passed: Test gate detected injected defect (${mutation.mutationKind}) and failed as expected`
    : `Adversarial counterfactual check failed: Test gate passed despite injected defect (${mutation.mutationKind}); gate is not falsifiable`;

  return {
    checkId,
    name,
    targetPath: resolvedPath,
    passed,
    falsified,
    baselinePassed: true,
    mutation,
    output: mutatedTestResult.output,
    exitCode: mutatedTestResult.exitCode,
    message,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Runs comprehensive doctor diagnostics on the harness environment.
 */
export async function runDoctorDiagnostics(
  options: DoctorDiagnosticOptions = {},
): Promise<readonly HarnessHealthCheck[]> {
  const checks: HarnessHealthCheck[] = [];

  // 1. Bun Runtime Version Check
  if (options.checkBunVersion !== false) {
    const minVersion =
      typeof options.minimumBunVersion === "string" && options.minimumBunVersion.length > 0
        ? options.minimumBunVersion
        : MINIMUM_BUN_VERSION;
    const isSupported = compareSemver(Bun.version, minVersion);
    if (isSupported) {
      checks.push({
        name: "bun_runtime_version",
        category: "bun_version",
        status: "pass",
        passed: true,
        message: `Bun version ${Bun.version} satisfies minimum requirement (>= ${minVersion})`,
        details: { currentVersion: Bun.version, minimumVersion: minVersion },
      });
    } else {
      checks.push({
        name: "bun_runtime_version",
        category: "bun_version",
        status: "fail",
        passed: false,
        message: `Bun version ${Bun.version} is below minimum requirement (${minVersion})`,
        details: { currentVersion: Bun.version, minimumVersion: minVersion },
        remediation: `Upgrade Bun to version ${minVersion} or newer`,
      });
    }
  }

  // 2. Capsule Root Confinement Check
  if (
    options.checkCapsuleRoot !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0
  ) {
    try {
      const rootAudit = verifyStrictRepositoryCapsuleRoot(options.runRoot, options.repoRoot);
      if (rootAudit.valid) {
        checks.push({
          name: "capsule_root_confinement",
          category: "capsule_root",
          status: "pass",
          passed: true,
          message: "Capsule root resides strictly under repository root .capsules/",
          details: { runRoot: rootAudit.runRoot, repoRoot: rootAudit.repoRoot },
        });
      } else {
        checks.push({
          name: "capsule_root_confinement",
          category: "capsule_root",
          status: "fail",
          passed: false,
          message: rootAudit.issues.join("; "),
          details: {
            misplacedCapsules: rootAudit.misplacedCapsules,
            issues: rootAudit.issues,
          },
          remediation:
            "Ensure run capsules are stored exclusively at <repo-root>/.capsules/<run-id>",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "capsule_root_confinement",
        category: "capsule_root",
        status: "fail",
        passed: false,
        message: `Failed to audit capsule root: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Verify repository directory permissions and path existence",
      });
    }
  }

  // 3. Unified Evidence Location Check
  if (
    options.checkUnifiedEvidence !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0
  ) {
    try {
      const stateObj = options.state as JsonObject | null | undefined;
      const evidenceAudit = verifyUnifiedEvidenceLocation(options.runRoot, stateObj);
      if (evidenceAudit.valid) {
        checks.push({
          name: "unified_evidence_location",
          category: "evidence_location",
          status: "pass",
          passed: true,
          message: `All evidence paths (${evidenceAudit.checkedCount} checked) conform to unified evidence storage`,
          details: { checkedCount: evidenceAudit.checkedCount },
        });
      } else {
        checks.push({
          name: "unified_evidence_location",
          category: "evidence_location",
          status: "fail",
          passed: false,
          message: evidenceAudit.issues.join("; "),
          details: {
            invalidCount: evidenceAudit.invalidCount,
            invalidPaths: evidenceAudit.invalidPaths,
            issues: evidenceAudit.issues,
          },
          remediation: "Relocate all evidence and screenshots into .capsules/<run>/evidence/",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "unified_evidence_location",
        category: "evidence_location",
        status: "fail",
        passed: false,
        message: `Failed to audit evidence locations: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Verify evidence store file integrity and paths",
      });
    }
  }

  // 4. Tier Confinement Check
  if (
    options.checkTierConfinement !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0 &&
    options.state !== null &&
    options.state !== undefined
  ) {
    try {
      const stateObj = options.state as JsonObject;
      const findings = auditTierConfinement(options.runRoot, stateObj);
      const critical = findings.filter((f) => f.severity === "critical");

      if (critical.length === 0) {
        checks.push({
          name: "tier_confinement_isolation",
          category: "tier_confinement",
          status: "pass",
          passed: true,
          message: "Supervisor roles strictly confined; zero code-editing violations observed",
          details: { totalFindings: findings.length },
        });
      } else {
        checks.push({
          name: "tier_confinement_isolation",
          category: "tier_confinement",
          status: "fail",
          passed: false,
          message: critical.map((f) => f.observation).join("; "),
          details: { criticalCount: critical.length, findings: critical },
          remediation:
            "Enforce strict separation: Only Tier 3 Implementers may edit repository files",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "tier_confinement_isolation",
        category: "tier_confinement",
        status: "fail",
        passed: false,
        message: `Failed to audit tier confinement: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Check agent grant records and command history in capsule state",
      });
    }
  }

  // 5. State & Layout Integrity Check
  if (
    options.checkIntegrity !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0 &&
    existsSync(options.runRoot)
  ) {
    try {
      const integrityIssues = [
        ...verifyIntegrity(options.runRoot),
        ...verifyCapsuleDeep(options.runRoot),
      ];
      if (integrityIssues.length === 0) {
        checks.push({
          name: "capsule_state_integrity",
          category: "integrity",
          status: "pass",
          passed: true,
          message: "Capsule state, manifest, event stream, and layout integrity verified",
        });
      } else {
        checks.push({
          name: "capsule_state_integrity",
          category: "integrity",
          status: "fail",
          passed: false,
          message: integrityIssues.map((i) => `${i.code}: ${i.message}`).join("; "),
          details: { issues: integrityIssues },
          remediation: "Recover capsule state projection or reconcile corrupted event logs",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "capsule_state_integrity",
        category: "integrity",
        status: "fail",
        passed: false,
        message: `Failed to verify integrity: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Ensure capsule files are accessible and not locked",
      });
    }
  }

  // 6. Custom Diagnostics
  if (Array.isArray(options.customChecks) && options.customChecks.length > 0) {
    for (const customFn of options.customChecks) {
      try {
        const res = await customFn();
        checks.push(res);
      } catch (err: unknown) {
        checks.push({
          name: "custom_diagnostic_check",
          category: "custom",
          status: "fail",
          passed: false,
          message: `Custom health check threw an error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return checks;
}

/**
 * Certifies the Harness Doctor status by executing diagnostic audits and adversarial counterfactual checks.
 */
export async function certifyHarnessDoctor(
  options: DoctorCertificationOptions = {},
): Promise<DoctorCertificationReport> {
  const certifiedAt = parseIsoTimestamp(options.now);
  const runRoot =
    typeof options.runRoot === "string" && options.runRoot.length > 0
      ? options.runRoot
      : process.cwd();
  const minVersion =
    typeof options.minimumBunVersion === "string" && options.minimumBunVersion.length > 0
      ? options.minimumBunVersion
      : MINIMUM_BUN_VERSION;
  const bunSupported = compareSemver(Bun.version, minVersion);

  const healthChecks = await runDoctorDiagnostics(options);
  const adversarialChecks: AdversarialCheckResult[] = [];

  // Run adversarial falsifiability checks on write scope files if requested
  if (
    options.runAdversarialChecks !== false &&
    Array.isArray(options.writeScope) &&
    options.writeScope.length > 0
  ) {
    for (const scopePath of options.writeScope) {
      if (
        scopePath.endsWith(".test.ts") ||
        scopePath.endsWith(".spec.ts") ||
        options.adversarialTestRunner !== undefined
      ) {
        const mutationKind: MutationKind =
          options.mutationKind !== undefined ? options.mutationKind : "syntax_error";
        const check = await runAdversarialCounterfactualCheck(scopePath, {
          mutationKind,
          ...(options.adversarialTestRunner !== undefined
            ? { testRunner: options.adversarialTestRunner }
            : {}),
        });
        adversarialChecks.push(check);
      }
    }
  }

  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  for (const hc of healthChecks) {
    if (hc.status === "fail") {
      criticalIssues.push(`[${hc.category.toUpperCase()}] ${hc.name}: ${hc.message}`);
    } else if (hc.status === "warn") {
      warnings.push(`[${hc.category.toUpperCase()}] ${hc.name}: ${hc.message}`);
    }
  }

  for (const adv of adversarialChecks) {
    if (!adv.passed) {
      const advMsg = typeof adv.message === "string" ? adv.message : "Falsifiability test failed";
      criticalIssues.push(`[ADVERSARIAL] ${adv.name}: ${advMsg}`);
    }
  }

  const totalChecks = healthChecks.length + adversarialChecks.length;
  const passedHealth = healthChecks.filter((c) => c.passed).length;
  const passedAdversarial = adversarialChecks.filter((c) => c.passed).length;
  const passedChecks = passedHealth + passedAdversarial;
  const failedChecks = totalChecks - passedChecks;

  const certified = criticalIssues.length === 0 && failedChecks === 0;

  const summary = certified
    ? `Harness Doctor CERTIFIED: All ${totalChecks} health and adversarial falsifiability checks passed cleanly.`
    : `Harness Doctor UNCERTIFIED: ${criticalIssues.length} critical issue(s) detected across ${totalChecks} checks.`;

  const mdLines: string[] = [
    `# Harness Doctor Certification Report`,
    `- **Status**: ${certified ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`,
    `- **Timestamp**: ${certifiedAt}`,
    `- **Run Root**: \`${runRoot}\``,
    `- **Bun Runtime**: \`${Bun.version}\` (${bunSupported ? "Supported" : "Unsupported"})`,
    `- **Total Checks**: ${totalChecks} (Passed: ${passedChecks}, Failed: ${failedChecks})`,
    "",
    `## Health Diagnostics (${healthChecks.length})`,
  ];

  for (const hc of healthChecks) {
    const icon = hc.status === "pass" ? "✅" : hc.status === "warn" ? "⚠️" : "❌";
    mdLines.push(`- ${icon} **${hc.name}** [${hc.category}]: ${hc.message}`);
    if (hc.remediation && hc.status !== "pass") {
      mdLines.push(`  - *Remediation*: ${hc.remediation}`);
    }
  }

  mdLines.push("");
  mdLines.push(`## Adversarial Falsifiability Checks (${adversarialChecks.length})`);

  if (adversarialChecks.length === 0) {
    mdLines.push(`- _No adversarial test gates were evaluated in this cycle._`);
  } else {
    for (const adv of adversarialChecks) {
      const icon = adv.passed ? "✅" : "❌";
      const advMsg = typeof adv.message === "string" ? adv.message : "Completed";
      mdLines.push(`- ${icon} **${adv.name}**: ${advMsg}`);
      if (adv.mutation) {
        mdLines.push(
          `  - Mutation: \`${adv.mutation.mutationKind}\` applied to \`${basename(adv.targetPath)}\``,
        );
      }
    }
  }

  if (criticalIssues.length > 0) {
    mdLines.push("");
    mdLines.push(`## Critical Findings (${criticalIssues.length})`);
    for (const issue of criticalIssues) {
      mdLines.push(`- ❌ ${issue}`);
    }
  }

  const markdown = mdLines.join("\n");

  return {
    certified,
    runRoot,
    certifiedAt,
    bunVersion: Bun.version,
    bunSupported,
    healthChecks,
    adversarialChecks,
    totalChecks,
    passedChecks,
    failedChecks,
    criticalIssues,
    warnings,
    summary,
    markdown,
  };
}

/**
 * Asserts that the DoctorCertificationReport is fully certified.
 * Throws a fatal HarnessError if any critical issue or certification failure is present.
 */
export function assertDoctorCertification(report: DoctorCertificationReport): void {
  if (!report.certified || report.criticalIssues.length > 0 || report.failedChecks > 0) {
    const detailMessage =
      report.criticalIssues.length > 0
        ? report.criticalIssues.join("; ")
        : `Certification failed with ${report.failedChecks} failing check(s)`;

    throw new HarnessError(
      "INTEGRITY",
      `Harness doctor certification failed: ${detailMessage}`,
      [...report.criticalIssues],
      3,
      "Resolve all health check issues and verify adversarial counterfactual falsifiability before proceeding.",
    );
  }
}
