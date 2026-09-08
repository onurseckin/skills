export {
  countSegmentLines,
  formatSegmentName,
  getHeadSegment,
  parseSegmentNumber,
  readLogIndex,
  rollSegment,
  shouldRollSegment,
  writeLogIndex,
} from "./segments.ts";

export { appendMessage, type AppendMessageInput } from "./append.ts";

export {
  parseLogLine,
  quarantineCorruptLine,
  readSegmentEnvelopes,
  scanContiguousRange,
  scanRange,
  type FsDriver,
  type ParseLineResult,
  type QuarantineOptions,
} from "./scan.ts";
