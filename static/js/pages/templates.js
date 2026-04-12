// pages/templates.js — Server-side config template CRUD
import { ref, computed, onMounted } from "vue";
import { api } from "../api.js";

export default {
  name: "TemplatesPage",
  template: `
  <div class="p-6 space-y-5">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Templates</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Server-side instance configurations</p>
      </div>
      <button class="btn btn-sm brand-text" style="background:var(--brand-dim);border:1px solid rgba(40,212,172,0.3)"
        @click="createNew">+ New Template</button>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="toast toast-top toast-end z-50">
      <div :class="['alert text-sm', toast.type === 'error' ? 'alert-error' : 'alert-success']">
        {{ toast.msg }}
      </div>
    </div>

    <!-- Two-panel layout -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">

      <!-- Template list -->
      <div class="md:col-span-1 space-y-2">
        <div class="text-xs font-semibold uppercase tracking-widest text-base-content/40 mb-2">Saved templates</div>

        <div v-if="loadingList" class="flex justify-center py-8">
          <span class="loading loading-dots loading-md brand-text"></span>
        </div>

        <div v-for="t in templates" :key="t.name"
          :class="['rounded-xl p-3 border cursor-pointer transition-colors',
            selected?.name === t.name
              ? 'border-brand-strong brand-bg'
              : 'border-base-300 bg-base-200 hover:border-base-content/30']"
          @click="loadTemplate(t.name)">
          <div class="flex items-center justify-between">
            <span class="mono text-sm font-semibold" :class="selected?.name === t.name ? 'brand-text' : 'text-base-content'">
              {{ t.name }}
            </span>
            <button class="btn btn-ghost btn-xs text-error" @click.stop="deleteTemplate(t.name)">🗑</button>
          </div>
          <p class="text-xs text-base-content/30 mono mt-1 truncate">{{ t.preview }}</p>
        </div>

        <div v-if="!loadingList && !templates.length"
          class="text-center text-base-content/30 py-8 text-sm">
          No templates available.
        </div>
      </div>

      <!-- Editor -->
      <div class="md:col-span-2">
        <div class="bg-base-200 rounded-xl p-4 border border-base-300 space-y-4">
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <label class="label pb-1"><span class="label-text font-semibold">Template name</span></label>
              <input v-model="editorName" type="text" placeholder="my-config"
                class="input input-bordered input-sm w-full mono" />
            </div>
            <div class="pt-6">
              <button class="btn btn-sm brand-button-text" style="background:var(--brand)"
                @click="save" :disabled="saving">
                <span v-if="saving" class="loading loading-spinner loading-xs"></span>
                Save
              </button>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="label-text font-semibold">Configuration (JSON)</label>
              <button class="btn btn-ghost btn-xs" @click="formatJson">Format</button>
            </div>
            <textarea v-model="editorJson" rows="20" class="textarea textarea-bordered w-full json-editor bg-base-300"
              placeholder='{"interfaces": {...}}'></textarea>
            <p v-if="jsonError" class="text-error text-xs mt-1">{{ jsonError }}</p>
          </div>

          <div v-if="selected">
            <div class="text-xs font-semibold text-base-content/40 mb-2 uppercase tracking-wide">Apply to instance</div>
            <div class="flex gap-2">
              <select v-model="applyTarget" class="select select-bordered select-sm flex-1 bg-base-300">
                <option value="">— Select instance —</option>
                <option v-for="n in instanceNames" :key="n" :value="n">{{ n }}</option>
              </select>
              <button class="btn btn-sm btn-success" @click="applyToInstance" :disabled="!applyTarget || applying">
                <span v-if="applying" class="loading loading-spinner loading-xs"></span>
                Apply (PUT)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Interface variable substitution modal -->
    <dialog v-if="ifVarModal" open class="modal modal-open z-50">
      <div class="modal-box max-w-md">
        <h3 class="font-bold text-lg mb-1">Interface Variables</h3>
        <p class="text-sm text-base-content/50 mb-4">Select an interface for each placeholder found in the template.</p>
        <div v-if="ifVarLoading" class="flex justify-center py-4">
          <span class="loading loading-dots loading-md brand-text"></span>
        </div>
        <div v-else class="space-y-4">
          <div v-for="v in ifVarList" :key="v" class="space-y-1">
            <div class="flex items-center gap-2">
              <div class="mono text-sm font-bold brand-text w-16 shrink-0">{{ v }}</div>
              <div class="flex-1 relative">
                <input
                  v-model="ifVarSearch[v]"
                  type="text"
                  placeholder="Filter interfaces..."
                  class="input input-bordered input-sm w-full bg-base-300 pr-6"
                />
                <button v-if="ifVarSearch[v]" @click="ifVarSearch[v] = ''"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content text-xs">
                  ✕
                </button>
              </div>
            </div>
            <div class="pl-18">
              <select v-model="ifVarSelections[v]" size="4"
                class="select select-bordered select-sm w-full bg-base-300 h-auto py-1">
                <option value="">— none —</option>
                <option v-for="itf in filteredInterfaces(v)" :key="itf.name" :value="itf.name">
                  {{ itf.name }}{{ itf.mac ? '  (' + itf.mac + ')' : '' }}
                </option>
              </select>
              <div v-if="ifVarSelections[v]" class="text-xs text-success mono mt-1 pl-1">
                ✓ {{ ifVarSelections[v] }}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-action mt-5">
          <button class="btn btn-sm btn-ghost" @click="ifVarModal = false">Cancel</button>
          <button class="btn btn-sm btn-success" @click="confirmApplyWithVars"
            :disabled="!ifVarSelectionsComplete || applying">
            <span v-if="applying" class="loading loading-spinner loading-xs"></span>
            Apply
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="ifVarModal = false"></div>
    </dialog>
  </div>
  `,

  setup() {
    const templates   = ref([]);
    const loadingList = ref(false);
    const selected    = ref(null);
    const editorName  = ref("");
    const editorJson  = ref("{\n  \n}");
    const jsonError   = ref("");
    const saving      = ref(false);
    const applying    = ref(false);
    const applyTarget = ref("");
    const instanceNames = ref([]);
    const toast       = ref(null);

    // interface variable substitution
    const ifVarModal   = ref(false);
    const ifVarList    = ref([]);       // unique sorted variable names e.g. ["$IF1","$IF2"]
    const ifVarSelections = ref({});   // { "$IF1": "eth0", ... }
    const ifVarSearch  = ref({});      // { "$IF1": "eth", ... } — per-variable filter text
    const availableInterfaces = ref([]);
    const ifVarLoading = ref(false);
    const ifVarSelectionsComplete = computed(
      () => ifVarList.value.length > 0 && ifVarList.value.every(v => !!ifVarSelections.value[v])
    );

    function filteredInterfaces(v) {
      const q = (ifVarSearch.value[v] || "").toLowerCase().trim();
      if (!q) return availableInterfaces.value;
      return availableInterfaces.value.filter(
        itf => itf.name?.toLowerCase().includes(q) || itf.mac?.toLowerCase().includes(q)
      );
    }

    function extractIfVars(jsonText) {
      const matches = [...jsonText.matchAll(/\$IF\d+/g)];
      return [...new Set(matches.map(m => m[0]))].sort((a, b) => {
        const na = parseInt(a.replace("$IF", ""), 10);
        const nb = parseInt(b.replace("$IF", ""), 10);
        return na - nb;
      });
    }

    function showToast(msg, type = "success") {
      toast.value = { msg, type };
      setTimeout(() => { toast.value = null; }, 3000);
    }

    async function loadList() {
      loadingList.value = true;
      try { templates.value = await api.get("/ui-api/templates") ?? []; }
      catch { templates.value = []; }
      finally { loadingList.value = false; }
    }

    async function loadTemplate(name) {
      try {
        const data = await api.get(`/ui-api/templates/${encodeURIComponent(name)}`);
        selected.value = { name };
        editorName.value = name;
        editorJson.value = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        jsonError.value = "";
      } catch (e) {
        showToast(`Load failed: ${e.message}`, "error");
      }
    }

    function createNew() {
      selected.value = null;
      editorName.value = "";
      editorJson.value = "{\n  \n}";
      jsonError.value = "";
    }

    function formatJson() {
      jsonError.value = "";
      try {
        editorJson.value = JSON.stringify(JSON.parse(editorJson.value), null, 2);
      } catch (e) {
        jsonError.value = `Invalid JSON: ${e.message}`;
      }
    }

    async function save() {
      jsonError.value = "";
      const name = editorName.value.trim();
      if (!name) { jsonError.value = "Template name is required"; return; }
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
        jsonError.value = "Only letters, numbers, _ and - are allowed (max. 64)"; return;
      }
      let parsed;
      try { parsed = JSON.parse(editorJson.value); }
      catch (e) { jsonError.value = `Invalid JSON: ${e.message}`; return; }

      saving.value = true;
      try {
        await api.put(`/ui-api/templates/${encodeURIComponent(name)}`, parsed);
        showToast(`Template "${name}" saved`);
        selected.value = { name };
        await loadList();
      } catch (e) {
        jsonError.value = `Save failed: ${e.message}`;
      } finally {
        saving.value = false;
      }
    }

    async function deleteTemplate(name) {
      if (!confirm(`Delete template "${name}"?`)) return;
      try {
        await api.delete(`/ui-api/templates/${encodeURIComponent(name)}`);
        showToast(`"${name}" deleted`);
        if (selected.value?.name === name) createNew();
        await loadList();
      } catch (e) {
        showToast(`Delete failed: ${e.message}`, "error");
      }
    }

    async function applyToInstance() {
      if (!applyTarget.value || !selected.value) return;
      try { JSON.parse(editorJson.value); }
      catch (e) { jsonError.value = `Invalid JSON: ${e.message}`; return; }

      const vars = extractIfVars(editorJson.value);
      if (vars.length > 0) {
        ifVarList.value = vars;
        ifVarSelections.value = Object.fromEntries(vars.map(v => [v, ""]));
        ifVarSearch.value = Object.fromEntries(vars.map(v => [v, ""]));
        ifVarLoading.value = true;
        ifVarModal.value = true;
        try {
          const data = await api.get("/api/v1/interfaces");
          availableInterfaces.value = Array.isArray(data) ? data : [];
        } catch {
          availableInterfaces.value = [];
        } finally {
          ifVarLoading.value = false;
        }
        return; // wait for user confirmation
      }

      await _doApply(editorJson.value);
    }

    async function confirmApplyWithVars() {
      ifVarModal.value = false;
      // replace longer variable names first to avoid partial matches ($IF10 before $IF1)
      const sortedByLength = [...ifVarList.value].sort((a, b) => b.length - a.length);
      let jsonText = editorJson.value;
      for (const v of sortedByLength) {
        jsonText = jsonText.replaceAll(v, ifVarSelections.value[v]);
      }
      try { JSON.parse(jsonText); }
      catch (e) { jsonError.value = `JSON invalid after substitution: ${e.message}`; return; }
      await _doApply(jsonText);
    }

    async function _doApply(jsonText) {
      applying.value = true;
      try {
        await api.put(`/api/v1/instances/${encodeURIComponent(applyTarget.value)}`, JSON.parse(jsonText));
        showToast(`Template applied to "${applyTarget.value}"`);
      } catch (e) {
        showToast(`Apply failed: ${e.message}`, "error");
      } finally {
        applying.value = false;
      }
    }

    onMounted(async () => {
      await loadList();
      try {
        const names = await api.get("/api/v1/instances");
        instanceNames.value = Array.isArray(names) ? names : [];
      } catch { instanceNames.value = []; }
    });

    return {
      templates, loadingList, selected, editorName, editorJson,
      jsonError, saving, applying, applyTarget, instanceNames, toast,
      loadTemplate, createNew, formatJson, save, deleteTemplate, applyToInstance,
      ifVarModal, ifVarList, ifVarSelections, ifVarSearch, availableInterfaces, ifVarLoading,
      ifVarSelectionsComplete, confirmApplyWithVars, filteredInterfaces,
    };
  },
};
