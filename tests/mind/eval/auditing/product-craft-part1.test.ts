import { describe, expect, it } from "bun:test";
import {
  CRAFT_PASS_THRESHOLD,
  DEFAULT_PILLAR_WEIGHTS,
  DEFICIT_SEVERITIES,
  ErgonomicWalkthroughAuditor,
  PERCEPTUAL_LATENCY_TARGET_MS,
  PRODUCT_CRAFT_PILLAR_DEFINITIONS,
  PRODUCT_CRAFT_PILLAR_LIST,
  PRODUCT_CRAFT_PILLARS,
  calculateCompositeCraftScore,
  createErgonomicWalkthroughAuditor,
  formatProductCraftAuditMarkdown,
  generateAestheticDeficitNotice,
  renderProductCraftAsciiTable,
  type DeficitInput,
  type MilestoneAuditOptions,
  type UserJourney,
} from "../../../../olt/scripts/src/mind/auditing/product-craft.ts";


