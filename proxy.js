const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_CONFIG = process.env.USERS_CONFIG_PATH || './users.json';

// In-memory store for active sessions: sessionId -> { child, res, tempDir }
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
  const { userId } = req.params;
  const serverType = req.params.serverType.toLowerCase();
  const users = loadUsers();
  const userConfig = users[userId];

  // Resilient lookup: try kebab-case and camelCase
  let configKey = serverType;
  if (!userConfig?.[serverType]) {
    if (serverType === 'google-drive' && userConfig?.['googleDrive']) configKey = 'googleDrive';
    // Add other mappings if needed
  }
  const serverConfig = userConfig ? userConfig[configKey] : null;

  if (!userConfig || !SERVER_COMMANDS[serverType] || !serverConfig) {
    console.warn(`[Proxy] Connection rejected: Invalid user (${userId}), server (${serverType}), or missing config`);
    return res.status(404).json({ error: 'User or server configuration not found' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const serverDef = SERVER_COMMANDS[serverType];
  const rawEnv = { ...process.env, ...serverConfig };

  const sessionId = `${userId}-${serverType}-${crypto.randomBytes(4).toString('hex')}`;

  let tempDir = null;
  const finalEnv = { ...rawEnv };

  // Normalize environment variables for specific servers
  if (serverType === 'confluence') {
    // Handle various naming conventions for Confluence
    if (rawEnv.CONFLUENCE_BASE_URL && !rawEnv.CONFLUENCE_URL) rawEnv.CONFLUENCE_URL = rawEnv.CONFLUENCE_BASE_URL;
    if (rawEnv.CONFLUENCE_EMAIL && !rawEnv.CONFLUENCE_USER_EMAIL) rawEnv.CONFLUENCE_USER_EMAIL = rawEnv.CONFLUENCE_EMAIL;

    // Inject redundant names for compatibility across different MCP versions
    if (rawEnv.CONFLUENCE_USER_EMAIL) rawEnv.CONFLUENCE_API_MAIL = rawEnv.CONFLUENCE_USER_EMAIL;
    if (rawEnv.CONFLUENCE_API_TOKEN) rawEnv.CONFLUENCE_API_KEY = rawEnv.CONFLUENCE_API_TOKEN;

    // Inject the names expected by @zereight/mcp-confluence
    finalEnv.CONFLUENCE_URL = rawEnv.CONFLUENCE_URL || rawEnv.CONFLUENCE_BASE_URL;
    finalEnv.CONFLUENCE_API_MAIL = rawEnv.CONFLUENCE_USER_EMAIL || rawEnv.CONFLUENCE_EMAIL || rawEnv.CONFLUENCE_API_MAIL;
    finalEnv.CONFLUENCE_API_KEY = rawEnv.CONFLUENCE_API_TOKEN || rawEnv.CONFLUENCE_API_KEY;

    // Explicitly support JIRA_URL within confluence config
    finalEnv.JIRA_URL = rawEnv.JIRA_URL || (finalEnv.CONFLUENCE_URL ? finalEnv.CONFLUENCE_URL.split('/wiki')[0] : undefined);

    console.log(`[Proxy] [${sessionId}] Confluence/Jira Env: URL=${finalEnv.CONFLUENCE_URL}, JIRA=${finalEnv.JIRA_URL}, Mail=${finalEnv.CONFLUENCE_API_MAIL}`);
  }

  // Special handling for Google Drive (File-based credentials)
  if (serverType === 'google-drive') {
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-session-${sessionId}-`));

      if (rawEnv.OAUTH_CLIENT_ID_JSON) {
        const credPath = path.join(tempDir, 'gcp-oauth.keys.json');
        const content = typeof rawEnv.OAUTH_CLIENT_ID_JSON === 'object'
          ? JSON.stringify(rawEnv.OAUTH_CLIENT_ID_JSON)
          : rawEnv.OAUTH_CLIENT_ID_JSON;
        fs.writeFileSync(credPath, content);
        finalEnv.GOOGLE_DRIVE_OAUTH_CREDENTIALS = credPath;
        delete finalEnv.OAUTH_CLIENT_ID_JSON;
      }

      if (rawEnv.OAUTH_TOKEN_JSON) {
        const tokenPath = path.join(tempDir, 'tokens.json');
        const content = typeof rawEnv.OAUTH_TOKEN_JSON === 'object'
          ? JSON.stringify(rawEnv.OAUTH_TOKEN_JSON)
          : rawEnv.OAUTH_TOKEN_JSON;
        fs.writeFileSync(tokenPath, content);
        finalEnv.GOOGLE_DRIVE_MCP_TOKEN_PATH = tokenPath;
        delete finalEnv.OAUTH_TOKEN_JSON;
      }
    } catch (err) {
      console.error(`[Proxy] [${sessionId}] Failed to create temp files:`, err.message);
      return res.status(500).json({ error: 'Session initialization failed' });
    }
  }

  console.log(`[Proxy] [${sessionId}] Spawning ${serverType} process for ${userId}...`);

  const child = spawn(serverDef.cmd, serverDef.args, {
    env: finalEnv,
    stdio: ['pipe', 'pipe', 'inherit']
  });

  sessions.set(sessionId, { child, res, tempDir });

  // Inform client of the POST endpoint for messages
  res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

  // Stream child stdout -> SSE 'message' events
  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      res.write(`event: message\ndata: ${line}\n\n`);
    });
  });

  const cleanup = () => {
    if (sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      console.log(`[Proxy] [${sessionId}] Cleaning up session`);

      if (session.child) session.child.kill();

      if (session.tempDir && fs.existsSync(session.tempDir)) {
        try {
          fs.rmSync(session.tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`[Proxy] [${sessionId}] Temp dir cleanup failed:`, e.message);
        }
      }

      sessions.delete(sessionId);
    }
  };

  child.on('error', (err) => {
    console.error(`[Proxy] [${sessionId}] Process error:`, err.message);
    res.end();
    cleanup();
  });

  child.on('exit', (code) => {
    console.log(`[Proxy] [${sessionId}] Child process exited with code ${code}`);
    res.end();
    cleanup();
  });

  req.on('close', () => {
    cleanup();
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
