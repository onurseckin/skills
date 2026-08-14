import { atomicReleaseCopy, type ReleaseCopyOptions } from "../../../src/installer/release-copy.ts";
import { markerPath } from "../../../src/installer/transaction-marker.ts";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const [source, destination, manifestJson, boundary] = process.argv.slice(2);
if (!source || !destination || !manifestJson || !boundary)
  throw new Error("missing crash arguments");
const options: ReleaseCopyOptions = {
  hooks: {
    beforeOldMove() {
      if (boundary === "before-old-rename") process.exit(71);
    },
    afterOldMoveBeforeJournal() {
      if (boundary === "after-old-rename") process.exit(72);
    },
    beforePublish() {
      if (boundary === "before-publish-rename") process.exit(73);
    },
    afterPublishBeforeJournal() {
      if (boundary === "after-publish-rename") process.exit(74);
    },
    afterOldMoved() {
      if (boundary === "old-moved") process.exit(81);
    },
    afterPublished() {
      if (boundary === "published") process.exit(82);
    },
    afterBackupDeletedBeforeJournal() {
      if (boundary === "backup-deleted") process.exit(75);
    },
    async afterBackupQuarantinedBeforeJournal() {
      if (boundary === "backup-quarantined") {
        const marker = JSON.parse(await readFile(markerPath(dirname(destination)), "utf8")) as {
          backup_quarantine: string;
        };
        await rm(join(marker.backup_quarantine, "SKILL.md"));
        process.exit(77);
      }
    },
    beforeMarkerFinish() {
      if (boundary === "before-marker-delete") process.exit(76);
    },
  } as ReleaseCopyOptions["hooks"],
};
await atomicReleaseCopy(source, destination, JSON.parse(manifestJson), options);
