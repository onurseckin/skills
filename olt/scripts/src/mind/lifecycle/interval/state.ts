export interface PulseValueMetrics {
  readonly [key: string]: unknown;
}

export interface TrailingValuePoint {
  readonly pulseId: string;
  readonly pulseNumber?: number | undefined;
  readonly outcome: string;
  readonly value: number;
  readonly timestamp?: string | undefined;
  readonly metrics?: PulseValueMetrics | undefined;
}

export interface TrailingValueSeries {
  readonly points: readonly TrailingValuePoint[];
  readonly rawValues: readonly number[];
  readonly totalValue: number;
  readonly meanValue: number;
  readonly trailingZeroStreak: number;
  readonly isFlatZero: boolean;
  readonly windowSize: number;
  readonly formattedSeries: string;
  readonly markdown: string;
}

/**
 * Generates trailing value series from recorded pulse points.
 * Ensures the owner digest can render raw unmasked series rather than hiding zeroes behind summaries.
 */
export function generateTrailingValueSeries(
  pulses: readonly TrailingValuePoint[],
  windowSize: number = 20,
): TrailingValueSeries {
  const windowedPoints = windowSize > 0 ? pulses.slice(-windowSize) : pulses;
  const rawValues = windowedPoints.map((p) => p.value);
  const totalValue = rawValues.reduce((sum, v) => sum + v, 0);
  const meanValue = rawValues.length > 0 ? Number((totalValue / rawValues.length).toFixed(2)) : 0;

  let trailingZeroStreak = 0;
  for (let i = rawValues.length - 1; i >= 0; i--) {
    if (rawValues[i] === 0) {
      trailingZeroStreak++;
    } else {
      break;
    }
  }

  const isFlatZero = rawValues.length > 0 && rawValues.every((v) => v === 0);
  const formattedSeries = `[${rawValues.join(", ")}]`;

  const markdownLines = [
    `### Trailing Value Series (Last ${rawValues.length} Pulses)`,
    `- **Raw Series**: \`${formattedSeries}\``,
    `- **Total Value**: ${totalValue}`,
    `- **Trailing Zero Streak**: ${trailingZeroStreak}`,
  ];

  if (isFlatZero && rawValues.length >= 5) {
    markdownLines.push(
      `> ⚠️ **Flat Zero Series**: All ${rawValues.length} recent pulses produced 0 value. A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.`,
    );
  }

  return {
    points: windowedPoints,
    rawValues,
    totalValue,
    meanValue,
    trailingZeroStreak,
    isFlatZero,
    windowSize: rawValues.length,
    formattedSeries,
    markdown: markdownLines.join("\n"),
  };
}

/**
 * Extracts trailing value series from capsule state object.
 */
export function extractTrailingValueSeriesFromState(
  state: Record<string, unknown>,
  windowSize: number = 20,
): TrailingValueSeries {
  const points: TrailingValuePoint[] = [];

  const pulseObj =
    typeof state["pulse"] === "object" && state["pulse"] !== null
      ? (state["pulse"] as Record<string, unknown>)
      : {};

  if (Array.isArray(pulseObj["history"])) {
    for (const item of pulseObj["history"]) {
      if (typeof item === "object" && item !== null) {
        const hist = item as Record<string, unknown>;
        const pid =
          typeof hist["pulse_id"] === "string"
            ? hist["pulse_id"]
            : typeof hist["id"] === "string"
              ? hist["id"]
              : "pulse";
        const val = typeof hist["value"] === "number" ? hist["value"] : 0;
        const outcome = typeof hist["outcome"] === "string" ? hist["outcome"] : "quiescent";
        const timestamp =
          typeof hist["closed_at"] === "string"
            ? hist["closed_at"]
            : typeof hist["at"] === "string"
              ? hist["at"]
              : undefined;
        points.push({
          pulseId: pid,
          outcome,
          value: val,
          timestamp,
        });
      }
    }
  } else if (typeof pulseObj["last"] === "object" && pulseObj["last"] !== null) {
    const last = pulseObj["last"] as Record<string, unknown>;
    const pid = typeof last["pulse_id"] === "string" ? last["pulse_id"] : "pulse-last";
    const val = typeof last["value"] === "number" ? last["value"] : 0;
    const outcome = typeof last["outcome"] === "string" ? last["outcome"] : "quiescent";
    const timestamp = typeof last["closed_at"] === "string" ? last["closed_at"] : undefined;
    points.push({
      pulseId: pid,
      outcome,
      value: val,
      timestamp,
    });
  }

  return generateTrailingValueSeries(points, windowSize);
}

/**
 * Extracts trailing value series from capsule event stream.
 */
export function extractTrailingValueSeriesFromEvents(
  events: readonly Record<string, unknown>[],
  windowSize: number = 20,
): TrailingValueSeries {
  const points: TrailingValuePoint[] = [];

  for (const ev of events) {
    if (ev["kind"] === "mind-pulse-closed") {
      const payload =
        typeof ev["payload"] === "object" && ev["payload"] !== null
          ? (ev["payload"] as Record<string, unknown>)
          : {};
      const pid = typeof payload["pulse_id"] === "string" ? payload["pulse_id"] : "pulse";
      const val = typeof payload["value"] === "number" ? payload["value"] : 0;
      const outcome = typeof payload["outcome"] === "string" ? payload["outcome"] : "quiescent";
      const timestamp = typeof ev["timestamp"] === "string" ? ev["timestamp"] : undefined;

      points.push({
        pulseId: pid,
        outcome,
        value: val,
        timestamp,
      });
    }
  }

  return generateTrailingValueSeries(points, windowSize);
}

/**
 * Formats a raw number array into `[0, 1, 2, ...]` string.
 */
export function formatRawValueSeries(values: readonly number[]): string {
  return `[${values.join(", ")}]`;
}
