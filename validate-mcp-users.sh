#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -gt 0 ]; then
  USERS=("$@")
else
  USERS=()
  while IFS= read -r user; do
    USERS+=("$user")
  done < <(node -e 'console.log(Object.keys(require("./users.json").users || {}).join("\n"))' \
    "$SCRIPT_DIR/users.json")
fi

if [ "${#USERS[@]}" -eq 0 ]; then
  echo "No users found"
  exit 1
fi

overall=0

run_tools_list() {
  local user_id="$1"
  local server_type="$2"

  local output
  local status=0
  output="$(cd "$SCRIPT_DIR" && USER_ID="$user_id" SERVER_TYPE="$server_type" BASE_URL="$BASE_URL" REQUEST_METHOD="tools/list" TOOLS_NAMES_ONLY="1" node query-mcp.js 2>&1)" || status=$?

  local summary
  summary="$(printf '%s' "$output" | node -e '
    let input = "";
    function parseJson(raw) {
      try {
        return JSON.parse(raw);
      } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try {
            return JSON.parse(raw.slice(start, end + 1));
          } catch {
            return null;
          }
        }
        return null;
      }
    }
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const parsed = parseJson(input);
      if (!parsed) {
        console.log(`RAW:${input}`);
        process.exit(0);
      }

      if (parsed?.error) {
        console.log(`FAIL (${parsed.error?.message || JSON.stringify(parsed.error)})`);
        process.exit(0);
      }

      const names = Array.isArray(parsed?.tools)
        ? parsed.tools.filter((tool) => typeof tool === "string" && tool.length > 0)
        : [];
      if (names.length === 0) {
        console.log("OK (0 tools)");
        return;
      }

      console.log(`OK (${names.length} tools) ${names.join(", ")}`);
    });
  ')"

  if [ "$status" -ne 0 ] && [[ "$summary" == RAW:* ]]; then
    printf '  - %s tools: FAIL (%s)\n' "$server_type" "${summary#RAW:}"
    overall=1
    return
  fi

  if [[ "$summary" == RAW:* ]]; then
    printf '  - %s tools: FAIL (%s)\n' "$server_type" "${summary#RAW:}"
    overall=1
    return
  fi

  printf '  - %s tools: %s\n' "$server_type" "$summary"
  case "$summary" in
    FAIL*) overall=1 ;;
  esac
}

run_check() {
  local user_id="$1"
  local server_type="$2"
  local tool_name="$3"
  local tool_args="$4"

  local output
  local status=0
  output="$(cd "$SCRIPT_DIR" && USER_ID="$user_id" SERVER_TYPE="$server_type" BASE_URL="$BASE_URL" TOOL_NAME="$tool_name" TOOL_ARGS="$tool_args" node query-mcp.js 2>&1)" || status=$?

  local summary
  summary="$(printf '%s' "$output" | node -e '
    let input = "";
    function parseJson(raw) {
      try {
        return JSON.parse(raw);
      } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try {
            return JSON.parse(raw.slice(start, end + 1));
          } catch {
            return null;
          }
        }
        return null;
      }
    }
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const parsed = parseJson(input);
      if (!parsed) {
        console.log(`RAW:${input}`);
        process.exit(0);
      }
      if (parsed?.result?.isError) {
        const text = (parsed.result.content || []).map((item) => item?.text || JSON.stringify(item)).join("\n").trim();
        console.log(`FAIL (${text || "tool call failed"})`);
        process.exit(0);
      }
      const content = parsed?.result?.content || [];
      const text = content.map((item) => item?.text || JSON.stringify(item)).join("\n").trim();
      try {
        const nested = JSON.parse(text);
        const size =
          Array.isArray(nested?.issues) ? nested.issues.length :
          Array.isArray(nested) ? nested.length :
          Array.isArray(nested?.results) ? nested.results.length :
          null;
        console.log(size === null ? "OK" : `OK (${size} items)`);
      } catch {
        console.log(text ? `OK (${text})` : "OK");
      }
    });
  ')"

  if [ "$status" -ne 0 ] && [[ "$summary" == RAW:* ]]; then
    printf '  - %s: FAIL (%s)\n' "$server_type" "${summary#RAW:}"
    overall=1
    return
  fi

  if [[ "$summary" == RAW:* ]]; then
    summary="OK"
  fi

  printf '  - %s: %s\n' "$server_type" "$summary"
  case "$summary" in
    FAIL*) overall=1 ;;
  esac
}

for user_id in "${USERS[@]}"; do
  echo "$user_id"
  run_tools_list "$user_id" "github"
  run_tools_list "$user_id" "jira"
  run_check "$user_id" "jira" "jira_get_all_projects" '{}'
  run_tools_list "$user_id" "confluence"
  run_check "$user_id" "confluence" "confluence_search" '{"query":"type=page ORDER BY lastmodified DESC","limit":1}'
done

exit "$overall"
