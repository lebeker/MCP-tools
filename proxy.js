const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_CONFIG = process.env.USERS_CONFIG_PATH || './users.json';

// In-memory store for active sessions: sessionId -> { child, res }
const sessions = new Map();

function loadUsers() {
  if (fs.existsSync(USERS_CONFIG)) {
    try {
      const data = JSON.parse(fs.readFileSync(USERS_CONFIG, 'utf8'));
      return data.users || {};
    } catch (e) {
      console.error('[Proxy] Failed to parse users config:', e.message);
      return {};
    }
  }
  return {};
}

const SERVER_COMMANDS = {
  github: { cmd: 'npx', args: ['@modelcontextprotocol/server-github'] },
  confluence: { cmd: 'npx', args: ['@zereight/mcp-confluence'] },
  'google-drive': { cmd: 'npx', args: ['@piotr-agier/google-drive-mcp'] }
};

app.use(express.json());

/**
 * SSE Endpoint: /:userId/:serverType/sse
 */
app.get('/:userId/:serverType/sse', (req, res) => {
  const { userId, serverType } = req.params;
  const users = loadUsers();
  const userConfig = users[userId];

  if (!userConfig || !SERVER_COMMANDS[serverType]) {
    console.warn(`[Proxy] Connection rejected: Invalid user (${userId}) or server (${serverType})`);
    return res.status(404).json({ error: 'User or server type not found' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const serverDef = SERVER_COMMANDS[serverType];
  const env = { ...process.env, ...(userConfig[serverType] || {}) };
  const sessionId = `${userId}-${serverType}-${Date.now()}`;

  console.log(`[Proxy] [${sessionId}] Spawning ${serverType} process for ${userId}...`);

  const child = spawn(serverDef.cmd, serverDef.args, {
    env,
    stdio: ['pipe', 'pipe', 'inherit']
  });

  sessions.set(sessionId, { child, res });

  // Inform client of the POST endpoint for messages
  res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

  // Stream child stdout -> SSE 'message' events
  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      res.write(`event: message\ndata: ${line}\n\n`);
    });
  });

  child.on('error', (err) => {
    console.error(`[Proxy] [${sessionId}] Process error:`, err.message);
    res.end();
    sessions.delete(sessionId);
  });

  child.on('exit', (code) => {
    console.log(`[Proxy] [${sessionId}] Child process exited with code ${code}`);
    res.end();
    sessions.delete(sessionId);
  });

  req.on('close', () => {
    if (sessions.has(sessionId)) {
      console.log(`[Proxy] [${sessionId}] Client closed connection, terminating process`);
      child.kill();
      sessions.delete(sessionId);
    }
  });
});

/**
 * JSON-RPC Message Endpoint
 */
app.post('/message', (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Active session not found' });
  }

  try {
    const message = JSON.stringify(req.body) + '\n';
    session.child.stdin.write(message);
    res.status(202).send('Accepted');
  } catch (e) {
    console.error(`[Proxy] [${sessionId}] Failed to write to stdin:`, e.message);
    res.status(500).json({ error: 'Failed to send message to server' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Multi-tenant MCP Proxy started on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  - SSE:  GET  /:userId/github/sse`);
  console.log(`  - MSG:  POST /message?sessionId=<id>\n`);
});
