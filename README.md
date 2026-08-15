# dsh-opencode-go-usage

A DeepSeek Harness web plugin that shows your **OpenCode Go** quota next to the
context status area in the chat composer.

- Hover the icon: shows the 5-hour rolling quota remaining and starts an auto refresh (throttled to once every 15 seconds)
- Click the icon: opens a panel with remaining / used percentages and reset times for 5h, weekly, and monthly windows
- The icon is visible only when the current session's selected provider is `opencode-go`
- Caches the last successful result globally: reopening the panel shows cached data and last query time immediately, then refreshes in the background
- While a query is in flight, the hover tooltip shows `refreshing…`; clicking the icon during that time does not start a duplicate request
- Auto refresh is limited to once per 15 seconds; manual refresh always queries

## Demo

After installing and restarting `dsh web`, open a session using `opencode-go`.
A small icon appears on the right side of the composer. Click it to see:

```text
OpenCode Go quota
5h    left 85%
Wk    left 71%
Mo    left 93%
last query: 14:32:08 · refreshing…
```

## Install

### From GitHub (recommended)

```sh
dsh plugin --profile web add github:your-username/dsh-opencode-go-usage
```

Then restart:

```sh
dsh web
```

Pin a release tag for stable installs:

```sh
dsh plugin --profile web add github:your-username/dsh-opencode-go-usage#v0.1.0
```

### From a local directory

```sh
git clone https://github.com/your-username/dsh-opencode-go-usage.git
cd dsh-opencode-go-usage
npm install
dsh plugin --profile web add ./dsh-opencode-go-usage
```

Then restart `dsh web`.

> `npm install` installs `zod`, which `typert.host.js` needs. When installing
> via `dsh plugin add github:...`, pnpm installs `dependencies` automatically.

## Configuration

You can override the plugin config in your web profile's `cordis.patch.yml`:

```yaml
- id: opencode-go-usage
  name: dsh-opencode-go-usage
  config:
    baseUrl: https://opencode.ai/zen/go/v1/usage
    timeoutMs: 15000
    providerId: opencode-go
```

| Key | Default | Description |
| --- | --- | --- |
| `baseUrl` | `https://opencode.ai/zen/go/v1/usage` | OpenCode Go usage endpoint |
| `timeoutMs` | `15000` | Request timeout in milliseconds |
| `providerId` | `opencode-go` | Provider id that must match the current model provider |

## API key resolution

1. DSH credentials seam / environment variable `OPENCODE_GO_API_KEY`
2. `~/.local/share/opencode/auth.json`, entry `opencode-go` (falls back to `opencode`) with `type: "api"`

## How it works

### Usage endpoint

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <API_KEY>
```

Example response:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 9,  "resetsAt": "..." },
    "weekly":  { "status": "ok", "percent": 12, "resetsAt": "..." },
    "monthly": { "status": "ok", "percent": 6,  "resetsAt": "..." }
  }
}
```

The endpoint returns used percentages. The plugin displays `remaining = 100 - percent`.

### Plugin structure

| File | Purpose |
| --- | --- |
| `index.js` | Host side: provides the `opencodeUsage` Remote service, resolves the API key, and queries usage |
| `typert.host.js` | Typert host manifest |
| `client.js` | Web side: registers the icon in `conversation.input.right` and renders the popover |
| `cordis.patch.yml` | Bundle patch that mounts the host plugin automatically |
| `package.json` | Declares `dsh.bundle` + `dsh.client` |

### Visibility condition

The web client reads the current session's selected provider via `modelDirectories`:

- current provider is `opencode-go` → show the icon
- current provider is not `opencode-go` → hide the icon

## Development

```sh
npm install

# Syntax checks
node --check index.js
node --check typert.host.js
node --check client.js
```

For local `link:` installs, run `npm install` in the plugin directory if
`node_modules` is missing.

## Known limitations

- The usage endpoint is undocumented and may change in the future.
- The endpoint only returns percentages, not dollar amounts; the plugin shows percentages and reset times.
- The cache is global: the same OpenCode Go account shares the same quota across sessions.

## License

MIT

---

[中文说明](./README.zh-CN.md)
