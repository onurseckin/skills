// @ts-nocheck
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  ToolDescriptor,
  ToolInvocationContext,
  QuarantineCheckResult,
  BackdoorDetectionResult,
  QuarantineEnforcementResult,
  QuarantineAuditRecord,
  OpticalQuarantineInvariant,
} from "./types.ts";
import {
  isOpticalValidatorRole,
  verifyCapability,
  detectBackdoorBypass,
} from "./inspectors.ts";

export class ToolQuarantineEngine {
  private readonly auditLog: QuarantineAuditRecord[] = [];

  public stripTools<T extends string | ToolDescriptor>(
    availableTools: readonly T[],
    role = "ui-optical-validator",
  ): T[] {
    if (!isOpticalValidatorRole(role)) {
      return [...availableTools];
    }

    return availableTools.filter((tool) => {
      const toolName = typeof tool === "string" ? tool : tool.name;
      const capability = this.verifyCapability(toolName, role);
      return capability.allowed;
    });
  }

  /**
   * Verify capability of a specific tool for a given role
   */
  public verifyCapability(
    toolName: string,
    role = "ui-optical-validator",
  ): QuarantineCheckResult {
    return verifyCapability(toolName, role);
  }

  public detectBackdoorBypass(
    toolName: string,
    args: Record<string, unknown>,
  ): BackdoorDetectionResult {
    return detectBackdoorBypass(toolName, args);
  }

  public enforceRuntimeBoundary(invocation: ToolInvocationContext): QuarantineEnforcementResult {
    const { role, toolName, args } = invocation;

    if (!isOpticalValidatorRole(role)) {
      return {
        action: "ALLOW",
        reason: `Role '${role}' is not subject to optical tool quarantine.`,
      };
    }

    // 1. Verify capability
    const capability = this.verifyCapability(toolName, role);
    if (!capability.allowed) {
      const violationInvariant = capability.violations[0] as OpticalQuarantineInvariant | undefined;
      return {
        action: "BLOCK",
        reason: capability.reason,
        violationInvariant: violationInvariant ?? "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK",
      };
    }

    // 2. Check for backdoor bypass attempts in arguments
    const bypass = this.detectBackdoorBypass(toolName, args);
    if (bypass.detected) {
      const violationInvariant: OpticalQuarantineInvariant =
        bypass.vector === "SOURCE_CODE_READ_ATTEMPT_VIA_VIEW_FILE" ||
        bypass.vector === "NON_IMAGE_ARTIFACT_VIEW_ATTEMPT"
          ? "ZERO_SOURCE_READS"
          : "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK";

      return {
        action: "BLOCK",
        reason: `[BACKDOOR BYPASS BLOCKED]: ${bypass.description}`,
        bypassAttempt: bypass,
        violationInvariant,
      };
    }

    return {
      action: "ALLOW",
      reason: `Tool '${toolName}' permitted under optical quarantine runtime boundary.`,
    };
  }

  /**
   * Audit tool invocation and record into internal log
   */
  public auditToolInvocation(invocation: ToolInvocationContext): QuarantineAuditRecord {
    const enforcement = this.enforceRuntimeBoundary(invocation);
    const capability = this.verifyCapability(invocation.toolName, invocation.role);
    const callId =
      invocation.callId ?? `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = invocation.timestamp ?? new Date().toISOString();

    const record: QuarantineAuditRecord = {
      callId,
      agentId: invocation.agentId,
      role: invocation.role,
      toolName: invocation.toolName,
      timestamp,
      decision: enforcement.action === "ALLOW" ? "ALLOWED" : "BLOCKED",
      category: capability.category,
      bypassDetected: enforcement.bypassAttempt?.detected ?? false,
      ...(enforcement.reason ? { details: enforcement.reason } : {}),
      ...(enforcement.violationInvariant
        ? { violationInvariant: enforcement.violationInvariant }
        : {}),
    };

    this.auditLog.push(record);
    return record;
  }

  /**
   * Create an optical validator tool filter function
   */
  public createOpticalValidatorToolFilter(
    role = "ui-optical-validator",
  ): (toolName: string) => boolean {
    return (toolName: string) => this.verifyCapability(toolName, role).allowed;
  }

  /**
   * Assert compliance or throw HarnessError
   */
  public assertOpticalQuarantineCompliance(
    toolName: string,
    args: Record<string, unknown> = {},
    role = "ui-optical-validator",
    agentId = "ui-optical-validator-runtime",
  ): void {
    const invocation: ToolInvocationContext = {
      agentId,
      role,
      toolName,
      args,
    };

    const enforcement = this.enforceRuntimeBoundary(invocation);
    this.auditToolInvocation(invocation);

    if (enforcement.action !== "ALLOW") {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `[OPTICAL QUARANTINE HARDLOCK]: ${enforcement.reason}`,
        enforcement.violationInvariant ? [enforcement.violationInvariant] : [],
      );
    }
  }

  /**
   * Retrieve in-memory audit history
   */
  public getAuditHistory(): readonly QuarantineAuditRecord[] {
    return [...this.auditLog];
  }

  /**
   * Clear in-memory audit history
   */
  public clearAuditHistory(): void {
    this.auditLog.length = 0;
  }
}

/**
 * Singleton instance of ToolQuarantineEngine
 */


let defaultQuarantineEngine: ToolQuarantineEngine | null = null;

export function getDefaultQuarantineEngine(): ToolQuarantineEngine {
  if (!defaultQuarantineEngine) {
    defaultQuarantineEngine = new ToolQuarantineEngine();
  }
  return defaultQuarantineEngine;
}

export function setDefaultQuarantineEngine(engine: ToolQuarantineEngine): void {
  defaultQuarantineEngine = engine;
}

export function resetDefaultQuarantineEngine(): void {
  defaultQuarantineEngine = null;
}
