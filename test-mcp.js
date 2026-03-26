const http = require('http');

const USER_ID = process.env.USER_ID || 'mex';
const SERVER_TYPE = process.env.SERVER_TYPE || 'github';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function test() {
  console.log(`[Test] Connecting to SSE: ${BASE_URL}/${USER_ID}/${SERVER_TYPE}/sse`);

  const req = http.get(`${BASE_URL}/${USER_ID}/${SERVER_TYPE}/sse`, (res) => {
    let sessionId = null;

    res.on('data', async (chunk) => {
      const content = chunk.toString();
      console.log(`[SSE Data]:\n${content}`);

      // Check for endpoint event
      if (content.includes('event: endpoint')) {
        const match = content.match(/data: (.+)/);
        if (match) {
          const endpoint = match[1];
          sessionId = new URLSearchParams(endpoint.split('?')[1]).get('sessionId');
          console.log(`[Test] Found Session ID: ${sessionId}`);

          // Send tools/list request
          const listRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {}
          };

          console.log(`[Test] Sending tools/list request...`);
          const postData = JSON.stringify(listRequest);
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
      }

      // Check for message response
      if (content.includes('event: message') && content.includes('"result"')) {
        try {
          const jsonStr = content.split('data: ')[1];
          const response = JSON.parse(jsonStr);
          if (response.result && response.result.tools) {
            console.log('\n🛠 Available Tools:');
            response.result.tools.forEach(t => console.log(` - ${t.name}: ${t.description.split('.')[0]}`));
            console.log(`\n✅ [Success] Received tools/list response!`);
            process.exit(0);
          }
        } catch (e) {
          // Chunking might split JSON, but usually tools/list fits in one frame or we'd need a buffer
          console.log('[Info] Waiting for full tool list chunk...');
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
