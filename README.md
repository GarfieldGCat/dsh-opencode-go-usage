# dsh-opencode-go-usage

A DeepSeek Harness web plugin that shows your **OpenCode Go** quota next to the
context status area in the chat composer.

- Hover the icon: shows the 5-hour rolling quota remaining and starts an auto refresh (throttled to once every 15 seconds)
- Click the icon: opens a panel with remaining / used percentages and reset times for 5h, weekly, and monthly windows
- The icon is visible when the current session's selected provider is an OpenCode Go route: `opencode-go` or a route key derived from it (`opencode-go-extra`, ...)
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
dsh plugin --profile web add github:GarfieldGCat/dsh-opencode-go-usage
```

Then restart:

```sh
dsh web
```

Pin a release tag for stable installs:

```sh
dsh plugin --profile web add github:GarfieldGCat/dsh-opencode-go-usage#v0.2.1
```

## Configuration

You can override the plugin config in your web profile's `cordis.patch.yml`:

```yaml
- id: opencode-go-usage
  name: dsh-opencode-go-usage
  config:
    baseUrl: https://opencode.ai/zen/go/v1/usage
    timeoutMs: 15000
    providerIds:
      - opencode-go
      - opencode-go-extra
```

| Key | Default | Description |
| --- | --- | --- |
| `baseUrl` | `https://opencode.ai/zen/go/v1/usage` | OpenCode Go usage endpoint |
| `timeoutMs` | `15000` | Request timeout in milliseconds |
| `providerIds` | `["opencode-go"]` | Route keys whose presence in Settings → Models satisfies the host precondition. Derived `opencode-go-*` routes count even when they are not listed. |
| `providerId` | — | Deprecated single-key form of `providerIds`; still accepted |

The browser half cannot read this config, so it matches the catalog id
`opencode-go` plus any `opencode-go-*` derived key by rule. A custom route named
anything else needs a one-line change to `isOpenCodeGoRoute` in `client.js`.

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

- provider is `opencode-go`, or any route key derived from it (`opencode-go-*`, e.g. a custom `opencode-go-extra` route serving models the installed pi-ai catalog has not shipped yet) → show the icon
- any other provider → hide the icon

The host half applies the same rule when it checks Settings → Models, so a
derived route reports real quota instead of `not-in-models`.

Since v0.2.0 the client declares `modelDirectories` in its `inject` list, so
activation waits for the model-selection service before registering the icon.
Without that declaration, dsh >= 0.1.3 (which activates client rows as their
injected services resolve) could run `apply` before the service exists and
silently never show the icon.

## Known limitations

- The usage endpoint is undocumented and may change in the future.
- The endpoint only returns percentages, not dollar amounts; the plugin shows percentages and reset times.
- The cache is global: the same OpenCode Go account shares the same quota across sessions.

## License

MIT

---

[中文说明](./README.zh-CN.md)
