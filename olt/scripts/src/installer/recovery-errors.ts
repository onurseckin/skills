export async function recoveryErrors(steps: readonly (() => Promise<void>)[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export function combinedFailure(
  primary: unknown,
  recovery: readonly unknown[],
  message: string,
): unknown {
  if (recovery.length === 0) return primary;
  return new AggregateError([primary, ...recovery], message, { cause: primary });
}
