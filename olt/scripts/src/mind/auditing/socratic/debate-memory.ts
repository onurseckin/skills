import type {
  CommitmentStatus,
  SerializedDebateMemory,
  StrategicCommitment,
  StrategicResolution,
} from "./types.ts";

export class HistoricalDebateMemory {
  private readonly resolutions: StrategicResolution[] = [];
  private readonly commitments: Map<string, StrategicCommitment> = new Map();

  public constructor(
    initialResolutions: readonly StrategicResolution[] = [],
    initialCommitments: readonly StrategicCommitment[] = [],
  ) {
    for (const res of initialResolutions) {
      this.recordResolution(res);
    }
    for (const comm of initialCommitments) {
      this.recordCommitment(comm);
    }
  }

  public recordResolution(resolution: StrategicResolution): void {
    this.resolutions.push(resolution);
    for (const commitment of resolution.commitments) {
      this.recordCommitment(commitment);
    }
  }

  public recordCommitment(commitment: StrategicCommitment): void {
    this.commitments.set(commitment.id, { ...commitment });
  }

  public getActiveCommitments(): readonly StrategicCommitment[] {
    const result: StrategicCommitment[] = [];
    for (const commitment of this.commitments.values()) {
      if (commitment.status === "pending") {
        result.push({ ...commitment });
      }
    }
    return Object.freeze(result);
  }

  public getUnfulfilledCommitments(): readonly StrategicCommitment[] {
    const result: StrategicCommitment[] = [];
    for (const commitment of this.commitments.values()) {
      if (commitment.status === "pending" || commitment.status === "breached") {
        result.push({ ...commitment });
      }
    }
    return Object.freeze(result);
  }

  public updateCommitmentStatus(
    id: string,
    status: CommitmentStatus,
    justification?: string,
  ): void {
    const existing = this.commitments.get(id);
    if (!existing) {
      throw new Error(`Commitment with id "${id}" not found in historical debate memory.`);
    }

    const updatedJustification =
      justification !== undefined ? justification : existing.justification;

    const updated: StrategicCommitment = {
      id: existing.id,
      topic: existing.topic,
      agreedResolution: existing.agreedResolution,
      targetMilestone: existing.targetMilestone,
      status,
      ...(updatedJustification !== undefined ? { justification: updatedJustification } : {}),
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.commitments.set(id, updated);
  }

  public hasUnfulfilledCommitmentsWithoutJustification(): boolean {
    for (const commitment of this.commitments.values()) {
      const isUnfulfilled = commitment.status === "pending" || commitment.status === "breached";
      if (isUnfulfilled) {
        const hasValidJustification =
          commitment.justification !== undefined && commitment.justification.trim().length > 0;
        if (!hasValidJustification) {
          return true;
        }
      }
    }
    return false;
  }

  public getLatestResolutionForTopic(topic: string): StrategicResolution | undefined {
    const normalizedTopic = topic.trim().toLowerCase();
    const matches = this.resolutions.filter(
      (r) => r.topic.trim().toLowerCase() === normalizedTopic,
    );

    if (matches.length === 0) {
      return undefined;
    }

    return matches.reduce((latest, current) => {
      const latestTime = Date.parse(latest.recordedAt);
      const currentTime = Date.parse(current.recordedAt);
      if (Number.isNaN(latestTime) || Number.isNaN(currentTime)) {
        return current;
      }
      return currentTime >= latestTime ? current : latest;
    });
  }

  public getResolutions(): readonly StrategicResolution[] {
    return Object.freeze([...this.resolutions]);
  }

  public getCommitments(): readonly StrategicCommitment[] {
    return Object.freeze(Array.from(this.commitments.values()));
  }

  public getCommitmentById(id: string): StrategicCommitment | undefined {
    const comm = this.commitments.get(id);
    return comm ? { ...comm } : undefined;
  }

  public serialize(): string {
    const payload: SerializedDebateMemory = {
      version: 1,
      resolutions: this.resolutions,
      commitments: Array.from(this.commitments.values()),
    };
    return JSON.stringify(payload, null, 2);
  }

  public static deserialize(json: string): HistoricalDebateMemory {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `Failed to deserialize HistoricalDebateMemory: invalid JSON (${String(err)})`,
      );
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(
        "Failed to deserialize HistoricalDebateMemory: payload must be a non-null object.",
      );
    }

    const record = parsed as Record<string, unknown>;
    const resolutionsRaw = record["resolutions"];
    const commitmentsRaw = record["commitments"];

    const resolutions: StrategicResolution[] = [];
    if (Array.isArray(resolutionsRaw)) {
      for (const item of resolutionsRaw) {
        if (isValidResolution(item)) {
          resolutions.push(item);
        }
      }
    }

    const commitments: StrategicCommitment[] = [];
    if (Array.isArray(commitmentsRaw)) {
      for (const item of commitmentsRaw) {
        if (isValidCommitment(item)) {
          commitments.push(item);
        }
      }
    }

    return new HistoricalDebateMemory(resolutions, commitments);
  }
}

function isValidCommitment(value: unknown): value is StrategicCommitment {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  const validStatus =
    rec["status"] === "pending" ||
    rec["status"] === "fulfilled" ||
    rec["status"] === "breached" ||
    rec["status"] === "superseded";

  return (
    typeof rec["id"] === "string" &&
    typeof rec["topic"] === "string" &&
    typeof rec["agreedResolution"] === "string" &&
    typeof rec["targetMilestone"] === "string" &&
    validStatus &&
    (rec["justification"] === undefined || typeof rec["justification"] === "string") &&
    typeof rec["createdAt"] === "string" &&
    typeof rec["updatedAt"] === "string"
  );
}

function isValidResolution(value: unknown): value is StrategicResolution {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  const paretoLevel = rec["paretoPriorityLevel"];
  const validPareto =
    paretoLevel === 1 || paretoLevel === 2 || paretoLevel === 3 || paretoLevel === 4;

  const commitmentsRaw = rec["commitments"];
  const validCommitments = Array.isArray(commitmentsRaw) && commitmentsRaw.every(isValidCommitment);

  return (
    typeof rec["id"] === "string" &&
    typeof rec["cycleId"] === "string" &&
    typeof rec["topic"] === "string" &&
    typeof rec["consensusReached"] === "boolean" &&
    typeof rec["winningApproach"] === "string" &&
    validPareto &&
    typeof rec["settledInvariant"] === "string" &&
    validCommitments &&
    typeof rec["recordedAt"] === "string"
  );
}
