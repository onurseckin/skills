import { repositoryInspectionDigest } from "../../olt/scripts/src/packets/repository-inspection.ts";

export function inspection(phase: "baseline" | "current", capturedAt = "2026-08-13T12:00:00.000Z") {
  const value = {
    schema: "harness.repository-inspection",
    version: 3,
    phase,
    captured_at: capturedAt,
    repository_root: "/repo",
    git: {
      available: true,
      head: "a".repeat(40),
      branch: "main",
      status_porcelain_v2: [],
      recent_commits: ["aaaaaaaa test: fixture"],
    },
    instruction_files: [{ path: "AGENTS.md", sha256: "b".repeat(64) }],
    convention_files: [{ path: "package.json", sha256: "c".repeat(64) }],
    repository_identity_sha256: "596d88454b9d42821169d3f3923f095f44aa1af867ce29367a6df595c36e50e1",
    repository_git_identity_sha256: "d".repeat(64),
    repository_content_sha256: "e".repeat(64),
    repository_file_count: 2,
    repository_total_bytes: 128,
    tool_versions: { bun: "bun fixture", git: "git version fixture" },
  };
  return {
    ...value,
    inspection_sha256: repositoryInspectionDigest(value),
  };
}

export function inspectionContext() {
  return {
    baseline_repository_state: inspection("baseline"),
    current_repository_state: inspection("current", "2026-08-13T12:01:00.000Z"),
  };
}
