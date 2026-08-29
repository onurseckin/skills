import { deflateSync } from "node:zlib";

const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
})();

function calculateCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) | 0;
}

export function createSyntheticPngBuffer(width = 10, height = 10, minBytes = 1024): Buffer {
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = 64;
      rawData[pxOffset + 1] = 128;
      rawData[pxOffset + 2] = 200;
      rawData[pxOffset + 3] = 255;
    }
  }

  const compressedData = deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const toCrc = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(calculateCrc32(toCrc), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = makeChunk("IHDR", ihdrData);

  const idatChunk = makeChunk("IDAT", compressedData);
  const initialLen = signature.length + ihdrChunk.length + idatChunk.length + 12;
  const padLen = Math.max(0, minBytes - initialLen);
  const textPayload = Buffer.concat([Buffer.from("Comment\0", "ascii"), Buffer.alloc(padLen, 65)]);
  const textChunk = makeChunk("tEXt", textPayload);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, textChunk, idatChunk, iendChunk]);
}
