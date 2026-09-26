import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface HitRecorder {
  /** Base URL of a server that stands for something on the internal network. */
  url: string;
  /** Paths requested so far. */
  hits: string[];
  close: () => Promise<void>;
}

/**
 * Starts a throwaway HTTP server that records every request it gets. Loopback
 * is fine here: it is a listener inside the test process's own container, not a
 * connection between Compose services.
 */
export async function startHitRecorder(): Promise<HitRecorder> {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(request.url ?? '');
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** An HLS playlist that lists `segmentUrl`, the way an attacker would upload it. */
export const hlsPlaylistPointingTo = (segmentUrl: string): Buffer =>
  Buffer.from(
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:1',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:1.0,',
      `${segmentUrl}/internal-secret.ts`,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
  );
