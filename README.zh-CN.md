# dsh-opencode-go-usage

一个 DeepSeek Harness Web 插件：在聊天输入框的上下文状态区域旁边显示
**OpenCode Go** 套餐额度。

- 鼠标悬停图标：显示 5 小时滚动额度剩余，并开始自动查询（受 15 秒自动刷新间隔限制）
- 点击图标：展开面板，显示 5h / 每周 / 每月额度的剩余、已用百分比和重置时间
- 当前会话选择的模型提供商是 OpenCode Go 路由时显示图标：`opencode-go`，
  或由它派生的路由键（`opencode-go-extra` 等自定义路由）
- 缓存最后一次成功查询：再次打开时立即显示缓存结果和查询时间，随后后台静默刷新
- 查询进行中时，悬停提示会显示 `刷新中…`；此时点击展开不会重复发起查询
- 自动查询间隔为 15 秒：15 秒内不会重复自动查询，但手动点击“刷新”始终会查询

## 截图

安装并重启 `dsh web` 后，打开一个使用 OpenCode Go 路由的会话（`opencode-go`
或派生的 `opencode-go-extra` 等），输入框右侧会出现一个小图标。点击后弹出：

```text
OpenCode Go 额度
5h    剩余 85%
周    剩余 71%
月    剩余 93%
上次查询: 14:32:08 · 刷新中…
```

## 安装

### 从 GitHub 安装（推荐）

```sh
dsh plugin --profile web add github:GarfieldGCat/dsh-opencode-go-usage
```

安装完成后重启：

```sh
dsh web
```

建议使用 tag 固定版本：

```sh
dsh plugin --profile web add github:GarfieldGCat/dsh-opencode-go-usage#v0.3.0
```

## 兼容性

| dsh 版本 | 状态 |
| --- | --- |
| `0.2.1-rc.2` 及以后 | 支持 |
| `0.1.x` – `0.2.0` | 仍可加载 |

dsh 0.2 会在注册处校验每一个 strict 类型的 Typert 编解码器——`typert.host.js`
里的调用结果编解码器，以及 `client.js` 里对应的描述符——要求它们提供返回
schema 的 `create()` 工厂。只带一个裸 `schema` 的编解码器会被拒绝；而 typert
loader 会把各贡献者的失败聚合上报，所以一个不合规的编解码器会直接中断整个激活
流程，插件完全无法加载：

```text
typert-loader: dsh-opencode-go-usage invocation
"dsh-opencode-go-usage#opencodeUsage/usage" result codec has no create() factory
```

旧版本忽略这个字段，因此本版本采用的 `create()` 写法在两端都能用。具体声明见
`typert.host.js` 和 `client.js` 中的贡献定义。

## 配置

插件行可以通过 web profile 的 `cordis.patch.yml` 覆盖配置：

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

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | `https://opencode.ai/zen/go/v1/usage` | OpenCode Go 用量接口 |
| `timeoutMs` | `15000` | 查询超时时间（毫秒） |
| `providerIds` | `["opencode-go"]` | 出现在「设置 → 模型」里即满足 host 前置检查的路由键；派生的 `opencode-go-*` 路由即使不列在这里也会被识别 |
| `providerId` | — | 已废弃的单值写法，仍兼容 |

浏览器端读不到这份 config，因此它按规则匹配目录 id `opencode-go` 以及任何
`opencode-go-*` 派生路由键。若自定义路由取了别的名字，需要在 `client.js` 的
`isOpenCodeGoRoute` 里补一行。

## API Key 解析顺序

1. DSH credentials seam / 环境变量 `OPENCODE_GO_API_KEY`
2. `~/.local/share/opencode/auth.json` 中的 `opencode-go` 条目
   （找不到时回退到 `opencode`），且 `type` 为 `api`

## 工作原理

### 用量接口

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <API_KEY>
```

返回示例：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 9,  "resetsAt": "..." },
    "weekly":  { "status": "ok", "percent": 12, "resetsAt": "..." },
    "monthly": { "status": "ok", "percent": 6,  "resetsAt": "..." }
  }
}
```

接口返回的是已用百分比，插件显示 `剩余 = 100 - percent`。

### 插件结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 端：提供 `opencodeUsage` Remote 服务，读取 API Key 并查询用量 |
| `typert.host.js` | Typert Host manifest |
| `client.js` | Web 端：在 `conversation.input.right` 注册图标和弹出面板 |
| `cordis.patch.yml` | Bundle patch，自动挂载 Host 插件行 |
| `package.json` | `dsh.bundle` + `dsh.client` 双端声明 |

### 显示条件

Web 端通过 `modelDirectories` 读取当前会话实际选择的 provider：

- provider 是 `opencode-go`，或由它派生的路由键（`opencode-go-*`，例如承载
  目录尚未收录模型的自定义路由 `opencode-go-extra`）：显示图标
- 其他 provider：不显示图标

host 端检查「设置 → 模型」时用的是同一条规则，因此派生路由会返回真实额度，
而不是 `not-in-models`。

自 v0.2.0 起，客户端在 `inject` 中显式声明 `modelDirectories` 依赖，激活会等待
模型选择服务就绪后再注册图标。若不声明，dsh >= 0.1.3（客户端按注入服务逐个
激活插件）可能在该服务建立前执行 `apply` 并静默返回，导致图标不再出现。

## 已知限制

- 用量接口尚未写入 OpenCode 公开文档，未来可能变更。
- 接口只返回使用百分比，不返回金额；插件展示百分比和重置时间。
- 缓存是全局缓存：同一个 OpenCode Go 账号在不同会话中的额度查询结果一致。

## License

MIT

---

[English](./README.md)
