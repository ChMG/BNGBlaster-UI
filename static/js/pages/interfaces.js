// pages/interfaces.js — available host interfaces from /api/v1/interfaces
import { ref, computed, onMounted } from "vue";
import { api, usePoller } from "../api.js";

export default {
  name: "InterfacesPage",
  template: `
  <div class="p-6 space-y-5">

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Interfaces</h1>
        <p class="text-sm text-base-content/50 mt-0.5">
          {{ filtered.length }} of {{ interfaces.length }} interface(s) · Updated {{ lastUpdated }}
        </p>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <input
          v-model="search"
          type="text"
          placeholder="Search name, MAC, flag..."
          class="input input-sm input-bordered bg-base-200 w-56"
        />
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
        <button class="btn btn-sm btn-ghost" @click="load" :disabled="loading" title="Reload">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" :class="loading && 'animate-spin'">
            <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error text-sm">{{ error }}</div>

    <div class="rounded-xl overflow-hidden border border-base-300">
      <table class="table table-zebra w-full stable-table">
        <colgroup>
          <col style="width: 20%" />
          <col style="width: 24%" />
          <col style="width: 10%" />
          <col style="width: 46%" />
        </colgroup>
        <thead class="bg-base-200">
          <tr>
            <th>Name</th>
            <th>MAC</th>
            <th>MTU</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(itf, idx) in filtered" :key="itf.name || idx" class="hover">
            <td class="mono font-semibold">{{ itf.name || '—' }}</td>
            <td class="mono text-xs">{{ itf.mac || '—' }}</td>
            <td class="mono">{{ itf.mtu ?? '—' }}</td>
            <td class="stable-wrap">
              <div class="flex flex-wrap gap-1">
                <span v-for="flag in normalizeFlags(itf.flags)" :key="flag" class="badge badge-ghost badge-sm mono">{{ flag }}</span>
                <span v-if="!normalizeFlags(itf.flags).length" class="text-base-content/40">—</span>
              </div>
            </td>
          </tr>

          <tr v-if="loading && !interfaces.length">
            <td colspan="4" class="text-center py-10">
              <span class="loading loading-dots loading-md text-base-content/30"></span>
            </td>
          </tr>

          <tr v-if="!loading && !filtered.length">
            <td colspan="4" class="text-center text-base-content/30 py-10">
              No interfaces found.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  `,

  setup() {
    const interfaces = ref([]);
    const loading = ref(false);
    const error = ref("");
    const search = ref("");
    const autoOn = ref(true);
    const intervalSec = ref(5);
    const lastUpdated = ref("—");

    const filtered = computed(() => {
      const q = search.value.trim().toLowerCase();
      if (!q) return interfaces.value;
      return interfaces.value.filter((itf) => {
        const text = [
          itf?.name,
          itf?.mac,
          String(itf?.mtu ?? ""),
          ...(Array.isArray(itf?.flags) ? itf.flags : []),
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(q);
      });
    });

    function normalizeFlags(flags) {
      if (!Array.isArray(flags)) return [];
      return flags
        .map((f) => String(f ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }

    async function load() {
      loading.value = true;
      error.value = "";
      try {
        const data = await api.get("/api/v1/interfaces");
        interfaces.value = Array.isArray(data)
          ? data.slice().sort((a, b) => (a?.name || "").localeCompare(b?.name || ""))
          : [];
        lastUpdated.value = new Date().toLocaleTimeString("en-US");
      } catch (e) {
        error.value = `Failed to load interfaces: ${e.message}`;
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
      await load();
      restart();
    });

    return {
      interfaces,
      loading,
      error,
      search,
      autoOn,
      intervalSec,
      lastUpdated,
      filtered,
      normalizeFlags,
      load,
      onAutoChange,
      onIntervalChange,
    };
  },
};
