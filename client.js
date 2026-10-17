// Client half of the dsh-opencode-go-usage plugin.
//
// Adds a small OpenCode Go quota icon next to the composer's context meter
// (the "context status" area). The icon is visible while the current session's
// selected provider is an OpenCode Go route: the installed catalog id
// `opencode-go`, or a route key derived from it (`opencode-go-*`, e.g. a
// hand-declared route carrying models the built-in catalog has not caught up
// with yet). Clicking it opens a popover with the 5h rolling / weekly / monthly
// remaining quota.
window.__ModuleLoader__.load({
  id: "dsh-opencode-go-usage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const NS = "settings.opencodeGoUsage";
    const PROVIDER_ID = "opencode-go";
    // OpenCode Go routes: the installed pi-ai catalog id plus every route key
    // derived from it (`opencode-go-extra`, ...). The quota is account-wide, so
    // a custom route pointing at the same endpoint shows the same icon. This
    // rule is fixed here because the client half cannot read the cordis row
    // config (the client `apply` receives no config); it mirrors the host
    // half's derived-route recognition in index.js.
    const isOpenCodeGoRoute = (provider) =>
      typeof provider === "string"
      && (provider === PROVIDER_ID || provider.startsWith(`${PROVIDER_ID}-`));
    // Last successful usage result. OpenCode Go quota is account/provider-wide,
    // so the cache is global rather than per-session.
    let lastResult = null;

    // Global in-flight query state so multiple composer icons never issue
    // duplicate OpenCode Go requests at the same time.
    const AUTO_REFRESH_MS = 15000;
    const queryState = {
      refreshing: false,
      listeners: new Set(),
      get() {
        return this.refreshing;
      },
      set(value) {
        if (this.refreshing === value) return;
        this.refreshing = value;
        for (const listener of this.listeners) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };

    // Required client services: slots for the composer right-side seat, locale
    // for copy, remote for the Host RPC, and modelDirectories to read the
    // current session's selected provider. modelDirectories must be declared
    // here so activation waits for it: dsh >= 0.1.3 activates client rows as
    // their injected services resolve, and probing it with ctx.get() at apply
    // time can run before the service exists, silently dropping the icon.
    const inject = ["slots", "locale", "remote", "modelDirectories"];

    const zh = {
      title: "OpenCode Go 额度",
      loading: "查询中…",
      notInModels: "尚未选择 opencode-go 提供商。",
      noApiKey: "未找到 OpenCode Go API Key（OPENCODE_GO_API_KEY / auth.json）。",
      unauthorized: "API Key 无效或已过期（401）。",
      network: "网络请求失败，请稍后重试。",
      httpError: "接口返回 HTTP {status}。",
      badJson: "接口响应解析失败。",
      refresh: "刷新",
      rolling: "5h",
      weekly: "周",
      monthly: "月",
      remaining: "剩余",
      used: "已用",
      reset: "重置",
      lastQuery: "上次查询",
      refreshing: "刷新中…",
      noData: "暂无数据",
      unknown: "未知",
    };
    const en = {
      title: "OpenCode Go quota",
      loading: "Loading…",
      notInModels: "opencode-go is not the selected provider.",
      noApiKey: "No OpenCode Go API key found (OPENCODE_GO_API_KEY / auth.json).",
      unauthorized: "API key is invalid or expired (401).",
      network: "Network request failed, try again later.",
      httpError: "HTTP {status} from the usage endpoint.",
      badJson: "Failed to parse the usage response.",
      refresh: "Refresh",
      rolling: "5h",
      weekly: "Wk",
      monthly: "Mo",
      remaining: "left",
      used: "used",
      reset: "resets",
      lastQuery: "last query",
      refreshing: "refreshing…",
      noData: "no data",
      unknown: "unknown",
    };

    // Result codec of this Remote, mirroring the host manifest in typert.host.js.
    // dsh >= 0.2 validates every strict codec where it is registered and requires
    // a `create()` factory; the bare `schema` object this plugin used before is
    // rejected there with "result strict codec has no create() factory", which
    // aborts the whole client plugin. zod is required lazily because it is a
    // dsh >= 0.2 platform seed module: on older releases this factory is never
    // called (nothing validated it) and the bundle keeps loading without zod.
    let resultSchema;
    const createResultSchema = () => {
      if (resultSchema !== undefined) return resultSchema;
      const zod = require("zod");
      const windowSchema = zod.object({
        status: zod.string().nullable(),
        percent: zod.number().nullable(),
        resetsAt: zod.string().nullable(),
      });
      resultSchema = zod.object({
        configured: zod.boolean(),
        reason: zod.string().nullable(),
        error: zod.string().nullable(),
        usage: zod.object({
          rolling: windowSchema.nullable(),
          weekly: windowSchema.nullable(),
          monthly: windowSchema.nullable(),
        }).nullable(),
      });
      return resultSchema;
    };

    // Client-side Remote contribution.
    const TYPERT_REMOTE = {
      package: "dsh-opencode-go-usage",
      descriptors: [
        {
          id: "dsh-opencode-go-usage#opencodeUsage/usage",
          service: "opencodeUsage",
          namespace: "opencodeUsage",
          method: "usage",
          invocation: { kind: "direct" },
          parameters: [],
          result: {
            mode: "strict",
            typeSymbol: "dsh-opencode-go-usage#OpencodeUsageResult",
            create: createResultSchema,
          },
        },
      ],
    };

    const styles = {
      iconButton: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        margin: 0,
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 6,
        background: "transparent",
        color: "var(--dsw-alias-label-secondary)",
        cursor: "pointer",
        font: "inherit",
      },
      tooltip: {
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        whiteSpace: "nowrap",
        background: "var(--dsw-alias-bg-overlay)",
        color: "var(--dsw-alias-label-primary)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        lineHeight: 1.4,
        pointerEvents: "none",
        boxShadow: "0 4px 16px rgba(0,0,0,.16)",
      },
      tooltipRefresh: {
        marginLeft: 6,
        color: "var(--dsw-alias-label-tertiary)",
      },
      panel: {
        position: "absolute",
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 20,
        width: 280,
        maxWidth: "70vw",
        background: "var(--dsw-alias-bg-layer-3)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontSize: 13,
      },
      panelTitle: {
        margin: 0,
        fontSize: 14,
        fontWeight: 600,
      },
      row: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 8,
        color: "var(--dsw-alias-label-secondary)",
      },
      rowName: {
        fontWeight: 600,
        color: "var(--dsw-alias-label-primary)",
      },
      barTrack: {
        height: 4,
        borderRadius: 2,
        background: "var(--dsw-alias-bg-layer-1)",
        overflow: "hidden",
        marginTop: 2,
      },
      barFill: {
        height: "100%",
        borderRadius: 2,
        background: "var(--dsw-alias-state-business-primary)",
      },
      hint: {
        margin: 0,
        color: "var(--dsw-alias-label-tertiary)",
        lineHeight: 1.5,
      },
      error: {
        margin: 0,
        color: "var(--dsw-alias-state-error-primary)",
        lineHeight: 1.5,
      },
      button: {
        alignSelf: "flex-start",
        border: "1px solid var(--dsw-alias-border-l2)",
        color: "var(--dsw-alias-label-primary)",
        font: "inherit",
        cursor: "pointer",
        background: "transparent",
        borderRadius: 6,
        padding: "3px 10px",
        fontSize: 12,
      },
    };

    function fmtReset(resetsAt, t) {
      if (!resetsAt) return t("unknown");
      const d = new Date(resetsAt);
      if (Number.isNaN(d.getTime())) return resetsAt;
      return d.toLocaleString();
    }

    function WindowRow({ name, windowData, t }) {
      const percent = windowData && typeof windowData.percent === "number" ? windowData.percent : null;
      const pct = percent === null ? 0 : Math.max(0, Math.min(100, percent));
      const remaining = percent === null ? null : Math.max(0, Math.min(100, 100 - percent));
      return React.createElement("div", null,
        React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.rowName }, name),
          React.createElement("span", null, remaining === null ? t("unknown") : `${t("remaining")} ${remaining}%`)
        ),
        React.createElement("div", { style: styles.barTrack },
          React.createElement("div", { style: { ...styles.barFill, width: `${pct}%` } })
        ),
        React.createElement("div", { style: styles.row },
          React.createElement("span", null, percent === null ? "" : `${t("used")} ${percent}%`),
          React.createElement("span", null, `${t("reset")}: ${fmtReset(windowData && windowData.resetsAt, t)}`)
        )
      );
    }

    function UsagePopover({ state, t, onRefresh, refreshing, queriedAt }) {
      const meta = [];
      if (queriedAt) {
        meta.push(`${t("lastQuery")}: ${queriedAt.toLocaleTimeString()}`);
      }
      if (refreshing) {
        meta.push(t("refreshing"));
      }
      const metaLine = meta.length > 0
        ? React.createElement("p", { style: styles.hint }, meta.join(" · "))
        : null;

      if (state.kind === "loading" || state.kind === "idle") {
        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          React.createElement("p", { style: styles.hint }, t("loading")),
          metaLine
        );
      }
      if (state.kind === "failure") {
        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          React.createElement("p", { style: styles.error }, state.message),
          React.createElement("button", { style: styles.button, onClick: onRefresh }, t("refresh")),
          metaLine
        );
      }
      const value = state.value || {};
      if (value.configured !== true) {
        const msg = value.reason === "no-api-key" ? t("noApiKey") : t("notInModels");
        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          React.createElement("p", { style: styles.error }, msg),
          React.createElement("button", { style: styles.button, onClick: onRefresh }, t("refresh")),
          metaLine
        );
      }
      if (value.error) {
        let msg = value.error;
        if (value.error === "unauthorized") msg = t("unauthorized");
        else if (value.error === "network") msg = t("network");
        else if (value.error === "bad-json") msg = t("badJson");
        else if (value.error.startsWith("http-")) msg = t("httpError").replace("{status}", value.error.slice(5));
        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          React.createElement("p", { style: styles.error }, msg),
          React.createElement("button", { style: styles.button, onClick: onRefresh }, t("refresh")),
          metaLine
        );
      }
      const usage = value.usage || {};
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement(WindowRow, { name: t("rolling"), windowData: usage.rolling, t }),
        React.createElement(WindowRow, { name: t("weekly"), windowData: usage.weekly, t }),
        React.createElement(WindowRow, { name: t("monthly"), windowData: usage.monthly, t }),
        React.createElement("button", { style: styles.button, onClick: onRefresh }, t("refresh")),
        metaLine
      );
    }

    function OpenCodeGoUsageIcon(props) {
      const { directory, query, t } = props;
      const [dirState, setDirState] = React.useState(() => directory.getSnapshot());
      React.useEffect(() => directory.subscribe(() => setDirState(directory.getSnapshot())), [directory]);
      const provider = dirState.current && dirState.current.provider;
      const [open, setOpen] = React.useState(false);
      const [hover, setHover] = React.useState(false);
      const [refreshing, setRefreshing] = React.useState(queryState.get());
      const [cache, setCache] = React.useState(() => lastResult);
      const [state, setState] = React.useState(() => {
        return lastResult ? { kind: "done", value: lastResult.value } : { kind: "idle" };
      });
      const rootRef = React.useRef(null);

      React.useEffect(() => queryState.subscribe(() => setRefreshing(queryState.get())), []);

      const refresh = React.useCallback(() => {
        // One global in-flight query at a time.
        if (queryState.get()) return;
        queryState.set(true);
        Promise.resolve()
          .then(() => query())
          .then((result) => {
            if (!result || result.ok === false) {
              const cached = lastResult;
              if (cached) {
                setState({ kind: "done", value: cached.value });
              } else {
                setState({ kind: "failure", message: (result && result.error && result.error.message) || "remote failed" });
              }
              return;
            }
            const entry = { value: result.value, queriedAt: new Date() };
            lastResult = entry;
            setCache(entry);
            setState({ kind: "done", value: result.value });
          })
          .catch((e) => {
            const cached = lastResult;
            if (cached) {
              setState({ kind: "done", value: cached.value });
            } else {
              setState({ kind: "failure", message: String((e && e.message) || e) });
            }
          })
          .finally(() => queryState.set(false));
      }, [query]);

      const maybeAutoRefresh = React.useCallback(() => {
        // If a query is already in flight, do not start another one.
        if (queryState.get()) return;
        // Auto refresh is throttled to once per 15 seconds.
        const last = lastResult;
        if (last && Date.now() - last.queriedAt.getTime() < AUTO_REFRESH_MS) return;
        refresh();
      }, [refresh]);

      const toggleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next) {
          const cached = lastResult;
          if (cached) {
            setState({ kind: "done", value: cached.value });
          } else {
            setState({ kind: "loading" });
          }
          maybeAutoRefresh();
        }
      };

      const handleMouseEnter = () => {
        setHover(true);
        maybeAutoRefresh();
      };
      const handleMouseLeave = () => setHover(false);

      React.useEffect(() => {
        if (!open) return;
        const onPointerDown = (e) => {
          if (e.target instanceof Node && rootRef.current && rootRef.current.contains(e.target) === true) return;
          setOpen(false);
        };
        const onKeyDown = (e) => {
          if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);

      if (!isOpenCodeGoRoute(provider)) return null;

      const cached = cache || lastResult;
      const rolling = cached && cached.value && cached.value.usage && cached.value.usage.rolling;
      let tooltipContent;
      if (rolling && typeof rolling.percent === "number") {
        const remaining = Math.max(0, Math.min(100, 100 - rolling.percent));
        tooltipContent = React.createElement(React.Fragment, null,
          `${t("rolling")} ${t("remaining")} ${remaining}%`,
          refreshing && React.createElement("span", { style: styles.tooltipRefresh }, `⟳ ${t("refreshing")}`)
        );
      } else if (refreshing) {
        tooltipContent = React.createElement("span", { style: styles.tooltipRefresh }, `⟳ ${t("loading")}`);
      } else {
        tooltipContent = t("noData");
      }

      return React.createElement("span", { ref: rootRef, style: { position: "relative", display: "inline-flex", alignItems: "center" } },
        React.createElement("button", {
          type: "button",
          style: styles.iconButton,
          "aria-label": t("title"),
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          onClick: toggleOpen,
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleMouseLeave,
        },
          React.createElement("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": true },
            React.createElement("path", {
              d: "M2 13h12M4 11V7m4 4V4m4 7V6",
              stroke: "currentColor",
              strokeWidth: 1.5,
              strokeLinecap: "round",
              fill: "none",
            })
          )
        ),
        hover && tooltipContent && React.createElement("div", { style: styles.tooltip }, tooltipContent),
        open && React.createElement("div", { style: styles.panel, role: "dialog", "aria-label": t("title") },
          React.createElement("h4", { style: styles.panelTitle }, t("title")),
          React.createElement(UsagePopover, {
            state,
            t,
            onRefresh: refresh,
            refreshing,
            queriedAt: cached && cached.queriedAt,
          })
        )
      );
    }

    function apply(ctx) {
      const mountReady = ctx.remote.$mount(TYPERT_REMOTE);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "opencode-go-usage: dictionaries");
      const t = ctx.locale.bind(NS);

      const query = async () => {
        await mountReady;
        const api = ctx.get("remote.opencodeUsage");
        if (!api) throw new Error("opencodeUsage remote is unavailable");
        return api.usage();
      };

      let modelDirectories;
      try {
        modelDirectories = ctx.get("modelDirectories");
      } catch {
        modelDirectories = undefined;
      }
      if (!modelDirectories || typeof modelDirectories.directoryFor !== "function") return;

      ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
        name: "conversation.input.right",
        id: "opencode-go-usage",
        order: 20,
        locale: NS,
        inject: (sessionId) => ({
          directory: modelDirectories.directoryFor(sessionId).store,
          query,
          t,
        }),
      }, OpenCodeGoUsageIcon));
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
