export function dynamicWaveDecoupling(work: number, span: number): number {
  return Math.ceil(work / span);
}
