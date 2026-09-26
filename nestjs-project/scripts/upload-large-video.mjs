#!/usr/bin/env node
// Proof that a very large video (10 GiB) is uploaded without the bytes going
// through the API and without the API becoming unresponsive.
//
// Run it in a container OTHER than the API's, so that the network traffic of
// this client is not counted as traffic of the API when measuring it:
//
//   docker compose exec video-worker node scripts/upload-large-video.mjs proof-10g.bin
//
// Environment (defaults are the Compose service names):
//   API_URL      http://nestjs-api:3000
//   MAILPIT_URL  http://mailpit:8025
//   CONCURRENCY  4       parts sent in parallel
//   WAIT_SECONDS 600     how long to wait for the processing outcome

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const API_URL = process.env.API_URL ?? 'http://nestjs-api:3000';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS ?? 600);
const PARTS_PER_REQUEST = 80;
const PROBE_INTERVAL_MS = 200;
const POLL_INTERVAL_MS = 12_000; // the API throttles to 10 requests per minute

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node scripts/upload-large-video.mjs <file>');
  process.exit(2);
}
const fileSize = statSync(filePath).size;

const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? safeJson(text) : undefined,
  };
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

function expectStatus(response, expected, what) {
  if (response.status !== expected) {
    throw new Error(
      `${what}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response.body;
}

async function registerAndLogin() {
  const email = `upload-proof-${Date.now()}@example.com`;
  const password = 'password123';
  expectStatus(
    await api('POST', '/auth/register', { body: { email, password } }),
    201,
    'register',
  );

  let confirmationLink;
  for (let attempt = 0; attempt < 30 && !confirmationLink; attempt++) {
    const search = await (
      await fetch(
        `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      )
    ).json();
    const message = search.messages?.[0];
    if (message) {
      const detail = await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      ).json();
      confirmationLink = /token=([A-Za-z0-9_-]+)/.exec(
        `${detail.Text} ${detail.HTML}`,
      )?.[1];
    }
    if (!confirmationLink) await new Promise((r) => setTimeout(r, 500));
  }
  if (!confirmationLink)
    throw new Error('confirmation e-mail not found in Mailpit');

  const confirm = await api(
    'GET',
    `/auth/confirm-email?token=${confirmationLink}`,
  );
  expectStatus(confirm, 204, 'confirm e-mail');
  const login = expectStatus(
    await api('POST', '/auth/login', { body: { email, password } }),
    200,
    'login',
  );
  return { email, token: login.access_token };
}

/** Sends bytes [start, end] of the file to a presigned URL, reading it by slices. */
function putPart(url, start, end) {
  const target = new URL(url);
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      { method: 'PUT', headers: { 'Content-Length': end - start + 1 } },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve()
            : reject(new Error(`part upload answered ${res.statusCode}`)),
        );
      },
    );
    req.on('error', reject);
    createReadStream(filePath, { start, end }).on('error', reject).pipe(req);
  });
}

/** Polls GET / while the upload runs and keeps the latency of each answer. */
function startProbe() {
  const samples = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = performance.now();
      let status = 0;
      try {
        status = (await fetch(`${API_URL}/`)).status;
      } catch {
        status = 0;
      }
      samples.push({ status, ms: performance.now() - started });
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return samples;
    },
  };
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

function report(samples) {
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.status === 200).length;
  return {
    requests: samples.length,
    ok200: ok,
    okRate: samples.length
      ? `${((ok / samples.length) * 100).toFixed(2)}%`
      : 'n/a',
    latencyMs: latencies.length
      ? {
          min: +latencies[0].toFixed(1),
          p50: +percentile(latencies, 50).toFixed(1),
          p95: +percentile(latencies, 95).toFixed(1),
          max: +latencies.at(-1).toFixed(1),
        }
      : null,
  };
}

async function main() {
  log(
    `file ${filePath}: ${fileSize} bytes (${(fileSize / 1024 ** 3).toFixed(2)} GiB)`,
  );
  const { email, token } = await registerAndLogin();
  log(`user ${email} registered, confirmed and logged in`);

  const created = expectStatus(
    await api('POST', '/videos', {
      token,
      body: {
        filename: 'proof.mp4',
        content_type: 'video/mp4',
        size_bytes: fileSize,
      },
    }),
    201,
    'POST /videos',
  );
  const {
    public_id: publicId,
    part_size_bytes: partSize,
    part_count: partCount,
  } = created;
  log(
    `video ${publicId} created: status=${created.status} part_size=${partSize} part_count=${partCount}`,
  );

  const probe = startProbe();
  const uploadStarted = performance.now();
  let sent = 0;
  try {
    // URLs come in batches (the API accepts up to 100 part numbers per call)
    for (let first = 1; first <= partCount; first += PARTS_PER_REQUEST) {
      const numbers = Array.from(
        { length: Math.min(PARTS_PER_REQUEST, partCount - first + 1) },
        (_, i) => first + i,
      );
      const { parts } = expectStatus(
        await api('POST', `/videos/${publicId}/upload/parts`, {
          token,
          body: { part_numbers: numbers },
        }),
        201,
        'POST upload/parts',
      );

      const queue = [...parts];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let part = queue.shift(); part; part = queue.shift()) {
          const start = (part.part_number - 1) * partSize;
          const end = Math.min(start + partSize, fileSize) - 1;
          await putPart(part.url, start, end);
          sent += 1;
          if (sent % 10 === 0 || sent === partCount) {
            const seconds = (performance.now() - uploadStarted) / 1000;
            log(
              `parts sent: ${sent}/${partCount} (${((sent / partCount) * 100).toFixed(0)}%, ${seconds.toFixed(0)} s)`,
            );
          }
        }
      });
      await Promise.all(workers);
    }
  } finally {
    // the probe keeps running until the completion call below has answered
  }
  const uploadSeconds = (performance.now() - uploadStarted) / 1000;
  log(
    `upload finished in ${uploadSeconds.toFixed(1)} s (${(fileSize / 1024 ** 2 / uploadSeconds).toFixed(1)} MiB/s)`,
  );

  const completion = expectStatus(
    await api('POST', `/videos/${publicId}/upload/completion`, { token }),
    202,
    'POST upload/completion',
  );
  log(`completion answered 202: ${JSON.stringify(completion)}`);
  const samples = await probe.stop();

  console.log(
    '\n=== API responsiveness while the file was being sent (GET /) ===',
  );
  console.log(JSON.stringify(report(samples), null, 2));

  log(`waiting up to ${WAIT_SECONDS} s for the processing outcome`);
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let outcome = 'not ready within the wait (draft, processing or error)';
  while (Date.now() < deadline) {
    const meta = await api('GET', `/videos/${publicId}`);
    if (meta.status === 200) {
      outcome = `ready: ${JSON.stringify(meta.body)}`;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`\npublic_id: ${publicId}`);
  console.log(`outcome seen through the API: ${outcome}`);
  console.log(
    'exact status:  docker compose exec db psql -U streamtube -c "select status, error_code, error_message from videos where public_id = \'' +
      publicId +
      '\'"',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
