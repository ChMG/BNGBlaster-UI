// api.js — shared HTTP client for all page components
import { onUnmounted } from "vue";

export const BACKEND_TARGET_STORAGE_KEY = "bngblaster-target";

function getSelectedBackendTarget() {
  try {
    return window.localStorage.getItem(BACKEND_TARGET_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function withBackendTargetHeader(headers = {}) {
  const target = getSelectedBackendTarget();
  if (!target) return headers;
  return { ...headers, "X-Bngblaster-Target": target };
}

/** Throw on non-2xx, return parsed JSON or text */
async function _fetch(path, options = {}) {
  const r = await fetch(path, { ...options, headers: withBackendTargetHeader(options.headers ?? {}) });
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && body && typeof body === "object" && body.login_url) {
      window.location.href = body.login_url;
    }
    const msg = typeof body === "string" ? body : JSON.stringify(body);
    throw Object.assign(new Error(msg || r.statusText), { status: r.status, body });
  }
  return body;
}

export const api = {
  get(path) {
    return _fetch(path);
  },
  post(path, body) {
    return _fetch(path, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  put(path, body) {
    return _fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  delete(path) {
    return _fetch(path, { method: "DELETE" });
  },
  /** Raw fetch – returns { ok, status, statusText, body } without throwing */
  async raw(path, options = {}) {
    const startedAt = performance.now();
    try {
      const r = await fetch(path, { ...options, headers: withBackendTargetHeader(options.headers ?? {}) });
      const ct = r.headers.get("content-type") || "";
      const body = ct.includes("application/json") ? await r.json() : await r.text();
      return { ok: r.ok, status: r.status, statusText: r.statusText, body,
               durationMs: Math.round(performance.now() - startedAt) };
    } catch (err) {
      return { ok: false, status: 0, statusText: err.message, body: null,
               durationMs: Math.round(performance.now() - startedAt) };
    }
  },
};

/**
 * Composable: polling loop that calls `fn` every `getInterval()` seconds.
 * Automatically clears on component unmount.
 */
export function usePoller(fn, getInterval) {
  let timer = null;
  function restart() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { fn().catch(() => {}); }, getInterval() * 1000);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  onUnmounted(stop);
  return { restart, stop };
}

/** Parse prometheus text format → array of metric objects */
export function parsePrometheus(text) {
  const help = {};
  const type = {};
  const metrics = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# HELP ")) {
      const rest = line.slice(7);
      const sp = rest.indexOf(" ");
      if (sp > 0) help[rest.slice(0, sp)] = rest.slice(sp + 1);
      continue;
    }
    if (line.startsWith("# TYPE ")) {
      const parts = line.slice(7).split(" ");
      if (parts.length >= 2) type[parts[0]] = parts[1];
      continue;
    }
    if (line.startsWith("#")) continue;
    const m = line.match(/^([^{}\s]+)(\{[^}]*\})?\s+([\S]+)/);
    if (!m) continue;
    const name = m[1];
    const labelsRaw = m[2] ? m[2].slice(1, -1) : "";
    const labels = {};
    for (const pair of labelsRaw.matchAll(/(\w+)="([^"]*)"/g)) {
      labels[pair[1]] = pair[2];
    }
    metrics.push({
      name,
      labels,
      value: parseFloat(m[3]),
      help: help[name] || "",
      type: type[name] || "untyped",
    });
  }
  return metrics;
}
