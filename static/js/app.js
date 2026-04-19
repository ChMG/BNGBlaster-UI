// app.js — Vue 3 root: router, layout, navbar
import { createApp, ref, computed, onMounted } from "vue";
import { createRouter, createWebHashHistory, RouterView, RouterLink, useRoute } from "vue-router";

import InstancesPage from "./pages/instances.js";
import InterfacesPage from "./pages/interfaces.js";
import MetricsPage   from "./pages/metrics.js";
import MetricsChartsPage from "./pages/metrics-charts.js";
import TemplatesPage from "./pages/templates.js";
import ExplorerPage  from "./pages/explorer.js";
import { api, BACKEND_TARGET_STORAGE_KEY } from "./api.js";

// ─── Router ─────────────────────────────────────────────────────────────────

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/",          redirect: "/instances" },
    { path: "/instances", component: InstancesPage },
    { path: "/interfaces", component: InterfacesPage },
    { path: "/metrics",   component: MetricsPage   },
    { path: "/metrics-charts", component: MetricsChartsPage },
    { path: "/templates", component: TemplatesPage },
    { path: "/explorer",  component: ExplorerPage  },
  ],
});

// ─── Root layout ────────────────────────────────────────────────────────────

const NAV = [
  { to: "/instances", label: "Instances",   icon: "⚡" },
  { to: "/interfaces", label: "Interfaces", icon: "🧩" },
  { to: "/metrics",   label: "Metrics",     icon: "📊" },
  { to: "/metrics-charts", label: "Metric Charts", icon: "📈" },
  { to: "/templates", label: "Templates",   icon: "📋" },
  { to: "/explorer",  label: "API Explorer",icon: "🔍" },
];

const AppLayout = {
  components: { RouterView, RouterLink },
  template: `
    <div class="flex min-h-screen">

      <!-- Sidebar -->
      <aside class="w-56 flex-shrink-0 bg-base-200 border-r border-base-300 flex flex-col sticky top-0 h-screen">

        <!-- Brand -->
        <div class="p-4 border-b border-base-300">
          <div class="flex items-center gap-2.5">
            <div class="w-14 h-14 rounded-lg overflow-hidden border border-base-300 bg-base-300 flex items-center justify-center">
              <img src="/favicon.svg" alt="BNG Blaster UI" class="w-14 h-14 object-contain" />
            </div>
            <div>
              <div class="font-bold text-sm text-base-content leading-tight">BNG Blaster</div>
              <div class="text-11 text-base-content/40">Controller UI</div>
            </div>
          </div>
        </div>

        <!-- Server Selection (multi-backend only) -->
        <div v-if="isMultiBackend" class="px-3 py-2 border-b border-base-300">
          <div class="rounded-lg border border-brand-strong brand-bg p-2 space-y-1">
            <div class="text-10 uppercase tracking-widest brand-text font-semibold">Server Selection</div>
            <select
              v-model="selectedBackend"
              @change="onBackendChange"
              class="select select-xs w-full mono border-brand-strong"
              title="Select active BNG Blaster target"
            >
              <option v-for="(url, idx) in backendOptions" :key="url" :value="url">{{ backendOptionLabel(url, idx) }}</option>
            </select>
            <div class="text-10 text-base-content/50">Active target for all API calls</div>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-2 space-y-0.5 overflow-auto">
          <component
            v-for="item in nav"
            :key="item.to || item.href"
            :is="item.external ? 'a' : 'RouterLink'"
            v-bind="item.external
              ? { href: item.href, target: '_blank', rel: 'noopener noreferrer' }
              : { to: item.to }"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors nav-item"
            :class="!item.external && isNavActive(item.to)
              ? 'nav-active font-semibold'
              : 'text-base-content/60 hover:bg-base-300 hover:text-base-content'">
            <span>{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </component>
        </nav>

        <!-- Backend status -->
        <div class="p-3 border-t border-base-300 space-y-1">
          <div class="text-11 text-base-content/40 uppercase tracking-widest">Backend</div>
          <div v-if="oidcEnabled" class="text-10 text-base-content/30 mono break-all">
            <span>auth:</span>
            <span class="text-success">{{ oidcUserName }}</span>
            <a href="/ui-api/auth/logout" class="ml-2 underline text-base-content/50 hover:text-base-content">logout</a>
          </div>
          <div class="text-xs mono text-base-content/50 break-all">{{ backendUrl }}</div>
          <div class="text-10 text-base-content/30 mono break-all">
            <span>app:</span>
            <span :class="appVersionClass()">{{ appVersion }}</span>
            <span v-if="showAppLatestHint()" class="text-base-content/40"> (latest: {{ appLatest }})</span>
          </div>
          <div v-if="isProxied" class="text-10 text-base-content/30 mono break-all">proxied to {{ backendTarget }}</div>
          <div class="flex items-center gap-1.5">
            <span :class="online ? 'bg-success' : 'bg-error'"
              class="inline-block w-2 h-2 rounded-full"></span>
            <span class="text-xs text-base-content/40">
              {{ online ? 'Online' : 'Offline' }}
            </span>
          </div>
          <div class="text-10 text-base-content/30 mt-1 mono break-all">
            <span>ctrl:</span>
            <span :class="versionClass(ctrlUpToDate)">{{ ctrlVersion }}</span>
            <span v-if="showLatestHint(ctrlUpToDate, ctrlLatest)" class="text-base-content/40"> (latest: {{ ctrlLatest }})</span>
          </div>
          <div class="text-10 text-base-content/30 mono break-all">
            <span>blaster:</span>
            <span :class="versionClass(blasterUpToDate)">{{ blasterVersion }}</span>
            <span v-if="showLatestHint(blasterUpToDate, blasterLatest)" class="text-base-content/40"> (latest: {{ blasterLatest }})</span>
          </div>
        </div>
      </aside>

      <!-- Page content -->
      <main class="flex-1 overflow-auto min-h-screen">
        <RouterView />
      </main>
    </div>
  `,

  setup() {
    const route      = useRoute();
    const online     = ref(false);
    const appVersion = ref("—");
    const appLatest = ref("");
    const appUpToDate = ref(null);
    const appVersionCheckEnabled = ref(false);
    const ctrlVersion = ref("…");
    const blasterVersion = ref("…");
    const ctrlLatest = ref("");
    const blasterLatest = ref("");
    const ctrlUpToDate = ref(null);
    const blasterUpToDate = ref(null);
    const versionCheckEnabled = ref(false);
    const backendUrl = ref(`${window.location.origin}/api`);
    const backendTarget = ref("—");
    const metricGrafanaUrl = ref("");
    const oidcEnabled = ref(false);
    const oidcUserName = ref("");
    const backendOptions = ref([]);
    const selectedBackend = ref("");
    const nav = computed(() => {
      const items = [...NAV];
      if (metricGrafanaUrl.value) {
        const insertIndex = items.findIndex((item) => item.to === "/metrics-charts");
        const externalItem = { href: metricGrafanaUrl.value, label: "Metric Grafana", icon: "🪟", external: true };
        if (insertIndex >= 0) {
          items.splice(insertIndex + 1, 0, externalItem);
        } else {
          items.push(externalItem);
        }
      }
      return items;
    });

    const currentPath = computed(() => route.path ?? "/");
    const isMultiBackend = computed(() => backendOptions.value.length > 1);
    const isProxied = computed(() => {
      if (!backendTarget.value || backendTarget.value === "—") return false;
      return !backendTarget.value.startsWith(window.location.origin);
    });

    async function checkBackend() {
      try {
        const info = await api.get("/ui-api/backend-info");
        appVersion.value = info?.app_version || "—";
        appVersionCheckEnabled.value = !!info?.app_version_check_enabled;
        appLatest.value = info?.app_version_status?.latest || "";
        appUpToDate.value = typeof info?.app_version_status?.up_to_date === "boolean"
          ? info.app_version_status.up_to_date
          : null;
        versionCheckEnabled.value = !!info?.version_check_enabled;
        metricGrafanaUrl.value = info?.metric_grafana_url || "";
        oidcEnabled.value = !!info?.oidc_enabled;
        oidcUserName.value = info?.oidc_user?.name || info?.oidc_user?.preferred_username || info?.oidc_user?.email || "authenticated";
        const urls = Array.isArray(info?.backend_urls) ? info.backend_urls : [];
        backendOptions.value = urls;

        const stored = (() => {
          try { return window.localStorage.getItem(BACKEND_TARGET_STORAGE_KEY) || ""; }
          catch { return ""; }
        })();
        let target = selectedBackend.value || stored || urls[0] || "";
        if (urls.length && !urls.includes(target)) {
          target = urls[0];
        }
        selectedBackend.value = target;
        if (target) {
          try { window.localStorage.setItem(BACKEND_TARGET_STORAGE_KEY, target); } catch {}
        }

        const data = await api.get("/api/v1/version");
        online.value = true;
        ctrlVersion.value = data?.["bngblasterctrl-version"]
          ?? data?.["controller-version"]
          ?? "—";
        blasterVersion.value = data?.["bngblaster-version"]
          ?? data?.["blaster-version"]
          ?? "—";
        const vs = info?.version_status;
        ctrlLatest.value = vs?.controller?.latest || "";
        blasterLatest.value = vs?.blaster?.latest || "";
        ctrlUpToDate.value = typeof vs?.controller?.up_to_date === "boolean" ? vs.controller.up_to_date : null;
        blasterUpToDate.value = typeof vs?.blaster?.up_to_date === "boolean" ? vs.blaster.up_to_date : null;
        backendUrl.value = `${window.location.origin}/api`;
        backendTarget.value = selectedBackend.value || info?.backend_url || "—";
      } catch {
        online.value = false;
        appVersion.value = "—";
        appLatest.value = "";
        appUpToDate.value = null;
        appVersionCheckEnabled.value = false;
        ctrlVersion.value = "—";
        blasterVersion.value = "—";
        ctrlLatest.value = "";
        blasterLatest.value = "";
        ctrlUpToDate.value = null;
        blasterUpToDate.value = null;
        metricGrafanaUrl.value = "";
        oidcEnabled.value = false;
        oidcUserName.value = "";
        backendTarget.value = "—";
      }
    }

    function versionClass(upToDate) {
      if (!versionCheckEnabled.value || upToDate === null) return "text-base-content/30";
      return upToDate ? "text-success" : "text-error";
    }

    function showLatestHint(upToDate, latest) {
      return versionCheckEnabled.value && upToDate === false && !!latest;
    }

    function appVersionClass() {
      if (!appVersionCheckEnabled.value || appUpToDate.value === null) return "text-base-content/50";
      return appUpToDate.value ? "text-success" : "text-error";
    }

    function showAppLatestHint() {
      return appVersionCheckEnabled.value && appUpToDate.value === false && !!appLatest.value;
    }

    function onBackendChange() {
      try {
        if (selectedBackend.value) {
          window.localStorage.setItem(BACKEND_TARGET_STORAGE_KEY, selectedBackend.value);
        } else {
          window.localStorage.removeItem(BACKEND_TARGET_STORAGE_KEY);
        }
      } catch {}
      checkBackend();
    }

    function backendOptionLabel(url, idx) {
      try {
        const u = new URL(url);
        return u.hostname || `server-${idx + 1}`;
      } catch {
        return `server-${idx + 1}`;
      }
    }

    function isNavActive(path) {
      const cur = currentPath.value || "/";
      return cur === path || cur.startsWith(path + "/");
    }

    onMounted(() => {
      checkBackend();
      setInterval(checkBackend, 20000);
    });

    return {
      nav, online, ctrlVersion, blasterVersion,
      appVersion,
      ctrlLatest, blasterLatest,
      backendUrl, backendTarget, backendOptions, selectedBackend,
      oidcEnabled, oidcUserName,
      isMultiBackend, isProxied, currentPath, onBackendChange, backendOptionLabel,
      isNavActive,
      versionClass, showLatestHint, ctrlUpToDate, blasterUpToDate,
      appVersionClass, showAppLatestHint, appLatest,
    };
  },
};

// ─── Mount ───────────────────────────────────────────────────────────────────

const app = createApp(AppLayout);
app.use(router);
app.mount("#app");
