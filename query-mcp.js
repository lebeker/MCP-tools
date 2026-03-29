const http = require('http');

const USER_ID = process.env.USER_ID || 'mex';
const SERVER_TYPE = process.env.SERVER_TYPE || 'jira';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REQUEST_METHOD = process.env.REQUEST_METHOD || 'tools/call';
const TOOL_NAME = process.env.TOOL_NAME;
const TOOL_ARGS = process.env.TOOL_ARGS ? JSON.parse(process.env.TOOL_ARGS) : {};
const REQUEST_PARAMS = process.env.REQUEST_PARAMS ? JSON.parse(process.env.REQUEST_PARAMS) : {};
const TOOLS_NAMES_ONLY = process.env.TOOLS_NAMES_ONLY === '1';

if (REQUEST_METHOD === 'tools/call' && !TOOL_NAME) {
  console.error('TOOL_NAME is required');
  process.exit(1);
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function createRequest(id, method, params) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
}

async function main() {
  const req = http.get(`${BASE_URL}/${USER_ID}/${SERVER_TYPE}/sse`, (res) => {
    let endpoint = null;
    let buffer = '';
    let initialized = false;

    res.on('data', async (chunk) => {
      buffer += chunk.toString();

      while (buffer.includes('\n\n')) {
        const boundary = buffer.indexOf('\n\n');
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = rawEvent.split('\n');
        const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
        const data = lines
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');

        if (event === 'endpoint') {
          endpoint = data;
          const response = await postJson(`${BASE_URL}${endpoint}`, createRequest(1, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'query-mcp',
              version: '1.0.0'
            }
          }));
          if (response.statusCode !== 202) {
            console.error(`POST failed: ${response.statusCode} ${response.body}`);
            process.exit(1);
          }
        }

        if (event === 'message' && data.includes('"id":1')) {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log(JSON.stringify(parsed, null, 2));
            process.exit(1);
          }

          if (!initialized) {
            initialized = true;

            const notifyResponse = await postJson(`${BASE_URL}${endpoint}`, {
              jsonrpc: '2.0',
              method: 'notifications/initialized',
              params: {}
            });
            if (notifyResponse.statusCode !== 202) {
              console.error(`POST failed: ${notifyResponse.statusCode} ${notifyResponse.body}`);
              process.exit(1);
            }

            const requestParams = REQUEST_METHOD === 'tools/call'
              ? {
                  name: TOOL_NAME,
                  arguments: TOOL_ARGS
                }
              : REQUEST_PARAMS;

            const toolResponse = await postJson(
              `${BASE_URL}${endpoint}`,
              createRequest(2, REQUEST_METHOD, requestParams)
            );
            if (toolResponse.statusCode !== 202) {
              console.error(`POST failed: ${toolResponse.statusCode} ${toolResponse.body}`);
              process.exit(1);
            }
            continue;
          }
        }

        if (event === 'message' && data.includes('"id":2')) {
          const parsed = JSON.parse(data);
          if (REQUEST_METHOD === 'tools/list' && TOOLS_NAMES_ONLY && parsed?.result?.tools) {
            const names = parsed.result.tools
              .map((tool) => tool?.name)
              .filter((name) => typeof name === 'string' && name.length > 0);
            console.log(JSON.stringify({ count: names.length, tools: names }, null, 2));
          } else {
            console.log(JSON.stringify(parsed, null, 2));
          }
          process.exit(parsed.error || parsed.result?.isError ? 1 : 0);
        }
      }
    });
  });

  req.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });

  setTimeout(() => {
    console.error('Timed out waiting for MCP response');
    process.exit(1);
  }, 15000);
}

main();
