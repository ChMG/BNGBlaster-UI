// pages/instances.js — Instance table with auto-refresh, create/edit modal
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { api, usePoller } from "../api.js";

const STATUS_CLASS = {
  started: "badge-success",
  running: "badge-success",
  active: "badge-success",
  up: "badge-success",
  stopped: "badge-ghost",
  error:   "badge-error",
  unknown: "badge-warning",
};

const SESSION_PAGE_SIZE = 10;
function isStartedLike(status) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "started" || s === "running" || s === "active" || s === "up";
}

const START_LOGGING_FLAGS = [
  { value: "debug", desc: "debug events" },
  { value: "info", desc: "informational events" },
  { value: "error", desc: "error events" },
  { value: "igmp", desc: "igmp events with join and leave time" },
  { value: "io", desc: "interface input/output events" },
  { value: "pppoe", desc: "pppoe events" },
  { value: "pcap", desc: "PCAP related events" },
  { value: "ip", desc: "log learned IP addresses" },
  { value: "loss", desc: "log traffic loss with sequence number" },
  { value: "l2tp", desc: "log L2TP (LNS) events" },
  { value: "dhcp", desc: "log DHCP events" },
  { value: "isis", desc: "log ISIS events" },
  { value: "bgp", desc: "log BGP events" },
  { value: "tcp", desc: "log TCP events" },
  { value: "lag", desc: "log link aggregation (LAG) events" },
  { value: "dpdk", desc: "log DPDK events" },
  { value: "packet", desc: "log packet events" },
  { value: "http", desc: "log HTTP events" },
  { value: "icmp", desc: "log ICMP events" },
];

const StatusBadge = {
  props: ["status", "loading"],
  template: `
    <span v-if="loading" class="badge badge-ghost gap-1 animate-pulse">
      <span class="loading loading-ring loading-xs"></span> ...
    </span>
    <span v-else :class="['badge gap-1', cls]">
      <span :class="['inline-block w-1.5 h-1.5 rounded-full', dotCls]"></span>
      {{ status ?? '—' }}
    </span>
  `,
  setup(props) {
    const cls = computed(() => STATUS_CLASS[props.status] ?? "badge-ghost");
    const dotCls = computed(() => ({
      "bg-success": isStartedLike(props.status),
      "bg-error":   props.status === "error",
      "bg-warning": props.status === "unknown",
      "bg-base-content/30": props.status === "stopped",
    }));
    return { cls, dotCls };
  },
};

export default {
  name: "InstancesPage",
  components: { StatusBadge },
  template: `
  <div class="p-6 space-y-5">

    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Instances</h1>
        <p class="text-sm text-base-content/50 mt-0.5">
          {{ instances.length }} instance(s) · Updated {{ lastUpdated }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
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
        <button class="btn btn-sm btn-ghost" @click="loadAll" :disabled="loading" title="Reload">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" :class="loading && 'animate-spin'">
            <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/>
          </svg>
        </button>
        <button class="btn btn-sm brand-text" style="background:var(--brand-dim);border:1px solid rgba(40,212,172,0.3)" @click="openCreate">
          + New Instance
        </button>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-base-200 rounded-xl p-4 flex items-center gap-3">
        <div class="text-3xl font-bold text-base-content">{{ instances.length }}</div>
        <div class="text-sm text-base-content/50">Total</div>
      </div>
      <div class="bg-base-200 rounded-xl p-4 flex items-center gap-3">
        <div class="text-3xl font-bold text-success">{{ runningCount }}</div>
        <div class="text-sm text-base-content/50">Running</div>
      </div>
      <div class="bg-base-200 rounded-xl p-4 flex items-center gap-3">
        <div class="text-3xl font-bold text-base-content/40">{{ stoppedCount }}</div>
        <div class="text-sm text-base-content/50">Stopped</div>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-xl overflow-hidden border border-base-300">
      <table class="table table-zebra w-full stable-table">
        <colgroup>
          <col style="width: 36%" />
          <col style="width: 18%" />
          <col style="width: 46%" />
        </colgroup>
        <thead class="bg-base-200">
          <tr>
            <th class="text-base-content/60 font-semibold">Instance</th>
            <th class="text-base-content/60 font-semibold">Status</th>
            <th class="text-base-content/60 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="inst in instances" :key="inst.name" class="hover">
            <td>
              <button class="mono text-sm font-semibold brand-text hover:underline" @click="openDetail(inst)">
                {{ inst.name }}
              </button>
            </td>
            <td>
              <StatusBadge :status="inst.status" :loading="inst.loading" />
            </td>
            <td>
              <div class="flex flex-wrap gap-1">
                <button class="btn btn-xs btn-success"  @click="openStartOptions(inst)"  :disabled="inst.busy">▶ Start</button>
                <button class="btn btn-xs btn-warning"  @click="action(inst,'stop')"   :disabled="inst.busy">⏹ Stop</button>
                <button class="btn btn-xs btn-error"    @click="action(inst,'kill')"   :disabled="inst.busy">⚡ Kill</button>
                <button class="btn btn-xs btn-ghost"    @click="openEdit(inst)"        :disabled="inst.busy">✏ Edit</button>
                <button class="btn btn-xs btn-ghost text-error" @click="deleteInst(inst)" :disabled="inst.busy">🗑</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !instances.length">
            <td colspan="3" class="text-center text-base-content/30 py-10">
              No instances available. Create one with "+ New Instance".
            </td>
          </tr>
          <tr v-if="loading && !instances.length">
            <td colspan="3" class="text-center py-10">
              <span class="loading loading-dots loading-md text-base-content/30"></span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Toast notification -->
    <div v-if="toast" class="toast toast-top toast-end z-50">
      <div :class="['alert text-sm', toast.type === 'error' ? 'alert-error' : 'alert-success']">
        {{ toast.msg }}
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <dialog ref="modalRef" class="modal">
      <div class="modal-box w-full max-w-2xl bg-base-200 relative">
        <h3 class="font-bold text-lg mb-4">{{ editing ? 'Edit Instance' : 'New Instance' }}</h3>

        <div class="space-y-4">
          <div>
            <label class="label pb-1"><span class="label-text font-semibold">Instance Name</span></label>
            <input v-model="form.name" :readonly="editing" type="text" placeholder="sample"
              class="input input-bordered input-sm w-full mono"
              :class="editing && 'opacity-60'" />
          </div>

          <div>
            <label class="label pb-1">
              <span class="label-text font-semibold">Load Template</span>
              <span class="label-text-alt text-base-content/40">optional</span>
            </label>
            <div class="flex gap-2">
              <select v-model="form.selectedTemplate" class="select select-bordered select-sm flex-1 bg-base-300">
                <option value="">— no template —</option>
                <option v-for="t in templates" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <button class="btn btn-sm btn-ghost" @click="applyTemplate" :disabled="!form.selectedTemplate">
                Load
              </button>
            </div>
          </div>

          <div>
            <label class="label pb-1"><span class="label-text font-semibold">Configuration (JSON)</span></label>
            <textarea v-model="form.config" rows="12" class="textarea textarea-bordered w-full json-editor bg-base-300"
              placeholder="{}"></textarea>
            <p v-if="form.jsonError" class="text-error text-xs mt-1">{{ form.jsonError }}</p>
          </div>
        </div>

        <div class="modal-action mt-4">
          <button v-if="editing" class="btn btn-ghost" :disabled="templateSaving" @click="saveFormAsTemplate">
            <span v-if="templateSaving" class="loading loading-spinner loading-xs"></span>
            Save as Template
          </button>
          <button class="btn btn-ghost" @click="closeModal">Cancel</button>
          <button class="btn brand-button-text" style="background:var(--brand)" :disabled="form.saving" @click="saveInstance">
            <span v-if="form.saving" class="loading loading-spinner loading-xs"></span>
            {{ editing ? 'Save' : 'Create' }}
          </button>
        </div>

        <!-- Interface Variable Substitution (overlay inside modal-box) -->
        <div v-if="instIfVarModal" class="absolute inset-0 rounded-2xl bg-base-200/95 backdrop-blur-sm flex flex-col p-6 overflow-y-auto">
          <h3 class="font-bold text-lg mb-1">Interface Variables</h3>
          <p class="text-sm text-base-content/50 mb-4">Select an interface for each placeholder found in the template.</p>
          <div v-if="instIfVarLoading" class="flex justify-center py-4">
            <span class="loading loading-dots loading-md brand-text"></span>
          </div>
          <div v-else class="space-y-4 flex-1">
            <div v-for="v in instIfVarList" :key="v" class="space-y-1">
              <div class="flex items-center gap-2">
                <div class="mono text-sm font-bold brand-text w-16 shrink-0">{{ v }}</div>
                <div class="flex-1 relative">
                  <input
                    v-model="instIfVarSearch[v]"
                    type="text"
                    placeholder="Filter interfaces..."
                    class="input input-bordered input-sm w-full bg-base-300 pr-6"
                  />
                  <button v-if="instIfVarSearch[v]" @click="instIfVarSearch[v] = ''"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content text-xs">
                    &#x2715;
                  </button>
                </div>
              </div>
              <div class="pl-18">
                <select v-model="instIfVarSelections[v]" size="4"
                  class="select select-bordered select-sm w-full bg-base-300 h-auto py-1">
                  <option value="">&mdash; none &mdash;</option>
                  <option v-for="itf in instFilteredInterfaces(v)" :key="itf.name" :value="itf.name">
                    {{ itf.name }}{{ itf.mac ? '  (' + itf.mac + ')' : '' }}
                  </option>
                </select>
                <div v-if="instIfVarSelections[v]" class="text-xs text-success mono mt-1 pl-1">
                  &#x2713; {{ instIfVarSelections[v] }}
                </div>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-4 border-t border-base-300 mt-4">
            <button class="btn btn-sm btn-ghost" @click="instIfVarModal = false">Cancel</button>
            <button class="btn btn-sm btn-success" @click="confirmApplyTemplateWithVars"
              :disabled="!instIfVarSelectionsComplete">
              Load
            </button>
          </div>
        </div>

        <!-- Stop-and-Reapply Dialog (running instance) -->
        <div v-if="stopAndReapplyModal" class="absolute inset-0 rounded-2xl bg-base-200/95 backdrop-blur-sm flex flex-col p-6 justify-center items-center">
          <div class="bg-base-100 rounded-xl p-6 border border-base-300 max-w-sm text-center space-y-4">
            <h3 class="font-bold text-lg">Instance is Running</h3>
            <p class="text-sm text-base-content/70">
              The instance <span class="mono font-semibold">{{ stopAndReapplyPending?.name }}</span> is currently running.
            </p>
            <p class="text-sm text-base-content/70">
              Would you like to stop it, apply the configuration, and restart it?
            </p>
            <div class="flex gap-2 justify-center pt-2">
              <button class="btn btn-sm btn-ghost" @click="stopAndReapplyModal = false">No</button>
              <button class="btn btn-sm btn-success" @click="proceedStopApplyRestart"
                :disabled="form.saving">
                <span v-if="form.saving" class="loading loading-spinner loading-xs"></span>
                Yes
              </button>
            </div>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>
    <dialog ref="startOptionsRef" class="modal">
      <div class="modal-box w-full max-w-xl bg-base-200">
        <h3 class="font-bold text-lg mb-4">Start Instance</h3>
        <div class="space-y-4">
          <div>
            <label class="label pb-1"><span class="label-text font-semibold">Instance</span></label>
            <div class="bg-base-300 rounded-lg p-2 text-xs mono">{{ startOptions.inst?.name || '—' }}</div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" class="toggle toggle-sm toggle-success" v-model="startOptions.logging" />
              <span class="text-sm">Enable logging</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" class="toggle toggle-sm toggle-success" v-model="startOptions.report" />
              <span class="text-sm">Enable report</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" class="toggle toggle-sm toggle-success" v-model="startOptions.pcap" />
              <span class="text-sm">Enable PCAP</span>
            </label>
          </div>

          <div v-if="startOptions.logging">
            <label class="label pb-1"><span class="label-text font-semibold">Logging flags</span></label>
            <div class="bg-base-300 rounded-lg p-2 flex flex-wrap gap-2">
              <label v-for="flag in startLoggingFlags" :key="flag.value" class="flex items-center gap-1 text-xs cursor-pointer" :title="flag.desc">
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs"
                  :checked="startOptions.loggingFlags.includes(flag.value)"
                  @change="toggleStartLoggingFlag(flag.value, $event.target.checked)"
                />
                <span class="mono">{{ flag.value }}</span>
              </label>
            </div>
          </div>

          <div>
            <label class="label pb-1"><span class="label-text font-semibold">Session count (optional)</span></label>
            <input
              v-model.trim="startOptions.sessionCount"
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 100"
              class="input input-sm input-bordered w-full bg-base-300"
            />
            <p v-if="startOptions.error" class="text-error text-xs mt-1">{{ startOptions.error }}</p>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="closeStartOptions">Cancel</button>
          <button class="btn btn-success" :disabled="startOptions.saving" @click="confirmStartWithOptions">
            <span v-if="startOptions.saving" class="loading loading-spinner loading-xs"></span>
            Start
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>

    <!-- Detail Modal -->
    <dialog ref="detailRef" class="modal" @close="onDetailClose">
      <div class="modal-box w-full bg-base-200" style="max-width:min(96vw, 1400px)" v-if="detailInst">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-lg mono">{{ detailInst.name }}</h3>
          <StatusBadge :status="detailInst.status" :loading="detailInst.loading" />
        </div>

        <div class="space-y-3">
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm btn-success"  @click="openStartOptions(detailInst)">▶ Start</button>
            <button class="btn btn-sm btn-warning"  @click="action(detailInst,'stop')">⏹ Stop</button>
            <button class="btn btn-sm btn-error"    @click="action(detailInst,'kill')">⚡ Kill</button>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
                Sessions
              </div>
              <div class="flex items-center gap-2">
                <label class="flex items-center gap-1 text-[11px] text-base-content/60 cursor-pointer select-none">
                  <input type="checkbox" class="toggle toggle-xs toggle-success" v-model="sessionAutoOn" @change="onSessionAutoChange" />
                  Auto
                </label>
                <select class="select select-xs bg-base-300 w-16" v-model.number="sessionIntervalSec" @change="onSessionIntervalChange">
                  <option :value="2">2s</option>
                  <option :value="3">3s</option>
                  <option :value="5">5s</option>
                  <option :value="10">10s</option>
                </select>
                <input
                  v-model.trim="sessionFilter"
                  type="text"
                  placeholder="Filter sessions..."
                  class="input input-bordered input-xs w-40 bg-base-300"
                />
                <span class="text-[11px] text-base-content/40">{{ sessionsUpdated }}</span>
                <button class="btn btn-xs btn-ghost" @click="loadSessions" :disabled="sessionsLoading || !isDetailStarted">Reload</button>
              </div>
            </div>
            <div v-if="sessionsLoading && !sessions.length" class="bg-base-300 rounded-lg p-3 text-xs text-base-content/50">
              Loading sessions...
            </div>
            <div v-else-if="sessionsError && !sessions.length" class="bg-base-300 rounded-lg p-3 text-xs text-error">
              {{ sessionsError }}
            </div>
            <div v-if="sessions.length">
              <div v-if="sessionsError" class="mb-2 rounded-lg bg-base-300 px-3 py-2 text-xs text-error">
                {{ sessionsError }}
              </div>
              <div class="rounded-lg border border-base-300">
                <table class="table table-xs w-full stable-table sessions-table">
                  <colgroup>
                    <col style="width: 7%" />
                    <col style="width: 18%" />
                    <col style="width: 13%" />
                    <col style="width: 14%" />
                    <col style="width: 16%" />
                    <col style="width: 14%" />
                    <col style="width: 18%" />
                  </colgroup>
                  <thead class="bg-base-200">
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Status</th>
                      <th>Interface</th>
                      <th>MAC</th>
                      <th>VLAN</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in pagedSessions" :key="row.id">
                      <td class="mono">{{ row.id }}</td>
                      <td class="mono">{{ row.username }}</td>
                      <td>{{ row.status }}</td>
                      <td class="mono">{{ row.iface }}</td>
                      <td class="mono">{{ row.mac }}</td>
                      <td class="mono">{{ row.vlan }}</td>
                      <td>
                        <div class="flex items-center gap-1">
                          <button
                            :class="['btn btn-xs', sessionActionMeta(row).kind === 'stop' ? 'btn-warning' : 'btn-success']"
                            @click.stop="runSessionAction(row)"
                            :disabled="sessionActionBusy === row.id"
                          >
                            {{ sessionActionBusy === row.id ? '...' : sessionActionMeta(row).label }}
                          </button>
                          <button
                            class="btn btn-xs btn-ghost"
                            @click.stop="restartSession(row)"
                            :disabled="sessionActionBusy === row.id"
                          >
                            {{ sessionActionBusy === row.id ? '...' : 'Restart' }}
                          </button>
                          <button
                            class="btn btn-xs btn-ghost"
                            @click.stop="openSessionEdit(row)"
                            :disabled="sessionActionBusy === row.id"
                          >
                            Edit
                          </button>
                          <button
                            class="btn btn-xs btn-ghost"
                            @click.stop="openSessionDetail(row)"
                            :disabled="sessionActionBusy === row.id"
                          >
                            Detail
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr v-for="emptyIdx in emptySessionRows" :key="'empty-' + sessionPage + '-' + emptyIdx" class="pointer-events-none opacity-40">
                      <td colspan="7">&nbsp;</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="sessionPageCount > 1" class="flex items-center justify-between mt-2 text-xs text-base-content/50">
                <span>
                  {{ sessionPageStart + 1 }}-{{ sessionPageEnd }} of {{ filteredSessions.length }} sessions
                </span>
                <div class="flex items-center gap-2">
                  <button class="btn btn-xs btn-ghost" @click="prevSessionPage" :disabled="sessionPage <= 1">Back</button>
                  <span>Page {{ sessionPage }} / {{ sessionPageCount }}</span>
                  <button class="btn btn-xs btn-ghost" @click="nextSessionPage" :disabled="sessionPage >= sessionPageCount">Next</button>
                </div>
              </div>
            </div>
            <div v-else class="bg-base-300 rounded-lg p-3 text-xs text-base-content/50">
              No sessions available.
            </div>
          </div>

          <div>
            <div class="text-xs font-semibold text-base-content/50 mb-1 uppercase tracking-wide">Download Files</div>
            <div class="flex flex-wrap gap-2">
              <a v-for="f in downloadFiles" :key="f"
                :href="'/api/v1/instances/' + encodeURIComponent(detailInst.name) + '/' + f"
                target="_blank" rel="noopener noreferrer"
                class="btn btn-xs btn-ghost mono">{{ f }}</a>
            </div>
          </div>

          <details class="bg-base-300 rounded-lg p-2">
            <summary class="text-xs font-semibold text-base-content/60 uppercase tracking-wide cursor-pointer select-none">
              Send Command
            </summary>
            <div class="mt-3">
              <div class="flex gap-2 mb-2">
                <input v-model="cmdName" type="text" placeholder="session-info" class="input input-bordered input-xs flex-1 mono bg-base-100" />
                <button class="btn btn-xs brand-text" style="background:var(--brand-dim)" @click="sendCommand">Send</button>
              </div>
              <textarea v-model="cmdArgs" rows="3" class="textarea textarea-bordered w-full json-editor text-xs bg-base-100"
                placeholder='{"outer-vlan": 128}'></textarea>
              <pre v-if="cmdResult" class="bg-base-100 rounded-lg p-2 text-xs mono mt-2 overflow-auto max-h-40">{{ cmdResult }}</pre>
            </div>
          </details>
        </div>

        <dialog ref="sessionEditRef" class="modal">
          <div class="modal-box w-full max-w-lg bg-base-200">
            <h3 class="font-bold text-lg mb-4">Edit Session</h3>
            <div class="space-y-3">
              <div>
                <label class="label pb-1"><span class="label-text font-semibold">Session-ID</span></label>
                <div class="bg-base-300 rounded-lg p-2 text-xs mono">
                  {{ sessionEdit.row ? sessionEdit.row.id : '—' }}
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label pb-1"><span class="label-text">username</span></label>
                  <input v-model="sessionEdit.fields.username" type="text" class="input input-sm input-bordered w-full bg-base-300" placeholder="(unchanged)" />
                </div>
                <div>
                  <label class="label pb-1"><span class="label-text">password</span></label>
                  <input v-model="sessionEdit.fields.password" type="password" autocomplete="new-password" class="input input-sm input-bordered w-full bg-base-300" placeholder="(unchanged)" />
                </div>
                <div>
                  <label class="label pb-1"><span class="label-text">agent-remote-id</span></label>
                  <input v-model="sessionEdit.fields['agent-remote-id']" type="text" class="input input-sm input-bordered w-full bg-base-300" placeholder="(unchanged)" />
                </div>
                <div>
                  <label class="label pb-1"><span class="label-text">agent-circuit-id</span></label>
                  <input v-model="sessionEdit.fields['agent-circuit-id']" type="text" class="input input-sm input-bordered w-full bg-base-300" placeholder="(unchanged)" />
                </div>
                <div class="col-span-2">
                  <label class="label pb-1"><span class="label-text">ipv6-link-local</span></label>
                  <input v-model="sessionEdit.fields['ipv6-link-local']" type="text" class="input input-sm input-bordered w-full bg-base-300" placeholder="(unchanged)" />
                </div>
              </div>
              <p class="text-xs text-base-content/50">Empty fields are not sent.</p>
              <p v-if="sessionEdit.error" class="text-error text-xs">{{ sessionEdit.error }}</p>
            </div>
            <div class="modal-action">
              <button class="btn btn-ghost" @click="closeSessionEdit">Cancel</button>
              <button class="btn brand-button-text" style="background:var(--brand)" :disabled="sessionEdit.saving" @click="saveSessionEdit">
                <span v-if="sessionEdit.saving" class="loading loading-spinner loading-xs"></span>
                Save
              </button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>

        <dialog ref="sessionInfoRef" class="modal">
          <div class="modal-box w-full max-w-2xl bg-base-200">
            <h3 class="font-bold text-lg mb-1">Session Detail</h3>
            <p class="text-xs text-base-content/50 mb-4 mono" v-if="selectedSession">
              ID {{ selectedSession.id }}<span v-if="selectedSession.username"> · {{ selectedSession.username }}</span>
            </p>
            <div v-if="sessionInfoLoading" class="flex items-center gap-2 text-sm text-base-content/50 py-4">
              <span class="loading loading-spinner loading-sm"></span> Loading session-info...
            </div>
            <pre v-else class="bg-base-100 rounded-lg p-3 text-xs mono overflow-auto max-h-[60vh]">{{ sessionInfoData ? JSON.stringify(sessionInfoData, null, 2) : '—' }}</pre>
            <div class="modal-action">
              <button class="btn btn-ghost" :disabled="sessionInfoLoading" @click="refreshSessionDetail">
                <span v-if="sessionInfoLoading" class="loading loading-spinner loading-xs"></span>
                <span v-else>↻</span>
                Refresh
              </button>
              <button class="btn btn-ghost" @click="closeSessionDetail">Close</button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="detailRef.close()">Close</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>

  </div>
  `,

  setup() {
    const instances   = ref([]);
    const loading     = ref(false);
    const lastUpdated = ref("—");
    const autoOn      = ref(true);
    const intervalSec = ref(5);
    const toast       = ref(null);
    const templates   = ref([]);
    const startLoggingFlags = START_LOGGING_FLAGS;

    // Modal state
    const modalRef = ref(null);
    const startOptionsRef = ref(null);
    const editing  = ref(false);
    const form = ref({ name: "", config: "{}", selectedTemplate: "", jsonError: "", saving: false });
    const startOptions = ref({
      inst: null,
      logging: false,
      report: false,
      pcap: false,
      loggingFlags: [],
      sessionCount: "",
      saving: false,
      error: "",
    });

    // Detail state
    const detailRef  = ref(null);
    const detailInst = ref(null);
    const detailRaw  = ref(null);
    const cmdName    = ref("session-info");
    const cmdArgs    = ref("{}");
    const cmdResult  = ref("");
    const sessionsLoading = ref(false);
    const sessionsError   = ref("");
    const sessionsRaw     = ref(null);
    const sessionsUpdated = ref("—");
    const selectedSession = ref(null);
    const sessionInfoData    = ref(null);
    const sessionInfoLoading = ref(false);
    const sessionActionBusy = ref("");
    const sessionInfoRef     = ref(null);
    const sessionEditRef = ref(null);
    const sessionEdit = ref({
      row: null,
      fields: { username: "", password: "", "agent-remote-id": "", "agent-circuit-id": "", "ipv6-link-local": "" },
      saving: false,
      error: "",
    });
    const sessionFilter = ref("");
    const sessionAutoOn = ref(true);
    const sessionIntervalSec = ref(3);
    const sessionPage = ref(1);
    const sessionDrainInProgress = ref(false);
    const templateSaving = ref(false);
    let sessionTimer = null;
    let _cfgFetchGen = 0;  // incremented whenever the user takes ownership of form.value.config

    // interface variable substitution (template load in edit popup)
    const instIfVarModal      = ref(false);
    const instIfVarList       = ref([]);
    const instIfVarSelections = ref({});
    const instIfVarSearch     = ref({});
    const instIfVarLoading    = ref(false);
    const instIfVarRawJson    = ref("");
    const instIfVarSelectionsComplete = computed(
      () => instIfVarList.value.length > 0 && instIfVarList.value.every(v => !!instIfVarSelections.value[v])
    );
    const instAvailableInterfaces = ref([]);

    // stop-and-reapply modal for running instances
    const stopAndReapplyModal = ref(false);
    const stopAndReapplyPending = ref(null);  // { name, config } when dialog is open

    async function saveServerStartOptions(instanceName, body) {
      try {
        await api.put(`/ui-api/instance-start-options/${encodeURIComponent(instanceName)}`, body ?? {});
      } catch {
        // Non-fatal: start should still work even if metadata persistence fails.
      }
    }

    async function getServerStartOptions(instanceName) {
      try {
        const data = await api.get(`/ui-api/instance-start-options/${encodeURIComponent(instanceName)}`);
        return (data && typeof data === "object") ? data : {};
      } catch {
        return {};
      }
    }

    async function deleteServerStartOptions(instanceName) {
      try {
        await api.delete(`/ui-api/instance-start-options/${encodeURIComponent(instanceName)}`);
      } catch {
        // Non-fatal: instance deletion should not fail because metadata cleanup failed.
      }
    }

    function _extractIfVars(jsonText) {
      const matches = [...jsonText.matchAll(/\$IF\d+/g)];
      return [...new Set(matches.map(m => m[0]))].sort((a, b) => {
        return parseInt(a.replace("$IF", ""), 10) - parseInt(b.replace("$IF", ""), 10);
      });
    }

    function instFilteredInterfaces(v) {
      const q = (instIfVarSearch.value[v] || "").toLowerCase().trim();
      if (!q) return instAvailableInterfaces.value;
      return instAvailableInterfaces.value.filter(
        itf => itf.name?.toLowerCase().includes(q) || itf.mac?.toLowerCase().includes(q)
      );
    }

    const downloadFiles = ["config.json","run.json","run.log","run_report.json","run.pcap","run.stdout","run.stderr"];

    const runningCount = computed(() => instances.value.filter(i => isStartedLike(i.status)).length);
    const stoppedCount = computed(() => instances.value.filter(i => !isStartedLike(i.status)).length);
    const isDetailStarted = computed(() => isStartedLike(detailInst.value?.status));

    function showToast(msg, type = "success") {
      toast.value = { msg, type };
      setTimeout(() => { toast.value = null; }, 3000);
    }

    async function loadAll() {
      loading.value = true;
      try {
        const names = await api.get("/api/v1/instances");
        if (!Array.isArray(names)) return;
        // Keep existing status during update, mark as loading
        const prev = Object.fromEntries(instances.value.map(i => [i.name, i.status]));
        instances.value = names.map(n => ({
          name: n, status: prev[n] ?? "unknown", loading: true, busy: false,
        }));
        // Fetch all statuses in parallel
        await Promise.allSettled(names.map(async (name, idx) => {
          try {
            const s = await api.get(`/api/v1/instances/${encodeURIComponent(name)}`);
            instances.value[idx] = { ...instances.value[idx], status: s?.status ?? "unknown", loading: false };
          } catch {
            instances.value[idx] = { ...instances.value[idx], status: "unknown", loading: false };
          }
        }));
        lastUpdated.value = new Date().toLocaleTimeString("en-US");
      } catch (e) {
        showToast("Failed to load instance list", "error");
      } finally {
        loading.value = false;
      }
    }

    async function action(inst, act, startBody) {
      inst.busy = true;
      const paths = { start: "_start", stop: "_stop", kill: "_kill" };
      try {
        const body = act === "start" ? (startBody ?? {}) : undefined;
        await api.post(`/api/v1/instances/${encodeURIComponent(inst.name)}/${paths[act]}`, body);
        showToast(`${act} → ${inst.name}`);
        await settleInstanceStatus(inst.name, act);
      } catch (e) {
        showToast(`${act} failed: ${e.message}`, "error");
      } finally {
        inst.busy = false;
      }
    }

    function applyInstanceStatus(name, status) {
      const listInst = instances.value.find(i => i.name === name);
      if (listInst) listInst.status = status;
      if (detailInst.value?.name === name) {
        detailInst.value.status = status;
        if (isStartedLike(status)) {
          if (sessionAutoOn.value) restartSessionPoller();
        } else {
          drainSessionsAfterStop();
        }
      }
    }

    async function fetchInstanceStatus(name) {
      try {
        const s = await api.get(`/api/v1/instances/${encodeURIComponent(name)}`);
        const status = s?.status ?? "unknown";
        applyInstanceStatus(name, status);
        if (detailInst.value?.name === name) detailRaw.value = s;
        return status;
      } catch {
        applyInstanceStatus(name, "unknown");
        return "unknown";
      }
    }

    async function settleInstanceStatus(name, act) {
      const maxAttempts = (act === "stop" || act === "kill") ? 8 : 6;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const status = await fetchInstanceStatus(name);
        if (act === "start" && isStartedLike(status)) return;
        if ((act === "stop" || act === "kill") && !isStartedLike(status)) return;
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }
    }

    async function deleteInst(inst) {
      if (!confirm(`Delete instance "${inst.name}"?`)) return;
      inst.busy = true;
      try {
        await api.delete(`/api/v1/instances/${encodeURIComponent(inst.name)}`);
        await deleteServerStartOptions(inst.name);
        showToast(`${inst.name} deleted`);
        await loadAll();
      } catch (e) {
        showToast(`Delete failed: ${e.message}`, "error");
        inst.busy = false;
      }
    }

    async function loadTemplates() {
      try { templates.value = await api.get("/ui-api/templates") ?? []; }
      catch { templates.value = []; }
    }

    function openCreate() {
      editing.value = false;
      form.value = { name: "", config: "{\n  \n}", selectedTemplate: "", jsonError: "", saving: false };
      loadTemplates();
      modalRef.value.showModal();
    }

    function openEdit(inst) {
      editing.value = true;
      instIfVarModal.value = false;
      form.value = { name: inst.name, config: "{\n  \n}", selectedTemplate: "", jsonError: "", saving: false };
      // Load existing config; but discard the response if the user has since applied a template
      const myGen = ++_cfgFetchGen;
      api.get(`/api/v1/instances/${encodeURIComponent(inst.name)}/config.json?_=${Date.now()}`)
        .then(c => {
          if (_cfgFetchGen !== myGen) return;  // superseded by a template load – ignore
          form.value.config = typeof c === "string" ? c : JSON.stringify(c, null, 2);
        })
        .catch(() => {});
      loadTemplates();
      modalRef.value.showModal();
    }

    function closeModal() { modalRef.value.close(); }

    async function applyTemplate() {
      if (!form.value.selectedTemplate) return;
      let jsonText;
      try {
        const tpl = await api.get(`/ui-api/templates/${encodeURIComponent(form.value.selectedTemplate)}`);
        jsonText = typeof tpl === "string" ? tpl : JSON.stringify(tpl, null, 2);
      } catch (e) {
        form.value.jsonError = "Failed to load template";
        return;
      }

      const vars = _extractIfVars(jsonText);
      if (vars.length > 0) {
        instIfVarRawJson.value = jsonText;
        instIfVarList.value = vars;
        instIfVarSelections.value = Object.fromEntries(vars.map(v => [v, ""]));
        instIfVarSearch.value = Object.fromEntries(vars.map(v => [v, ""]));
        instIfVarLoading.value = true;
        instIfVarModal.value = true;
        try {
          const data = await api.get("/api/v1/interfaces");
          instAvailableInterfaces.value = Array.isArray(data) ? data : [];
        } catch {
          instAvailableInterfaces.value = [];
        } finally {
          instIfVarLoading.value = false;
        }
        return;
      }

      // No $IF vars – take ownership so any in-flight config.json fetch is discarded
      _cfgFetchGen++;
      form.value.config = jsonText;
      form.value.jsonError = "";
    }

    function confirmApplyTemplateWithVars() {
      instIfVarModal.value = false;
      _cfgFetchGen++;  // discard any in-flight config.json fetch
      const sortedByLength = [...instIfVarList.value].sort((a, b) => b.length - a.length);
      let jsonText = instIfVarRawJson.value;
      for (const v of sortedByLength) {
        jsonText = jsonText.replaceAll(v, instIfVarSelections.value[v]);
      }
      form.value.config = jsonText;
      form.value.jsonError = "";
    }

    async function saveInstance() {
      form.value.jsonError = "";
      let parsed;
      try { parsed = JSON.parse(form.value.config); }
      catch (e) { form.value.jsonError = `Invalid JSON: ${e.message}`; return; }
      const name = form.value.name.trim();
      if (!name) { form.value.jsonError = "Instance name is required"; return; }

      form.value.saving = true;
      try {
        await api.put(`/api/v1/instances/${encodeURIComponent(name)}`, parsed);
        showToast(`${name} saved`);
        closeModal();
        await loadAll();
      } catch (e) {
        // If instance is running (412 Precondition Failed), ask to stop/apply/restart
        if (e.status === 412) {
          form.value.saving = false;
          stopAndReapplyPending.value = { name, config: form.value.config, parsed };
          stopAndReapplyModal.value = true;
          return;
        }
        form.value.jsonError = `Error: ${e.message}`;
      } finally {
        form.value.saving = false;
      }
    }

    async function proceedStopApplyRestart() {
      if (!stopAndReapplyPending.value) return;
      const { name, parsed } = stopAndReapplyPending.value;
      form.value.saving = true;
      try {
        // Stop the instance
        await api.post(`/api/v1/instances/${encodeURIComponent(name)}/_stop`);
        await new Promise(r => setTimeout(r, 500));  // brief wait for stop to settle
        
        // Apply config
        await api.put(`/api/v1/instances/${encodeURIComponent(name)}`, parsed);
        await new Promise(r => setTimeout(r, 500));

        // Start with previously used start options for this instance, if available.
        const restartBody = await getServerStartOptions(name);
        await api.post(`/api/v1/instances/${encodeURIComponent(name)}/_start`, restartBody);
        
        showToast(`${name} stopped, configured, and restarted`);
        stopAndReapplyModal.value = false;
        stopAndReapplyPending.value = null;
        closeModal();
        await loadAll();
      } catch (e) {
        form.value.jsonError = `Workflow failed: ${e.message}`;
        stopAndReapplyModal.value = false;
        stopAndReapplyPending.value = null;
      } finally {
        form.value.saving = false;
      }
    }

    async function openStartOptions(inst) {
      startOptions.value = {
        inst,
        logging: false,
        report: false,
        pcap: false,
        loggingFlags: ["error", "ip"],
        sessionCount: "",
        saving: false,
        error: "",
      };

      const saved = await getServerStartOptions(inst.name);
      if (saved && typeof saved === "object") {
        startOptions.value.logging = !!saved.logging;
        startOptions.value.report = !!saved.report;
        startOptions.value.pcap = !!saved.pcap;

        if (Array.isArray(saved.logging_flags)) {
          const validFlags = new Set(START_LOGGING_FLAGS.map(f => f.value));
          startOptions.value.loggingFlags = saved.logging_flags.filter(f => validFlags.has(f));
        }

        if (saved.session_count !== undefined && saved.session_count !== null) {
          startOptions.value.sessionCount = String(saved.session_count);
        }
      }

      startOptionsRef.value?.showModal();
    }

    function closeStartOptions() {
      startOptionsRef.value?.close();
    }

    function toggleStartLoggingFlag(flag, enabled) {
      const set = new Set(startOptions.value.loggingFlags);
      if (enabled) set.add(flag);
      else set.delete(flag);
      startOptions.value.loggingFlags = Array.from(set);
    }

    function buildStartBody() {
      const body = {};
      if (startOptions.value.logging) {
        body.logging = true;
        if (startOptions.value.loggingFlags.length) {
          body.logging_flags = [...startOptions.value.loggingFlags];
        }
      }
      if (startOptions.value.report) {
        body.report = true;
      }
      if (startOptions.value.pcap) {
        body.pcap = true;
      }
      const scRaw = String(startOptions.value.sessionCount || "").trim();
      if (scRaw !== "") {
        const count = Number(scRaw);
        if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
          throw new Error("Session count must be a positive integer");
        }
        body.session_count = count;
      }
      return body;
    }

    async function confirmStartWithOptions() {
      const inst = startOptions.value.inst;
      if (!inst) return;
      startOptions.value.error = "";
      let body;
      try {
        body = buildStartBody();
      } catch (e) {
        startOptions.value.error = e.message;
        return;
      }

      // Remember start options server-side for future stop/apply/restart flows.
      await saveServerStartOptions(inst.name, body);

      startOptions.value.saving = true;
      try {
        await action(inst, "start", body);
        closeStartOptions();
      } finally {
        startOptions.value.saving = false;
      }
    }

    async function openDetail(inst) {
      detailInst.value = inst;
      cmdResult.value = "";
      sessionsError.value = "";
      sessionsRaw.value = null;
      sessionsUpdated.value = "—";
      sessionFilter.value = "";
      selectedSession.value = null;
      sessionInfoData.value = null;
      sessionPage.value = 1;
      detailRef.value.showModal();
      await Promise.all([refreshDetail(), loadSessions()]);
      restartSessionPoller();
    }

    async function refreshDetail() {
      if (!detailInst.value) return;
      try {
        const s = await api.get(`/api/v1/instances/${encodeURIComponent(detailInst.value.name)}`);
        detailInst.value.status = s?.status ?? "unknown";
        detailRaw.value = s;
      } catch (e) {
        detailRaw.value = null;
      }
    }

    async function saveFormAsTemplate() {
      const suggested = String(form.value.name || "template").replace(/[^a-zA-Z0-9_-]/g, "_");
      const input = prompt("Template name (a-z, A-Z, 0-9, _, -)", suggested);
      if (input === null) return;
      const name = input.trim();
      if (!name) {
        showToast("Template name is required", "error");
        return;
      }
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
        showToast("Invalid template name", "error");
        return;
      }

      const exists = (templates.value || []).some(t => t?.name === name);
      if (exists && !confirm(`Template \"${name}\" already exists. Overwrite?`)) {
        return;
      }

      templateSaving.value = true;
      try {
        const cfg = JSON.parse(form.value.config);
        await api.put(`/ui-api/templates/${encodeURIComponent(name)}`, cfg);
        showToast(`Template saved: ${name}`);
        await loadTemplates();
        form.value.selectedTemplate = name;
      } catch (e) {
        if (e instanceof SyntaxError) {
          form.value.jsonError = `Invalid JSON: ${e.message}`;
          showToast("Template could not be saved", "error");
        } else {
          showToast(`Template save failed: ${e.message}`, "error");
        }
      } finally {
        templateSaving.value = false;
      }
    }

    async function sendCommand() {
      let args = {};
      try { args = cmdArgs.value.trim() ? JSON.parse(cmdArgs.value) : {}; }
      catch (e) { cmdResult.value = `Invalid JSON: ${e.message}`; return; }
      try {
        const r = await api.post(
          `/api/v1/instances/${encodeURIComponent(detailInst.value.name)}/_command`,
          { command: cmdName.value, arguments: args }
        );
        cmdResult.value = JSON.stringify(r, null, 2);
        if ((cmdName.value || "").trim() === "session-info") {
          sessionsRaw.value = r;
          sessionsUpdated.value = new Date().toLocaleTimeString("en-US");
          sessionsError.value = "";
        }
      } catch (e) {
        cmdResult.value = `Error: ${e.message}`;
      }
    }

    function normalizeSessions(payload) {
      const rows = [];
      const tryPushArray = (arr) => {
        if (!Array.isArray(arr)) return false;
        arr.forEach((item, idx) => {
          if (item && typeof item === "object") rows.push({ ...item, _idx: idx });
          else rows.push({ value: item, _idx: idx });
        });
        return true;
      };

      if (Array.isArray(payload)) {
        tryPushArray(payload);
      } else if (payload && typeof payload === "object") {
        if (!tryPushArray(payload.sessions)
            && !tryPushArray(payload.session_info)
            && !tryPushArray(payload.items)
            && !tryPushArray(payload.data)
            && !tryPushArray(payload.result)) {
          for (const [key, val] of Object.entries(payload)) {
            if (Array.isArray(val)) {
              tryPushArray(val);
              continue;
            }
            if (val && typeof val === "object") {
              rows.push({ name: key, ...val });
            }
          }
        }
      }

      return rows.map((s, idx) => {
        const outer = s.outer_vlan ?? s["outer-vlan"];
        const inner = s.inner_vlan ?? s["inner-vlan"];
        return {
          id: s.session_id ?? s["session-id"] ?? s.id ?? s.name ?? String(idx + 1),
          username: s.username ?? s.user ?? s.agent ?? s.pppoe_username ?? "—",
          status: s.state ?? s.status ?? s.session_state ?? s["session-state"] ?? "—",
          iface: s.interface ?? s.ifname ?? s.access_interface ?? "—",
          mac: s.mac ?? s.mac_address ?? s.hwaddr ?? "—",
          vlan: outer !== undefined || inner !== undefined
            ? `${outer ?? "-"}/${inner ?? "-"}`
            : "—",
          raw: s,
        };
      });
    }

    const sessions = computed(() => normalizeSessions(sessionsRaw.value));
    const filteredSessions = computed(() => {
      const q = String(sessionFilter.value || "").trim().toLowerCase();
      if (!q) return sessions.value;
      return sessions.value.filter((row) => {
        const text = [row.id, row.username, row.status, row.iface, row.mac, row.vlan]
          .map(v => String(v ?? "").toLowerCase())
          .join(" ");
        return text.includes(q);
      });
    });
    const sessionPageCount = computed(() => Math.max(1, Math.ceil(filteredSessions.value.length / SESSION_PAGE_SIZE)));
    const sessionPageStart = computed(() => (sessionPage.value - 1) * SESSION_PAGE_SIZE);
    const sessionPageEnd = computed(() => Math.min(sessionPageStart.value + SESSION_PAGE_SIZE, filteredSessions.value.length));
    const pagedSessions = computed(() =>
      filteredSessions.value.slice(sessionPageStart.value, sessionPageStart.value + SESSION_PAGE_SIZE)
    );
    const emptySessionRows = computed(() =>
      Array.from({ length: Math.max(0, SESSION_PAGE_SIZE - pagedSessions.value.length) }, (_, idx) => idx + 1)
    );
    function prevSessionPage() {
      sessionPage.value = Math.max(1, sessionPage.value - 1);
    }

    function nextSessionPage() {
      sessionPage.value = Math.min(sessionPageCount.value, sessionPage.value + 1);
    }

    async function fetchSessionInfo(row) {
      if (!detailInst.value || !row) return;
      const sid = Number(row.id);
      sessionInfoLoading.value = true;
      try {
        const r = await api.post(
          `/api/v1/instances/${encodeURIComponent(detailInst.value.name)}/_command`,
          { command: "session-info", arguments: { "session-id": Number.isFinite(sid) ? sid : row.id } }
        );
        sessionInfoData.value = r;
      } catch (e) {
        sessionInfoData.value = { error: e.message };
      } finally {
        sessionInfoLoading.value = false;
      }
    }

    async function openSessionDetail(row) {
      selectedSession.value = row;
      sessionInfoData.value = null;
      if (!sessionInfoRef.value?.open) {
        sessionInfoRef.value?.showModal();
      }
      await fetchSessionInfo(row);
    }

    async function refreshSessionDetail() {
      if (!selectedSession.value) return;
      await fetchSessionInfo(selectedSession.value);
    }

    function closeSessionDetail() {
      sessionInfoRef.value?.close();
      selectedSession.value = null;
      sessionInfoData.value = null;
    }

    function buildSessionArguments(row) {
      const src = row?.raw ?? {};
      const sid = src.session_id ?? src["session-id"] ?? src.id ?? row.id;
      if (sid === undefined || sid === null || sid === "—") return {};
      const asNumber = Number(sid);
      return Number.isFinite(asNumber) ? { "session-id": asNumber } : { "session-id": sid };
    }

    function sessionActionMeta(row) {
      const status = String(row?.status ?? "").trim().toLowerCase();
      const isRunningLike =
        status.includes("established")
        || status.includes("opened")
        || status.includes("running")
        || status.includes("active")
        || status.includes("up");
      return isRunningLike
        ? { command: "session-stop", label: "Stop", kind: "stop" }
        : { command: "session-start", label: "Start", kind: "start" };
    }

    async function runSessionAction(row) {
      if (!detailInst.value) return;
      const meta = sessionActionMeta(row);
      await runSessionCommand(row, meta.command, meta.label);
    }

    async function restartSession(row) {
      if (!detailInst.value) return;
      await runSessionCommand(row, "session-restart", "Restart");
    }

    async function runSessionCommand(row, command, label) {
      if (!detailInst.value) return;
      const args = buildSessionArguments(row);
      if (args["session-id"] === undefined) {
        showToast("Missing session-id", "error");
        return;
      }
      sessionActionBusy.value = row.id;
      try {
        const r = await api.post(
          `/api/v1/instances/${encodeURIComponent(detailInst.value.name)}/_command`,
          { command, arguments: args }
        );
        cmdResult.value = JSON.stringify(r, null, 2);
        showToast(`Session ${row.id}: ${label}`);
        await loadSessions();
      } catch (e) {
        cmdResult.value = `Error: ${e.message}`;
        showToast(`Session action failed: ${e.message}`, "error");
      } finally {
        sessionActionBusy.value = "";
      }
    }

    function openSessionEdit(row) {
      sessionEdit.value = {
        row,
        fields: {
          username: row.username || "",
          password: "",
          "agent-remote-id": "",
          "agent-circuit-id": "",
          "ipv6-link-local": "",
        },
        saving: false,
        error: "",
      };
      sessionEditRef.value?.showModal();
    }

    function closeSessionEdit() {
      sessionEditRef.value?.close();
    }

    async function saveSessionEdit() {
      if (!detailInst.value || !sessionEdit.value.row) return;
      sessionEdit.value.error = "";
      const body = { "session-id": sessionEdit.value.row.id };
      for (const [k, v] of Object.entries(sessionEdit.value.fields)) {
        const trimmed = typeof v === "string" ? v.trim() : "";
        if (trimmed !== "") body[k] = trimmed;
      }

      sessionEdit.value.saving = true;
      try {
        const r = await api.post(
          `/api/v1/instances/${encodeURIComponent(detailInst.value.name)}/_command`,
          { command: "session-update", arguments: body }
        );
        cmdResult.value = JSON.stringify(r, null, 2);
        showToast(`Session ${sessionEdit.value.row.id}: session-update`);
        closeSessionEdit();
        await loadSessions();
      } catch (e) {
        sessionEdit.value.error = e.message;
      } finally {
        sessionEdit.value.saving = false;
      }
    }

    async function loadSessions(options = {}) {
      if (!detailInst.value) return;
      const allowWhenStopped = options.allowWhenStopped === true;
      if (!isStartedLike(detailInst.value.status) && !allowWhenStopped) {
        return;
      }
      sessionsLoading.value = true;
      sessionsError.value = "";
      try {
        const endpoint = `/api/v1/instances/${encodeURIComponent(detailInst.value.name)}/_command`;
        const tryCommands = [
          { command: "session-summary", arguments: {} },
          { command: "sessions", arguments: {} },
          { command: "session-list", arguments: {} },
          { command: "session-info", arguments: {} },
        ];

        let lastError = "";
        let loaded = false;

        for (const request of tryCommands) {
          try {
            const response = await api.post(endpoint, request);
            if (normalizeSessions(response).length > 0) {
              sessionsRaw.value = response;
              sessionsUpdated.value = new Date().toLocaleTimeString("en-US");
              loaded = true;
              break;
            }
          } catch (e) {
            lastError = e.message || String(e);
            const txt = String(lastError).toLowerCase();
            // session-info often needs a specific ID; this is not fatal for list discovery.
            if (txt.includes("missing session-id")) continue;
          }
        }

        if (!loaded) {
          const fromDetail = normalizeSessions(detailRaw.value);
          if (fromDetail.length > 0) {
            sessionsRaw.value = fromDetail;
            sessionsUpdated.value = new Date().toLocaleTimeString("en-US");
            loaded = true;
          }
        }

        if (!loaded) {
          sessionsRaw.value = [];
          sessionsError.value = lastError && !String(lastError).toLowerCase().includes("missing session-id")
            ? `Failed to load sessions: ${lastError}`
            : "No session list available (session-info expects a session-id).";
        }
      } catch (e) {
        sessionsRaw.value = null;
        sessionsError.value = `Failed to load sessions: ${e.message}`;
      } finally {
        sessionsLoading.value = false;
      }
    }

    async function drainSessionsAfterStop() {
      if (!detailInst.value || isStartedLike(detailInst.value.status) || sessionDrainInProgress.value) return;
      sessionDrainInProgress.value = true;
      try {
        const maxAttempts = 10;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          await loadSessions({ allowWhenStopped: true });
          if (!sessions.value.length) break;
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
      } finally {
        sessionDrainInProgress.value = false;
        stopSessionPoller();
      }
    }

    function stopSessionPoller() {
      if (!sessionTimer) return;
      clearInterval(sessionTimer);
      sessionTimer = null;
    }

    function restartSessionPoller() {
      stopSessionPoller();
      if (!sessionAutoOn.value || !detailInst.value || !isStartedLike(detailInst.value.status)) return;
      sessionTimer = setInterval(() => {
        loadSessions().catch(() => {});
      }, sessionIntervalSec.value * 1000);
    }

    function onSessionAutoChange() {
      if (sessionAutoOn.value) restartSessionPoller();
      else stopSessionPoller();
    }

    function onSessionIntervalChange() {
      if (sessionAutoOn.value && detailInst.value) restartSessionPoller();
    }

    function onDetailClose() {
      stopSessionPoller();
      detailInst.value = null;
      selectedSession.value = null;
      sessionInfoData.value = null;
      sessionActionBusy.value = "";
      closeSessionEdit();
      sessionPage.value = 1;
    }

    const { restart: restartPoller, stop: stopMainPoller } = usePoller(loadAll, () => intervalSec.value);

    function onAutoChange() {
      if (autoOn.value) restartPoller();
      else stopMainPoller();
    }
    function onIntervalChange() { if (autoOn.value) restartPoller(); }

    onMounted(async () => {
      await loadAll();
      restartPoller();
    });

    onUnmounted(() => {
      stopSessionPoller();
    });

    watch(sessions, (rows) => {
      const pageCount = Math.max(1, Math.ceil(rows.length / SESSION_PAGE_SIZE));
      if (sessionPage.value > pageCount) sessionPage.value = pageCount;
    });

    watch(sessionFilter, () => {
      sessionPage.value = 1;
    });

    return {
      instances, loading, lastUpdated, autoOn, intervalSec, toast,
      templates, modalRef, startOptionsRef, editing, form, startOptions, startLoggingFlags,
      detailRef, detailInst, cmdName, cmdArgs, cmdResult, downloadFiles,
      sessionsLoading, sessionsError, sessions, filteredSessions, sessionsUpdated,
      sessionPage, sessionPageCount, sessionPageStart, sessionPageEnd, pagedSessions, emptySessionRows,
      isDetailStarted,
      selectedSession, sessionInfoData, sessionInfoLoading, sessionActionBusy, sessionAutoOn, sessionIntervalSec,
      templateSaving,
      sessionFilter,
      sessionInfoRef, sessionEditRef, sessionEdit,
      runningCount, stoppedCount,
      instIfVarModal, instIfVarList, instIfVarSelections, instIfVarSearch, instIfVarLoading,
      instIfVarSelectionsComplete, instAvailableInterfaces, instFilteredInterfaces,
      stopAndReapplyModal, stopAndReapplyPending,
      loadAll, action, deleteInst, openCreate, openEdit, closeModal,
      openStartOptions, closeStartOptions, confirmStartWithOptions, toggleStartLoggingFlag,
      applyTemplate, confirmApplyTemplateWithVars, saveInstance, proceedStopApplyRestart, openDetail, sendCommand, loadSessions,
      runSessionAction, restartSession, sessionActionMeta, prevSessionPage, nextSessionPage,
      openSessionEdit, closeSessionEdit, saveSessionEdit,
      openSessionDetail, refreshSessionDetail, closeSessionDetail,
      saveFormAsTemplate,
      onAutoChange, onIntervalChange,
      onSessionAutoChange, onSessionIntervalChange, onDetailClose,
    };
  },
};
