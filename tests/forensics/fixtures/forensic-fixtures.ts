import type { ExtractedToolCall } from "../../../olt/scripts/src/heuristics/index.ts";

export function createSyntheticDagDeps(): Map<string, ReadonlySet<string>> {
  return new Map<string, ReadonlySet<string>>([
    ["root-1", new Set<string>()],
    ["root-2", new Set<string>()],
    ["branch-a", new Set(["root-1"])],
    ["branch-b", new Set(["root-1", "root-2"])],
    ["join-node", new Set(["branch-a", "branch-b"])],
  ]);
}

export function createSyntheticToolTrace(): ExtractedToolCall[] {
  return [
    { agentId: "impl-1", name: "view_file", isRead: true, isWrite: false, isPoll: false },
    { agentId: "impl-1", name: "view_file", isRead: true, isWrite: false, isPoll: false },
    { agentId: "impl-1", name: "list_dir", isRead: true, isWrite: false, isPoll: false },
    { agentId: "impl-1", name: "grep_search", isRead: true, isWrite: false, isPoll: false },
    {
      agentId: "impl-1",
      name: "replace_file_content",
      isRead: false,
      isWrite: true,
      isPoll: false,
    },
  ];
}
