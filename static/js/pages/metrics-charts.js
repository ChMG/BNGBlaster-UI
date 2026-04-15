// pages/metrics-charts.js — custom ECharts-based visualization for /metrics
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { api, parsePrometheus, usePoller } from "../api.js";

const ALWAYS_VISIBLE_METRICS = ["instances_running", "instances_total"];
const DEFAULT_SERIES = [...ALWAYS_VISIBLE_METRICS];

export default {
  name: "MetricsChartsPage",
  template: `
  <div class="p-6 space-y-5">

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Metrics Charts</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Custom ECharts view for current metrics · Updated {{ lastUpdated }}</p>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <div class="rounded-lg border-2 border-brand-strong brand-bg px-3 py-2 min-w-[18rem]">
          <div class="text-10 uppercase tracking-wider font-semibold brand-text mb-1">Instance Filter</div>
          <div class="flex items-center gap-2 flex-wrap">
            <select class="select select-sm bg-base-100 border-brand-strong w-56" v-model="selectedInstance" @change="load">
              <option value="all">All instances</option>
              <option v-for="inst in availableInstances" :key="inst" :value="inst">{{ inst }}</option>
            </select>
          </div>
        </div>
        <div class="rounded-lg border-2 border-brand-strong brand-bg px-3 py-2 min-w-[10rem]">
          <div class="text-10 uppercase tracking-wider font-semibold brand-text mb-1">Time Window</div>
          <div class="flex items-center gap-2">
            <select class="select select-sm bg-base-100 border-brand-strong w-24" v-model.number="timeWindowSec" @change="updateChart">
              <option :value="60">1m</option>
              <option :value="300">5m</option>
              <option :value="900">15m</option>
              <option :value="1800">30m</option>
            </select>
          </div>
        </div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" class="toggle toggle-sm toggle-success" v-model="autoOn" @change="onAutoChange" />
          <span class="text-sm text-base-content/70">Auto</span>
        </label>
        <select class="select select-sm bg-base-200 w-20" v-model.number="intervalSec" @change="onIntervalChange">
          <option :value="3">3s</option>
          <option :value="5">5s</option>
          <option :value="10">10s</option>
          <option :value="30">30s</option>
        </select>
        <button class="btn btn-sm btn-ghost" @click="load" :disabled="loading || !echartsReady" title="Reload">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" :class="loading && 'animate-spin'">
            <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="!echartsReady" class="alert alert-warning text-sm">
      ECharts library is not available. Please check network access to the configured ECharts script.
    </div>
    <div v-if="error" class="alert alert-error text-sm">{{ error }}</div>

    <div class="rounded-xl border border-base-300 bg-base-200 p-4 space-y-3">
      <div class="text-xs uppercase tracking-wide text-base-content/60">Series Selection</div>
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 max-h-44 overflow-auto pr-1">
        <label v-for="name in availableMetrics" :key="name" class="flex items-center gap-2 text-xs mono">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            :checked="selectedMetrics.includes(name)"
            @change="toggleMetric(name, $event.target.checked)"
          />
          <span>{{ name }}</span>
        </label>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <div v-for="name in selectedMetrics.slice(0, 6)" :key="name" class="rounded-xl border border-base-300 bg-base-200 p-3">
        <div class="text-xs text-base-content/40 mono truncate" :title="name">{{ name }}</div>
        <div class="text-xl font-semibold mono mt-1">{{ formatVal(latestValues[name]) }}</div>
      </div>
    </div>

    <div class="rounded-xl border border-base-300 bg-base-200 p-2 overflow-hidden">
      <div ref="chartEl" class="w-full overflow-hidden" style="height: 460px;"></div>
    </div>

  </div>
  `,

  setup() {
    const latestValues = ref({});
    const history = ref({});
    const loading = ref(false);
    const error = ref("");
    const autoOn = ref(true);
    const intervalSec = ref(5);
    const timeWindowSec = ref(60);
    const lastUpdated = ref("-");
    const availableInstances = ref([]);
    const selectedInstance = ref("all");
    const selectedMetrics = ref([...DEFAULT_SERIES]);
    const chartEl = ref(null);
    const echartsReady = ref(false);

    let chart = null;
    let resizeHandler = null;

    const availableMetrics = computed(() => {
      const names = Object.keys(latestValues.value || {});
      return names.sort((a, b) => a.localeCompare(b));
    });

    function aggregateByName(metrics) {
      const out = {};
      for (const m of metrics) {
        const key = m?.name;
        if (!key) continue;
        const v = Number.isFinite(m?.value) ? m.value : 0;
        out[key] = (out[key] ?? 0) + v;
      }
      return out;
    }

    function extractInstanceNames(metrics) {
      const names = new Set();
      for (const m of metrics) {
        const value = m?.labels?.instance_name;
        if (typeof value === "string" && value.trim()) names.add(value.trim());
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    }

    function filterBySelectedInstance(metrics) {
      if (selectedInstance.value === "all") return metrics;
      return metrics.filter((m) => {
        if (ALWAYS_VISIBLE_METRICS.includes(m?.name)) return true;
        return m?.labels?.instance_name === selectedInstance.value;
      });
    }

    function syncSelectionToAvailable(aggregated) {
      const names = Object.keys(aggregated || {});
      const available = new Set(names);
      selectedMetrics.value = selectedMetrics.value.filter((name) => available.has(name));
      if (selectedMetrics.value.length > 0) return;

      const defaults = DEFAULT_SERIES.filter((name) => available.has(name));
      selectedMetrics.value = defaults.length ? defaults : names.slice(0, 4);
    }

    function pushHistoryPoint(name, ts, value) {
      if (!history.value[name]) history.value[name] = [];
      history.value[name].push([ts, value]);
      const keepAfter = ts - 3600 * 1000;
      while (history.value[name].length && history.value[name][0][0] < keepAfter) {
        history.value[name].shift();
      }
    }

    function toggleMetric(name, checked) {
      if (checked) {
        if (!selectedMetrics.value.includes(name)) selectedMetrics.value.push(name);
      } else {
        selectedMetrics.value = selectedMetrics.value.filter((m) => m !== name);
      }
      updateChart();
    }

    function formatVal(v) {
      if (v === undefined || v === null || Number.isNaN(v)) return "-";
      if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + "G";
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
      return Number.isInteger(v) ? String(v) : v.toFixed(3);
    }

    function updateChart() {
      if (!chart || !echartsReady.value) return;
      const now = Date.now();
      const minTs = now - timeWindowSec.value * 1000;
      chart.resize();
      const series = selectedMetrics.value.map((name) => ({
        name,
        type: "line",
        showSymbol: false,
        smooth: false,
        data: (history.value[name] || []).filter(([ts]) => ts >= minTs),
      }));

      chart.setOption({
        animation: false,
        grid: { left: 44, right: 20, top: 24, bottom: 46 },
        tooltip: { trigger: "axis" },
        legend: { type: "scroll", top: 0 },
        xAxis: {
          type: "time",
          axisLabel: { color: "#64748b" },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: "#64748b" },
          splitLine: { lineStyle: { color: "rgba(100,116,139,.15)" } },
        },
        series,
      }, true);
    }

    async function load() {
      if (!echartsReady.value) return;
      loading.value = true;
      error.value = "";
      try {
        const text = await api.get("/metrics");
        const parsed = parsePrometheus(typeof text === "string" ? text : "");
        availableInstances.value = extractInstanceNames(parsed);
        if (selectedInstance.value !== "all" && !availableInstances.value.includes(selectedInstance.value)) {
          selectedInstance.value = "all";
        }

        const filtered = filterBySelectedInstance(parsed);
        const aggregated = aggregateByName(filtered);
        latestValues.value = aggregated;
        syncSelectionToAvailable(aggregated);
        const now = Date.now();
        for (const [name, value] of Object.entries(aggregated)) {
          pushHistoryPoint(name, now, value);
        }

        lastUpdated.value = new Date().toLocaleTimeString("en-US");
        updateChart();
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

    function onIntervalChange() {
      if (autoOn.value) restart();
    }

    onMounted(async () => {
      echartsReady.value = typeof window !== "undefined" && !!window.echarts;
      if (!echartsReady.value) return;

      chart = window.echarts.init(chartEl.value);
      resizeHandler = () => chart?.resize();
      window.addEventListener("resize", resizeHandler);

      // Ensure correct canvas size after initial layout/reflow.
      requestAnimationFrame(() => chart?.resize());
      requestAnimationFrame(() => chart?.resize());

      await load();
      restart();
    });

    onUnmounted(() => {
      stop();
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (chart) {
        chart.dispose();
        chart = null;
      }
    });

    watch(selectedMetrics, updateChart);

    return {
      latestValues,
      loading,
      error,
      autoOn,
      intervalSec,
      timeWindowSec,
      lastUpdated,
      availableInstances,
      selectedInstance,
      selectedMetrics,
      availableMetrics,
      chartEl,
      echartsReady,
      load,
      onAutoChange,
      onIntervalChange,
      toggleMetric,
      formatVal,
    };
  },
};
