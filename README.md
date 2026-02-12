# Multi-Tenant MCP Proxy

A containerized gateway that allows multiple users or entities to access GitHub, Confluence, and Google Drive MCP servers using their own isolated credentials.

## Features
- **Multi-Tenancy**: Every user gets their own isolated MCP process.
- **Dynamic Spawning**: Servers are only started when a user connects.
- **SSE Transport**: Bridges stdio-based MCP servers to the web via Server-Sent Events.
- **Automatic Lifecycle**: Processes are terminated automatically when the client disconnects.

## Quick Start

### 1. Configuration
Copy the template and define your users and their tokens.

```bash
cp users.template.json users.json
```

**`users.json` Structure:**
```json
{
  "users": {
    "john_doe": {
      "github": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    },
    "acme_corp": {
      "confluence": {
         "CONFLUENCE_BASE_URL": "...",
         "CONFLUENCE_EMAIL": "...",
         "CONFLUENCE_API_TOKEN": "..."
      }
    }
  }
}
```

### 2. Deployment
Run the proxy using Docker Compose:

```bash
docker-compose up --build
```

The gateway will be available at `http://localhost:3000`.

## API Usage

To connect to a specific MCP server for a specific user, use the following SSE URL pattern:

`GET http://localhost:3000/:userId/:serverType/sse`

### Examples

| Server Type | Connection URL |
| :--- | :--- |
| **GitHub** | `http://localhost:3000/john_doe/github/sse` |
| **Confluence**| `http://localhost:3000/acme_corp/confluence/sse` |
| **Google Drive** | `http://localhost:3000/john_doe/google-drive/sse` |

### Connection Lifecycle

1. **Initiate**: The client opens an SSE connection to the URL.
2. **Endpoint Event**: The proxy sends an `endpoint` event containing the POST URL for messages (e.g., `/message?sessionId=john_doe-github-12345`).
3. **Messages**: The client receives MCP responses via `message` events in the SSE stream.
4. **Commands**: The client sends MCP requests (JSON-RPC) via `POST` to the provided endpoint.
5. **Disconnect**: Closing the SSE connection kills the underlying `npx` process.

## Supported MCPs
- **GitHub**: `@modelcontextprotocol/server-github` (2025.4.8)
- **Confluence**: `@zereight/mcp-confluence` (1.0.8)
- **Google Drive**: `@piotr-agier/google-drive-mcp` (1.1.2)
