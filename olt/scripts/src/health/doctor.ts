export interface DagBadge {
  id: string;
  asciiArt: string;
  waveNeighborhood: string;
  isActive: boolean;
}

export function pruneAsciiDagBadges(badges: DagBadge[], activeWave: string): DagBadge[] {
  // Prune ASCII DAG badges to active wave neighborhoods to conserve LLM context tokens
  return badges.filter((badge) => badge.waveNeighborhood === activeWave || badge.isActive);
}
