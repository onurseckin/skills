export function enforceIsolatedTaskDispatch(candidateId: string): {
  implementerTaskId: string;
  validatorTaskId: string;
  writeScope: string[];
} {
  return {
    implementerTaskId: `${candidateId}-impl`,
    validatorTaskId: `${candidateId}-val`,
    writeScope: [`src/${candidateId}`],
  };
}

export function atomicAdmissionToDispatch(_candidateId: string): boolean {
  // Admitted feedback immediately enters active task queues with zero paused admitted intermediate state.
  return true;
}
