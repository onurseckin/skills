import { DagBadge, pruneAsciiDagBadges, killDanglingBrowserProcesses } from "./doctor";

export interface HealthReport {
  activeBadges: DagBadge[];
  zombieProcesses: string[];
  recommendations: string[];
}

export function generatePulseReport(badges: DagBadge[], activeWave: string): HealthReport {
  const prunedBadges = pruneAsciiDagBadges(badges, activeWave);
  const killedCount = killDanglingBrowserProcesses();
  const zombieProcesses = checkZombieProcesses();
  const recommendations: string[] = [];

  if (killedCount > 0) {
    recommendations.push(
      `Automated cleanup: Terminated ${killedCount} dangling browser/Chromium process(es).`,
    );
  }

  if (zombieProcesses.length > 0) {
    recommendations.push(
      "Automated cleanup recommendation: Run 'kill -9' on the following zombie processes: " +
        zombieProcesses.join(", "),
    );
  }

  return {
    activeBadges: prunedBadges,
    zombieProcesses,
    recommendations,
  };
}

function checkZombieProcesses(): string[] {
  try {
    // Basic mock implementation of checking for zombie processes (e.g., zombie chromium)
    return [];
  } catch (e: unknown) {
    return [];
  }
}
