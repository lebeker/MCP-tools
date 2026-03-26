#!/usr/bin/env node

const readline = require('readline');

const sseUrl = process.argv[2];

if (!sseUrl) {
  console.error('usage: node codex-stdio-bridge.js <sse-url>');
  process.exit(1);
}

let messageEndpoint = null;
let sseBuffer = '';
const pendingLines = [];

function flushPending() {
  if (!messageEndpoint) return;

  while (pendingLines.length > 0) {
    const line = pendingLines.shift();
    void postMessage(line);
  }
}

function handleSseChunk(chunk) {
  sseBuffer += chunk;

  while (true) {
    const boundary = sseBuffer.indexOf('\n\n');
    if (boundary === -1) break;

    const rawEvent = sseBuffer.slice(0, boundary);
    sseBuffer = sseBuffer.slice(boundary + 2);

    let eventType = 'message';
    let data = '';

    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice('data:'.length).trim();
      }
    }

    if (eventType === 'endpoint') {
      messageEndpoint = new URL(data, sseUrl).toString();
      flushPending();
      continue;
    }

    if (eventType === 'message' && data) {
      process.stdout.write(`${data}\n`);
    }
  }
}

async function postMessage(line) {
  if (!messageEndpoint) {
    pendingLines.push(line);
    return;
  }

  const payload = line.trim();
  if (!payload) return;

  const response = await fetch(messageEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: payload
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`message POST failed: HTTP ${response.status} ${body}`.trim());
  }
}

async function connect() {
  const response = await fetch(sseUrl, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream'
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`failed to connect to SSE endpoint: HTTP ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    handleSseChunk(decoder.decode(value, { stream: true }));
  }

  process.exit(0);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  postMessage(line).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
});

connect().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

