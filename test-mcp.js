const http = require('http');

const USER_ID = process.env.USER_ID || 'mex';
const SERVER_TYPE = process.env.SERVER_TYPE || 'github';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function test() {
  console.log(`[Test] Connecting to SSE: ${BASE_URL}/${USER_ID}/${SERVER_TYPE}/sse`);

  const req = http.get(`${BASE_URL}/${USER_ID}/${SERVER_TYPE}/sse`, (res) => {
    let sessionId = null;
    let buffer = '';
    let initialized = false;

    res.on('data', async (chunk) => {
      buffer += chunk.toString();
      console.log(`[SSE Data]:\n${chunk.toString()}`);

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
          sessionId = new URLSearchParams(data.split('?')[1]).get('sessionId');
          console.log(`[Test] Found Session ID: ${sessionId}`);
          console.log('[Test] Sending initialize request...');

          const initRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: {
                name: 'test-mcp',
                version: '1.0.0'
              }
            }
          };

          const postData = JSON.stringify(initRequest);
          const postReq = http.request(`${BASE_URL}/message?sessionId=${sessionId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': postData.length
            }
          }, (postRes) => {
            console.log(`[Post Status]: ${postRes.statusCode}`);
          });

          postReq.write(postData);
          postReq.end();
        }

        if (event === 'message') {
          let response;
          try {
            response = JSON.parse(data);
          } catch (e) {
            continue;
          }

          if (response.id === 1) {
            if (response.error) {
              console.error(JSON.stringify(response, null, 2));
              process.exit(1);
            }

            if (!initialized) {
              initialized = true;

              const initializedNotification = JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
                params: {}
              });
              const initReq = http.request(`${BASE_URL}/message?sessionId=${sessionId}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': initializedNotification.length
                }
              });
              initReq.write(initializedNotification);
              initReq.end();

              const listRequest = JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
              });

              console.log('[Test] Sending tools/list request...');
              const listReq = http.request(`${BASE_URL}/message?sessionId=${sessionId}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': listRequest.length
                }
              }, (postRes) => {
                console.log(`[Post Status]: ${postRes.statusCode}`);
              });

              listReq.write(listRequest);
              listReq.end();
            }
          }

          if (response.id === 2 && response.result && response.result.tools) {
            console.log('\n🛠 Available Tools:');
            response.result.tools.forEach(t => console.log(` - ${t.name}: ${t.description.split('.')[0]}`));
            console.log(`\n✅ [Success] Received tools/list response!`);
            process.exit(0);
          }
        }
      }
    });
  });

  req.on('error', (e) => {
    console.error(`[Error]: ${e.message}`);
    process.exit(1);
  });

  // Timeout after 15 seconds
  setTimeout(() => {
    console.log('⏰ [Timeout] No response received');
    process.exit(1);
  }, 15000);
}

test();
