# Multi-Tenant MCP Proxy

A containerized gateway that allows multiple users or entities to access GitHub, Jira/Confluence, and Google Drive MCP servers using their own isolated credentials.

## Features
- **Multi-Tenancy**: Every user gets their own isolated MCP process.
- **Dynamic Spawning**: Servers are only started when a user connects.
- **SSE Transport**: Bridges stdio-based MCP servers to the web via Server-Sent Events.
- **Codex-compatible stdio bridge**: Includes a local bridge script so Codex can talk to the SSE proxy through a stdio MCP command.
- **File Shim for Google Drive**: Dynamically creates necessary JSON credentials and token files for Google Drive.

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
    "user_sample": {
      "github": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      },
      "confluence": {
         "CONFLUENCE_URL": "https://your-domain.atlassian.net/wiki",
         "CONFLUENCE_USER_EMAIL": "your@email.com",
         "CONFLUENCE_API_TOKEN": "your-token"
      },
      "google-drive": {
        "OAUTH_CLIENT_ID_JSON": {
          "installed": {
            "client_id": "...",
            "client_secret": "..."
          }
        },
        "OAUTH_TOKEN_JSON": {
          "access_token": "...",
          "refresh_token": "...",
          "token_type": "Bearer",
          "expiry_date": 1234567890123
        }
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

---

## How to Obtain Credentials

### 🐙 GitHub
1. Go to **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**.
2. Generate a token with `repo`, `read:org`, and `user:email`.

### 🏢 Confluence (Atlassian)
1. Go to **Atlassian Account Settings** > **Security** > **Create and manage API tokens**.
2. Create a token and paste it into `CONFLUENCE_API_TOKEN`.

### 📁 Google Drive
To use Google Drive, you need to provide the content of two JSON files in `users.json`. **You must first obtain the Client ID JSON**, then choose one of two options to generate the Token JSON.

#### Phase 1: Obtaining the Client ID JSON
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API**, **Google Docs API**, and **Google Sheets API**.
3. Create a **Desktop app** OAuth client ID under **Credentials**.
4. Download the JSON and paste its content (as a JSON object) into `OAUTH_CLIENT_ID_JSON`.

---

#### Phase 2: Obtaining the Token JSON (Choose ONE Option)

> [!IMPORTANT]
> You only need to do this once on your local machine to get the JSON content for `users.json`.

**Option A: Using the MCP CLI (Easiest if you have Node.js locally)**
1. Ensure your Client ID JSON is in your current directory as `gcp-oauth.keys.json`.
2. Run: `npx @piotr-agier/google-drive-mcp auth`.
3. Complete the browser login.
4. Copy the resulting token file (usually `tokens.json`) as a JSON object into `OAUTH_TOKEN_JSON`.

**Option B: Using OAuth 2.0 Playground (Preferred for Headless/Remote)**
1. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. In Settings (Gear icon), check **Use your own OAuth credentials** and enter your Client ID/Secret.
3. In Step 1, select/authorize these scopes:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/spreadsheets`
4. Click **Exchange authorization code for tokens** in Step 2.
5. Copy the JSON object into `OAUTH_TOKEN_JSON`.

---

## API Usage

To connect to a specific MCP server for a specific user, use the following SSE URL pattern:

`GET http://localhost:3000/:userId/:serverType/sse`

| Server Type | Connection URL |
| :--- | :--- |
| **GitHub** | `http://localhost:3000/:userId/github/sse` |
| **Jira** | `http://localhost:3000/:userId/jira/sse` |
| **Confluence**| `http://localhost:3000/:userId/confluence/sse` |
| **Google Drive** | `http://localhost:3000/:userId/google-drive/sse` |

`jira` is an Atlassian alias backed by the same credentials/config used for `confluence`.

## Codex Compatibility

Codex MCP `--url` expects a streamable HTTP MCP server. This proxy exposes SSE plus a separate POST endpoint, so for Codex you should use the bundled stdio bridge instead of pointing Codex directly at `/sse`.

Bridge command:

```bash
node /absolute/path/to/codex-stdio-bridge.js http://localhost:3000/<user>/<server>/sse
```

Example Codex config values:

```toml
[mcp_servers.github]
command = "node"
args = ["/absolute/path/to/codex-stdio-bridge.js", "http://localhost:3000/mex/github/sse"]

[mcp_servers.jira]
command = "node"
args = ["/absolute/path/to/codex-stdio-bridge.js", "http://localhost:3000/mex/jira/sse"]
```

This avoids transport mismatches and makes the proxy reusable for future Codex agents.
