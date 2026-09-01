import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ALLOWED_SUPERVISORY_TOOLS,
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type AgentContainmentState,
} from "../../../olt/scripts/src/mind/containment/index.ts";
import {
  assertSupervisoryContainment,
  checkSupervisoryContainment,
  detectSupervisoryViolation,
  isSupervisoryRoleForContainment,
  resetDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
