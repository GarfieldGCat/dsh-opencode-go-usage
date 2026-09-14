// Host half of the dsh-opencode-go-usage plugin.
//
// This file is intentionally dependency-free at runtime: it uses only Node
// builtins plus the Cordis context methods. That keeps local `link:` installs
// working even when the plugin lives outside the dsh package tree.
//
// It publishes the "opencodeUsage" Cordis service (a Typert Remote) whose
// usage() method is callable from the browser settings page over the /api RPC
// carrier. The Typert host manifest in typert.host.js drives strict-mode
// dispatch.
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export const name = "dsh-opencode-go-usage";

// No hard dependency injection: the plugin reads optional services at runtime
// so a missing service degrades to a friendly "not configured" result instead
// of failing to load.
export const inject = [];

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1/usage";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PROVIDER_ID = "opencode-go";
const PROVIDER_SETTINGS_NS = "llm-pi-ai";
const API_KEY_REF = "OPENCODE_GO_API_KEY";

// ── minimal Typert Remote binding (no @deepseek-ai/dsh-typert-protocol import) ──

const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

function isTypertRemoteSegment(value) {
  return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}

function validateName(subject, value) {
  if (!isTypertRemoteSegment(value)) {
    throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
  }
}

function bindTypertRemote(service, serviceKey, options = {}) {
  validateName("service key", serviceKey);
  const namespace = options.namespace ?? serviceKey;
  validateName("namespace", namespace);
  return Object.freeze({ service, serviceKey, namespace });
}

// ── plugin helpers ──

function getService(ctx, key) {
  try {
    return ctx.get(key);
  } catch {
    return undefined;
  }
}

async function resolveApiKey(ctx) {
  // 1. DSH credentials seam / environment reference.
  const credentials = getService(ctx, "credentials");
  if (credentials && typeof credentials.resolve === "function") {
    try {
      const cred = await credentials.resolve(API_KEY_REF);
      if (cred && cred.value) return cred.value;
    } catch {
      // fall through
    }
  }

  // 2. Plain process environment (covers OPENCODE_GO_API_KEY=...).
  if (process.env[API_KEY_REF] && process.env[API_KEY_REF].length > 0) {
    return process.env[API_KEY_REF];
  }

  // 3. OpenCode's own auth.json: opencode-go (fallback opencode) type=api key.
  try {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
    const raw = JSON.parse(await readFile(authPath, "utf8"));
    const entry = raw["opencode-go"] ?? raw["opencode"];
    if (entry && entry.type === "api" && typeof entry.key === "string" && entry.key.length > 0) {
      return entry.key;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function pickWindow(w) {
  if (!w || typeof w !== "object") return null;
  const percent = typeof w.percent === "number" ? w.percent : Number(w.percent);
  return {
    status: typeof w.status === "string" ? w.status : null,
    percent: Number.isFinite(percent) ? percent : null,
    resetsAt: typeof w.resetsAt === "string" ? w.resetsAt : null,
  };
}

/**
 * Whether Settings -> Models configures at least one OpenCode Go route.
 * `providerIds` holds the route keys the deployment named explicitly; a key
 * derived from the catalog id (`opencode-go-*`) also counts, mirroring the
 * client half's visibility rule, because such a route serves the same
 * account-wide quota endpoint.
 */
function providerConfigured(pi, providerIds) {
  if (!pi || typeof pi !== "object") return false;
  const providers = pi.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return false;
  const present = (id) => providers[id] !== undefined && providers[id] !== null;
  if (providerIds.some(present)) return true;
  return Object.keys(providers).some(
    (id) => id === DEFAULT_PROVIDER_ID || id.startsWith(`${DEFAULT_PROVIDER_ID}-`),
  );
}

async function fetchUsage(baseUrl, timeoutMs, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return { configured: true, reason: null, error: "network", usage: null };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    return { configured: true, reason: null, error: "unauthorized", usage: null };
  }
  if (!res.ok) {
    return { configured: true, reason: null, error: `http-${res.status}`, usage: null };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { configured: true, reason: null, error: "bad-json", usage: null };
  }

  const usage = body && typeof body === "object" && body.usage ? body.usage : body;
  return {
    configured: true,
    reason: null,
    error: null,
    usage: {
      rolling: pickWindow(usage && usage.rolling),
      weekly: pickWindow(usage && usage.weekly),
      monthly: pickWindow(usage && usage.monthly),
    },
  };
}

export function apply(ctx, config) {
  const cfg = config ?? {};
  const baseUrl = typeof cfg.baseUrl === "string" && cfg.baseUrl.length > 0 ? cfg.baseUrl : DEFAULT_BASE_URL;
  const timeoutMs = Number.isSafeInteger(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS;
  // `providerIds` (list) wins; the older single `providerId` stays supported.
  // Derived `opencode-go-*` routes satisfy the precondition even when neither
  // key names them (see providerConfigured).
  const providerIds = Array.isArray(cfg.providerIds) && cfg.providerIds.length > 0
    ? cfg.providerIds.filter((value) => typeof value === "string" && value.length > 0)
    : typeof cfg.providerId === "string" && cfg.providerId.length > 0
      ? [cfg.providerId]
      : [DEFAULT_PROVIDER_ID];

  const service = {
    async usage() {
      // Precondition: an OpenCode Go route must be present in Settings -> Models.
      let configured = false;
      let reason = null;
      const settings = getService(ctx, "settings");
      if (settings && typeof settings.get === "function") {
        try {
          const pi = settings.get(PROVIDER_SETTINGS_NS);
          configured = providerConfigured(pi, providerIds);
          reason = configured ? null : "not-in-models";
        } catch {
          configured = false;
          reason = "not-in-models";
        }
      } else {
        reason = "not-in-models";
      }
      if (!configured) {
        return { configured: false, reason, error: null, usage: null };
      }

      const apiKey = await resolveApiKey(ctx);
      if (!apiKey) {
        return { configured: false, reason: "no-api-key", error: null, usage: null };
      }

      return fetchUsage(baseUrl, timeoutMs, apiKey);
    },
  };
  service.typertRemote = bindTypertRemote(service, "opencodeUsage");
  ctx.provide("opencodeUsage", service);
}

