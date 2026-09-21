import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

const MIB = 1024 * 1024;

/** Pseudo-random content of `bytes` bytes, generated 1 MiB at a time. */
export function randomContent(bytes: number): Buffer {
  const chunks: Buffer[] = [];
  for (let produced = 0; produced < bytes; produced += MIB) {
    chunks.push(randomBytes(Math.min(MIB, bytes - produced)));
  }
  return Buffer.concat(chunks, bytes);
}

export const sha256 = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

export interface StreamDigest {
  sha256: string;
  bytes: number;
  /** Largest growth of `heapUsed` seen while the stream was read. */
  peakHeapGrowthBytes: number;
}

/**
 * Consumes a stream chunk by chunk without keeping the bytes, hashing them and
 * tracking how much the heap grows while it does.
 */
export async function digestStream(stream: Readable): Promise<StreamDigest> {
  const hash = createHash('sha256');
  const baseline = process.memoryUsage().heapUsed;
  let peak = 0;
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.length;
    peak = Math.max(peak, process.memoryUsage().heapUsed - baseline);
  }
  return {
    sha256: hash.digest('hex'),
    bytes,
    peakHeapGrowthBytes: peak,
  };
}
