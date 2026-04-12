// pages/metrics.js — Prometheus metrics viewer with auto-refresh
import { ref, computed, onMounted } from "vue";
import { api, usePoller, parsePrometheus } from "../api.js";

export default {
  name: "MetricsPage",
  template: `
  <div class="p-6 space-y-5">

    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Metrics</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Updated {{ lastUpdated }}</p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="filter" type="text" placeholder="Search metric ..."
          class="input input-sm input-bordered bg-base-200 w-48" />
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" class="toggle toggle-sm toggle-success" v-model="autoOn" @change="onAutoChange" />
          <span class="text-sm text-base-content/70">Auto</span>
        </label>
        <select class="select select-sm bg-base-200 w-20" v-model.number="intervalSec" @change="onAutoChange">
          <option :value="5">5s</option>
          <option :value="10">10s</option>
          <option :value="30">30s</option>
        </select>
        <button class="btn btn-sm btn-ghost" @click="load" :disabled="loading">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" :class="loading && 'animate-spin'">
            <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="alert alert-error text-sm">{{ error }}</div>

    <!-- Loading skeleton -->
    <div v-if="loading && !metrics.length" class="flex justify-center py-16">
      <span class="loading loading-dots loading-lg brand-text"></span>
    </div>

    <!-- Key stat cards (top-level metrics without labels) -->
    <div v-if="keyMetrics.length" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      <div v-for="m in keyMetrics" :key="m.name"
        class="bg-base-200 rounded-xl p-4 border border-base-300 hover:border-brand-soft transition-colors">
        <div class="text-xs text-base-content/40 mono truncate mb-1" :title="m.name">{{ m.name }}</div>
        <div class="text-2xl font-bold text-base-content">{{ fmtValue(m.value) }}</div>
        <div v-if="m.help" class="text-xs text-base-content/40 mt-1 truncate" :title="m.help">{{ m.help }}</div>
      </div>
    </div>

    <!-- Full metrics table -->
    <div v-if="filteredMetrics.length" class="rounded-xl overflow-hidden border border-base-300">
      <table class="table table-zebra w-full text-sm stable-table">
        <colgroup>
          <col style="width: 28%" />
          <col style="width: 44%" />
          <col style="width: 16%" />
          <col style="width: 12%" />
        </colgroup>
        <thead class="bg-base-200">
          <tr>
            <th class="text-base-content/60 font-semibold">Metric</th>
            <th class="text-base-content/60 font-semibold">Labels</th>
            <th class="text-base-content/60 font-semibold text-right">Value</th>
            <th class="text-base-content/60 font-semibold hidden md:table-cell">Typ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in filteredMetrics" :key="i" class="hover">
            <td class="mono text-xs text-base-content/80 max-w-xs">
              <span :title="m.help || m.name">{{ m.name }}</span>
            </td>
            <td class="max-w-xs stable-wrap">
              <span v-for="(v, k) in m.labels" :key="k"
                class="badge badge-ghost badge-sm mono mr-1">{{ k }}={{ v }}</span>
            </td>
            <td class="text-right mono font-semibold brand-text">{{ fmtValue(m.value) }}</td>
            <td class="hidden md:table-cell">
              <span class="badge badge-outline badge-xs mono">{{ m.type }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="bg-base-200 px-4 py-2 text-xs text-base-content/40">
        {{ filteredMetrics.length }} of {{ metrics.length }} metrics
      </div>
    </div>

    <div v-if="!loading && !metrics.length && !error" class="text-center text-base-content/30 py-16">
      No metrics available. Is backend reachable?
    </div>

  </div>
  `,

  setup() {
    const metrics     = ref([]);
    const loading     = ref(false);
    const error       = ref("");
    const lastUpdated = ref("—");
    const filter      = ref("");
    const autoOn      = ref(true);
    const intervalSec = ref(10);

    const keyMetrics = computed(() =>
      metrics.value.filter(m => Object.keys(m.labels).length === 0).slice(0, 20)
    );

    const filteredMetrics = computed(() => {
      const q = filter.value.trim().toLowerCase();
      if (!q) return metrics.value;
      return metrics.value.filter(m =>
        m.name.toLowerCase().includes(q) ||
        Object.values(m.labels).some(v => v.toLowerCase().includes(q))
      );
    });

    function fmtValue(v) {
      if (isNaN(v)) return String(v);
      if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + "G";
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
      return Number.isInteger(v) ? String(v) : v.toFixed(4);
    }

    async function load() {
      loading.value = true;
      error.value = "";
      try {
        const text = await api.get("/metrics");
        metrics.value = parsePrometheus(typeof text === "string" ? text : "");
        lastUpdated.value = new Date().toLocaleTimeString("en-US");
      } catch (e) {
        error.value = `Failed to load metrics: ${e.message}`;
      } finally {
        loading.value = false;
      }
    }

    const { restart, stop } = usePoller(load, () => intervalSec.value);

    function onAutoChange() {
      if (autoOn.value) restart();
      else stop();
    }

    onMounted(async () => {
      await load();
      restart();
    });

    return {
      metrics, loading, error, lastUpdated, filter, autoOn, intervalSec,
      keyMetrics, filteredMetrics, fmtValue, load, onAutoChange,
    };
  },
};
