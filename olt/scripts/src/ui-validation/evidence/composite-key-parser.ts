// @ts-nocheck
import { createHash } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type { CompositeArtifactKey, ArtifactMetadata, EvidenceTier } from "./types.ts";
export class CompositeKeyParser {
  /**
   * Sanitizes a single key component to alphanumeric and hyphens
   */
  public static sanitizeSegment(segment: string): string {
    if (!segment) return "unknown";
    return segment
      .trim()
      .toLowerCase()
      .replace(/[\/\\]+/g, "-") // Convert slashes to hyphens
      .replace(/[^a-z0-9\-_]/g, "-") // Replace non-alphanumeric chars
      .replace(/-+/g, "-") // Deduplicate hyphens
      .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
  }

  /**
   * Serializes a CompositeArtifactKey to canonical string format: [epic]_[round]_[route]_[state]_[viewport]
   */
  public static serialize(
    key: CompositeArtifactKey,
    extension: string = "png",
  ): string {
    if (!key) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Key object must not be undefined or null",
      );
    }

    if (key.round === undefined || key.round < 0 || isNaN(key.round)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Invalid round number: ${key.round}`,
      );
    }

    const epic = this.sanitizeSegment(key.epic);
    const round = `r${key.round}`;
    const route = this.sanitizeSegment(key.route);
    const state = this.sanitizeSegment(key.state);
    const viewport = this.sanitizeSegment(key.viewport);

    const baseKey = `${epic}_${round}_${route}_${state}_${viewport}`;
    const cleanExt = extension.replace(/^\./, "");
    return cleanExt ? `${baseKey}.${cleanExt}` : baseKey;
  }

  /**
   * Parses a serialized composite key string back into a CompositeArtifactKey
   */
  public static parse(serializedKey: string): CompositeArtifactKey {
    if (!serializedKey || typeof serializedKey !== "string") {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Serialized key must be a non-empty string",
      );
    }

    // Strip extension and folder path if present
    const cleanBasename = serializedKey
      .split("/")
      .pop()!
      .replace(/\.[a-zA-Z0-9]+$/, "");

    const segments = cleanBasename.split("_");
    if (segments.length !== 5) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Serialized composite key '${serializedKey}' must contain exactly 5 segments joined by '_', found ${segments.length}`,
      );
    }

    const [epic, roundStr, route, state, viewport] = segments;
    if (!epic || !roundStr || !route || !state || !viewport) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Serialized composite key '${serializedKey}' contains empty or invalid segments`,
      );
    }

    // Parse round: e.g. "r1", "round1", "1"
    const roundMatch = roundStr.match(/\d+/);
    const roundVal = roundMatch?.[0];
    if (!roundVal) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Cannot parse round number from segment '${roundStr}'`,
      );
    }
    const round = parseInt(roundVal, 10);

    return {
      epic,
      round,
      route,
      state,
      viewport,
    };
  }

  /**
   * Validates if a key string or object satisfies the Composite Key contract
   */
  public static validate(key: CompositeArtifactKey | string): boolean {
    try {
      if (typeof key === "string") {
        this.parse(key);
        return true;
      }
      return (
        Boolean(key.epic) &&
        typeof key.round === "number" &&
        key.round >= 0 &&
        Boolean(key.route) &&
        Boolean(key.state) &&
        Boolean(key.viewport)
      );
    } catch {
      return false;
    }
  }

  /**
   * Extracts metadata from key and parameters
   */
  public static extractMetadata(
    keyInput: CompositeArtifactKey | string,
    options?: {
      sizeBytes?: number;
      sha256?: string;
      mimeType?: "image/png" | "image/webp" | "image/jpeg" | "application/json";
      tier?: EvidenceTier;
      readinessToken?: string;
      isMilestoneAnchor?: boolean;
    },
  ): ArtifactMetadata {
    const key =
      typeof keyInput === "string" ? this.parse(keyInput) : keyInput;
    const filename = this.serialize(
      key,
      options?.mimeType === "application/json" ? "json" : "png",
    );
    const keyString = this.serialize(key, "");

    const sizeBytes = options?.sizeBytes ?? 0;
    const sha256 =
      options?.sha256 ??
      createHash("sha256").update(filename).digest("hex");

    return {
      key,
      keyString,
      filename,
      tier: options?.tier ?? 1,
      createdAt: new Date().toISOString(),
      sizeBytes,
      mimeType: options?.mimeType ?? "image/png",
      sha256,
      ...(options?.readinessToken !== undefined
        ? { readinessToken: options.readinessToken }
        : {}),
      isMilestoneAnchor: options?.isMilestoneAnchor ?? false,
    };
  }
}

// ============================================================================
// 2. Optical Stability Barrier
// ============================================================================

