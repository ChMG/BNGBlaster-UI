// pages/explorer.js — API explorer from OpenAPI/Swagger spec
import { ref, computed, onMounted, watch } from "vue";
import { load as loadYaml } from "js-yaml";
import { api } from "../api.js";

const METHOD_COLOR = {
  GET:    "badge-success",
  POST:   "badge-warning",
  PUT:    "badge-info",
  DELETE: "badge-error",
  PATCH:  "badge-secondary",
};

export default {
  name: "ExplorerPage",
  template: `
  <div class="flex h-screen-fit overflow-hidden">

    <!-- Sidebar: endpoint list -->
    <aside class="w-72 flex-shrink-0 bg-base-200 border-r border-base-300 flex flex-col">
      <div class="p-3 border-b border-base-300">
        <div class="mb-2">
          <label class="label pb-1">
            <span class="label-text text-xs font-semibold uppercase tracking-widest text-base-content/40">API Source</span>
          </label>
          <select v-model="selectedSpec" class="select select-bordered select-xs w-full bg-base-300">
            <option v-for="opt in specOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="text-xs font-semibold uppercase tracking-widest text-base-content/40 mb-2">Endpoints</div>
        <input v-model="search" type="text" placeholder="Search ..."
          class="input input-bordered input-xs w-full bg-base-300" />
      </div>
      <div class="flex-1 overflow-auto p-2 space-y-1">
        <button v-for="ep in filteredEndpoints" :key="ep.id"
          :class="['w-full text-left rounded-lg px-2.5 py-2 border transition-colors text-xs',
            active?.id === ep.id
              ? 'border-brand-strong brand-bg'
              : 'border-transparent hover:bg-base-300']"
          @click="selectEndpoint(ep)">
          <div class="flex items-center gap-1.5">
            <span :class="['badge badge-xs', METHOD_COLOR[ep.method] || 'badge-ghost']">{{ ep.method }}</span>
          </div>
          <div class="mono mt-0.5 text-base-content/70 truncate text-11">{{ ep.path }}</div>
          <div class="text-base-content/40 truncate text-11 mt-0.5">{{ ep.summary }}</div>
        </button>
        <div v-if="specError" class="px-2 py-2 text-xs text-error bg-base-300 rounded-lg border border-base-300">
          {{ specError }}
        </div>
      </div>
    </aside>

    <!-- Main panel -->
    <main class="flex-1 overflow-auto p-5 space-y-4">

      <div v-if="!active" class="flex flex-col items-center justify-center h-full text-base-content/30">
        <div class="text-4xl mb-3">🔍</div>
        <div class="text-sm">Select an endpoint from the left.</div>
      </div>

      <template v-if="active">
        <!-- Endpoint title -->
        <div class="bg-base-200 rounded-xl p-4 border border-base-300">
          <div class="flex items-center gap-3 flex-wrap">
            <span :class="['badge', METHOD_COLOR[active.method] || 'badge-ghost']">{{ active.method }}</span>
            <span class="mono text-sm text-base-content font-semibold">{{ active.path }}</span>
          </div>
          <p class="font-semibold mt-1">{{ active.summary }}</p>
          <p v-if="active.description" class="text-sm text-base-content/60 mt-0.5 whitespace-pre-wrap">{{ active.description }}</p>
        </div>

        <!-- Parameters -->
        <div v-if="active.parameters?.length" class="bg-base-200 rounded-xl p-4 border border-base-300 space-y-3">
          <div class="text-xs font-semibold uppercase tracking-widest text-base-content/40">Parameter</div>
          <div v-for="p in active.parameters" :key="p.name" class="flex items-start gap-3">
            <div class="w-36 flex-shrink-0">
              <div class="mono text-xs text-base-content font-semibold">{{ p.name }}</div>
              <div class="text-xs text-base-content/40">{{ p.in }} {{ p.required ? '· required' : '' }}</div>
            </div>
            <input v-model="paramValues[p.name]" type="text"
              :placeholder="String(p.example ?? p.schema?.example ?? '')"
              class="input input-bordered input-xs flex-1 mono bg-base-300" />
          </div>
        </div>

        <!-- Request Body -->
        <div v-if="active.requestBody" class="bg-base-200 rounded-xl p-4 border border-base-300 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-widest text-base-content/40">Request Body</div>
            <button class="btn btn-ghost btn-xs" @click="formatBody">Format</button>
          </div>
          <textarea v-model="bodyText" rows="8" class="textarea textarea-bordered w-full json-editor bg-base-300"></textarea>
          <p v-if="bodyError" class="text-error text-xs">{{ bodyError }}</p>
        </div>

        <!-- Send -->
        <button class="btn brand-button-text w-full" style="background:var(--brand)"
          @click="sendRequest" :disabled="sending">
          <span v-if="sending" class="loading loading-spinner loading-sm"></span>
          Send request
        </button>

        <!-- Response -->
        <div v-if="response" class="bg-base-200 rounded-xl p-4 border border-base-300 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-widest text-base-content/40">Response</div>
            <div class="flex items-center gap-2 text-xs">
              <span :class="['badge badge-sm', response.ok ? 'badge-success' : 'badge-error']">
                HTTP {{ response.status }}
              </span>
              <span class="text-base-content/40">{{ response.durationMs }}ms</span>
            </div>
          </div>
          <pre class="bg-base-300 rounded-lg p-3 text-xs mono overflow-auto max-h-40vh">{{ responseText }}</pre>
        </div>
      </template>
    </main>
  </div>
  `,

  setup() {
    const endpoints = ref([]);
    const search    = ref("");
    const active    = ref(null);
    const selectedSpec = ref("controller");
    const specError = ref("");
    const specOptions = [
      { value: "controller", label: "BNG Blaster Controller API" },
      { value: "ui", label: "BNG Blaster UI API" },
    ];
    const paramValues = ref({});
    const bodyText  = ref("");
    const bodyError = ref("");
    const sending   = ref(false);
    const response  = ref(null);
    const responseText = ref("");

    const filteredEndpoints = computed(() => {
      const q = search.value.trim().toLowerCase();
      if (!q) return endpoints.value;
      return endpoints.value.filter(e =>
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q)
      );
    });

    function selectEndpoint(ep) {
      active.value = ep;
      paramValues.value = {};
      bodyError.value = "";
      response.value = null;
      responseText.value = "";

      const content = ep.requestBody?.content?.["application/json"];
      const example = content?.example ?? content?.schema?.example;
      bodyText.value = example ? JSON.stringify(example, null, 2) : "";
    }

    function currentSpecPath() {
      return selectedSpec.value === "ui"
        ? "/ui-api-swagger.yaml"
        : "/bngblaster-controler-swagger.yaml";
    }

    async function loadSpec() {
      specError.value = "";
      active.value = null;
      response.value = null;
      responseText.value = "";
      endpoints.value = [];

      try {
        const r = await fetch(currentSpecPath());
        if (!r.ok) throw new Error(`Failed to load spec (${r.status})`);
        const text = await r.text();
        const spec = loadYaml(text);
        const methods = ["get", "post", "put", "delete", "patch"];
        const items = [];

        for (const [path, ops] of Object.entries(spec.paths ?? {})) {
          const pathParameters = Array.isArray(ops?.parameters) ? ops.parameters : [];
          for (const method of methods) {
            if (!ops?.[method]) continue;
            const op = ops[method];
            const opParameters = Array.isArray(op.parameters) ? op.parameters : [];
            items.push({
              id: `${method.toUpperCase()} ${path}`,
              method: method.toUpperCase(),
              path,
              summary: op.summary ?? "",
              description: op.description ?? "",
              parameters: [...pathParameters, ...opParameters],
              requestBody: op.requestBody ?? null,
            });
          }
        }
        endpoints.value = items;
      } catch (e) {
        specError.value = `Spec load failed: ${e.message}`;
      }
    }

    function formatBody() {
      bodyError.value = "";
      try { bodyText.value = JSON.stringify(JSON.parse(bodyText.value), null, 2); }
      catch (e) { bodyError.value = `Invalid JSON: ${e.message}`; }
    }

    async function sendRequest() {
      if (!active.value) return;
      bodyError.value = "";
      sending.value = true;
      response.value = null;

      let path = active.value.path;
      const headers = {};

      // Replace path params
      for (const p of (active.value.parameters ?? [])) {
        if (p.in === "path") {
          const v = (paramValues.value[p.name] ?? "").trim();
          path = path.replace(`{${p.name}}`, encodeURIComponent(v));
        }
      }

      const opts = { method: active.value.method, headers };
      const bt = bodyText.value.trim();
      if (bt && active.value.requestBody) {
        let parsed;
        try { parsed = JSON.parse(bt); }
        catch (e) { bodyError.value = `Invalid JSON: ${e.message}`; sending.value = false; return; }
        opts.body = JSON.stringify(parsed);
        headers["Content-Type"] = "application/json";
      }

      const result = await api.raw(path, opts);
      response.value = result;
      responseText.value = typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body, null, 2);
      sending.value = false;
    }

    onMounted(loadSpec);
    watch(selectedSpec, loadSpec);

    return {
      endpoints, filteredEndpoints, search, active, selectedSpec, specOptions, specError,
      paramValues, bodyText, bodyError,
      sending, response, responseText, METHOD_COLOR,
      selectEndpoint, formatBody, sendRequest,
    };
  },
};
