import React, { useEffect, useMemo, useState, type ReactNode } from "react";
// Extends the settings-slot owner props with the current DSH session feed.
import type {} from "@deepseek-ai/dsh-client-ui-session/client";

/** Kept in sync with the host entry without importing server-only code. */
const RPC_CHANNEL = "/api";
const RPC_METHOD = "agentDock";

type Section = "agents" | "engines" | "environments" | "projects" | "environmentPermissions" | "advanced";

interface Connection {
  rpc: { call(channel: string, method: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string; details?: unknown } }> };
}

interface DshClientContext {
  get(name: string): unknown;
  effect(callback: () => void | (() => void), name?: string): unknown;
  slots: {
    inject(slot: string, callback: () => unknown): unknown;
    register(slot: { name: string; id: string; order: number; label: () => string; inject: () => Record<string, unknown> }, component: unknown): unknown;
  };
}

interface Snapshot {
  config: Record<string, unknown>;
  revision: string;
  hash: string;
  configPath: string;
}

interface Preview {
  diff: Array<{ path: string; before: unknown; after: unknown }>;
  highRisk: { required: boolean; reasons: string[] };
  policyIssues: Array<{ path: string; message: string }>;
}

interface BackendCatalog {
  agents: Array<{ id: string; engineId: string; environmentId: string; enabled: boolean }>;
  projects: Array<{ id: string }>;
}

interface BackendBinding {
  dshSessionId: string;
  agentId: string;
  projectId?: string;
  agentDockSessionId?: string;
  updatedAt: string;
}

type UseSessions = (selector: (state: { current?: string }) => string | undefined) => string | undefined;
interface ManagerProps { call: RpcCall; useSessions: UseSessions }
type RpcCall = <T>(endpoint: string, payload: unknown) => Promise<T>;

/** DSH Web client entry. The Settings slot owns the UI; all writes go through the host's ConfigEditor. */
export const inject = ["slots", "connection"];

export function apply(ctx: DshClientContext): void {
  const connection = ctx.get("connection") as Connection;
  const call: RpcCall = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const result = await connection.rpc.call(RPC_CHANNEL, RPC_METHOD, { endpoint, payload });
    if (!result.ok) throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : "AgentDock request failed.");
    return result.value as T;
  };

  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.agentdockDsh = "true";
    style.textContent = STYLES;
    document.head.append(style);
    return () => style.remove();
  }, "agentdock-dsh: settings styles");

  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "agentdock",
    order: 28,
    label: () => "AgentDock",
    inject: () => ({ call }),
  }, AgentDockSettings));
}

function AgentDockSettings(props: ManagerProps): ReactNode {
  const currentSession = props.useSessions((state) => state.current);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Record<string, unknown>>();
  const [section, setSection] = useState<Section>("agents");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [backups, setBackups] = useState<Array<{ id: string; createdAt: string; size: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string }>();
  const [catalog, setCatalog] = useState<BackendCatalog>();
  const [binding, setBinding] = useState<BackendBinding | null>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const collection = section === "advanced" ? undefined : section;
  const activeValue = useMemo(() => {
    if (!draft) return undefined;
    return collection ? draft[collection] ?? [] : draft;
  }, [collection, draft]);

  const load = async (): Promise<void> => {
    setBusy(true); setNotice(undefined);
    try {
      const next = await props.call<Snapshot>("snapshot", {});
      setSnapshot(next); setDraft(clone(next.config)); setPreview(undefined);
      const result = await props.call<{ backups: Array<{ id: string; createdAt: string; size: number }> }>("backups", {});
      setBackups(result.backups);
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []); // The slot is remounted when its DSH profile changes.
  useEffect(() => {
    if (!currentSession) { setBinding(null); return; }
    let active = true;
    void (async (): Promise<void> => {
      try {
        const [nextCatalog, nextBinding] = await Promise.all([
          props.call<BackendCatalog>("backend/catalog", {}),
          props.call<{ binding: BackendBinding | null }>("backend/binding", { sessionId: currentSession }),
        ]);
        if (!active) return;
        setCatalog(nextCatalog); setBinding(nextBinding.binding);
        setSelectedAgentId(nextBinding.binding?.agentId ?? nextCatalog.agents.find((agent) => agent.enabled)?.id ?? "");
        setSelectedProjectId(nextBinding.binding?.projectId ?? "");
      } catch (error) {
        if (active) setNotice({ kind: "error", text: errorText(error) });
      }
    })();
    return () => { active = false; };
  }, [currentSession]);
  useEffect(() => { if (activeValue !== undefined) setText(JSON.stringify(activeValue, null, 2)); }, [activeValue, section]);

  const bindCurrentSession = async (): Promise<void> => {
    if (!currentSession || !selectedAgentId) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await props.call<{ binding: BackendBinding }>("backend/bind", {
        sessionId: currentSession, agentId: selectedAgentId,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
      });
      setBinding(result.binding);
      setNotice({ kind: "success", text: "Session bound. Its next turn will use the selected AgentDock agent." });
    } catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  };

  const unbindCurrentSession = async (): Promise<void> => {
    if (!currentSession || !window.confirm("Remove this session's AgentDock binding? Select another DSH model before sending its next turn.")) return;
    setBusy(true); setNotice(undefined);
    try {
      await props.call("backend/unbind", { sessionId: currentSession });
      setBinding(null);
      setNotice({ kind: "success", text: "Binding removed. Choose another model before sending the next turn." });
    } catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  };

  const commitText = (): Record<string, unknown> | undefined => {
    if (!draft) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (collection && !Array.isArray(parsed)) throw new Error(`${label(section)} must be a JSON array.`);
      if (!collection && (!isRecord(parsed) || Array.isArray(parsed))) throw new Error("The complete configuration must be a JSON object.");
      const next = collection ? { ...draft, [collection]: parsed } : parsed as Record<string, unknown>;
      setDraft(next); return next;
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) }); return undefined;
    }
  };

  const changeSection = (next: Section): void => {
    if (!commitText()) return;
    setSection(next); setPreview(undefined); setNotice(undefined);
  };

  const addItem = (): void => {
    const next = commitText();
    if (!next || !collection) return;
    const current = Array.isArray(next[collection]) ? next[collection] : [];
    setDraft({ ...next, [collection]: [...current, templateFor(collection)] });
    setPreview(undefined);
  };

  const makePreview = async (): Promise<void> => {
    const next = commitText();
    if (!next) return;
    setBusy(true); setNotice(undefined);
    try { setPreview(await props.call<Preview>("preview", { config: next })); }
    catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  };

  const save = async (): Promise<void> => {
    const next = commitText();
    if (!next || !snapshot) return;
    const currentPreview = preview ?? await props.call<Preview>("preview", { config: next });
    if (currentPreview.highRisk.required && !window.confirm(`This change expands AgentDock privileges:\n\n${currentPreview.highRisk.reasons.join("\n")}\n\nSave it?`)) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await props.call<{ current: Snapshot; restartRequired: boolean }>("save", {
        config: next, revision: snapshot.revision, hash: snapshot.hash, confirmHighRisk: currentPreview.highRisk.required,
      });
      setSnapshot({ ...result.current, configPath: snapshot.configPath });
      setDraft(clone(result.current.config)); setPreview(undefined);
      const items = await props.call<{ backups: Array<{ id: string; createdAt: string; size: number }> }>("backups", {});
      setBackups(items.backups);
      setNotice({ kind: "success", text: result.restartRequired ? "Saved safely. Restart the AgentDock API to apply runtime changes." : "Saved." });
    } catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  };

  const restore = async (backupId: string): Promise<void> => {
    if (!snapshot || !window.confirm("Restore this backup? It will replace the current AgentDock configuration.")) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await props.call<{ current: Snapshot }>("restore", {
        backupId, revision: snapshot.revision, hash: snapshot.hash, confirmHighRisk: true,
      });
      setSnapshot({ ...result.current, configPath: snapshot.configPath }); setDraft(clone(result.current.config)); setPreview(undefined);
      setNotice({ kind: "success", text: "Backup restored. Restart the AgentDock API to apply runtime changes." });
      const items = await props.call<{ backups: Array<{ id: string; createdAt: string; size: number }> }>("backups", {}); setBackups(items.backups);
    } catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  };

  if (!snapshot || !draft) return React.createElement("div", { className: "ad-dsh-loading" }, "Loading AgentDock configuration…");
  const counts: Array<[Section, number]> = [
    ["agents", listLength(draft.agents)], ["engines", listLength(draft.engines)], ["environments", listLength(draft.environments)],
    ["projects", listLength(draft.projects)], ["environmentPermissions", listLength(draft.environmentPermissions)],
  ];

  return React.createElement("section", { className: "ad-dsh", "data-testid": "agentdock-settings" },
    React.createElement("header", { className: "ad-dsh-header" },
      React.createElement("div", null, React.createElement("h2", null, "AgentDock control plane"),
        React.createElement("p", null, "Manage local multi-agent routes from DeepSeek Harness. Secrets stay as references; writes are validated, backed up, and atomic.")),
      React.createElement("button", { type: "button", onClick: () => void load(), disabled: busy }, "↻ Refresh")),
    React.createElement("p", { className: "ad-dsh-path" }, "Config: ", React.createElement("code", null, snapshot.configPath)),
    notice && React.createElement("div", { className: `ad-dsh-notice ${notice.kind}`, role: notice.kind === "error" ? "alert" : "status" }, notice.text),
    renderSessionBinding({ currentSession, catalog, binding, selectedAgentId, selectedProjectId, busy, setSelectedAgentId, setSelectedProjectId, bindCurrentSession, unbindCurrentSession }),
    React.createElement("div", { className: "ad-dsh-counts" }, counts.map(([key, count]) => React.createElement("button", {
      key, type: "button", className: section === key ? "active" : "", onClick: () => changeSection(key), disabled: busy,
    }, React.createElement("strong", null, count), React.createElement("span", null, label(key))))),
    React.createElement("div", { className: "ad-dsh-tabs", role: "tablist", "aria-label": "AgentDock configuration" },
      (["agents", "engines", "environments", "projects", "environmentPermissions", "advanced"] as Section[]).map((key) => React.createElement("button", {
        key, type: "button", role: "tab", "aria-selected": section === key, className: section === key ? "active" : "", onClick: () => changeSection(key), disabled: busy,
      }, key === "advanced" ? "Advanced JSON" : label(key)))),
    React.createElement("div", { className: "ad-dsh-editor-head" },
      React.createElement("div", null, React.createElement("h3", null, section === "advanced" ? "Complete configuration" : `${label(section)} catalog`),
        React.createElement("p", null, section === "advanced" ? "Use this only for global storage, logging, and redaction settings." : "Edit the selected catalog as a JSON array. IDs and cross-references are validated before save.")),
      collection && React.createElement("button", { type: "button", onClick: addItem, disabled: busy }, `+ Add ${singular(label(section))}`)),
    React.createElement("textarea", { value: text, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value), spellCheck: false, disabled: busy, "aria-label": `${label(section)} JSON editor` }),
    React.createElement("div", { className: "ad-dsh-actions" },
      React.createElement("button", { type: "button", onClick: () => { setDraft(clone(snapshot.config)); setPreview(undefined); setNotice(undefined); }, disabled: busy }, "Discard changes"),
      React.createElement("button", { type: "button", onClick: () => void makePreview(), disabled: busy }, "Preview"),
      React.createElement("button", { type: "button", className: "primary", onClick: () => void save(), disabled: busy }, busy ? "Working…" : "Save configuration")),
    preview && renderPreview(preview),
    React.createElement("section", { className: "ad-dsh-backups" }, React.createElement("h3", null, "Backups"),
      backups.length === 0 ? React.createElement("p", null, "No backups yet.") : backups.slice(0, 5).map((backup) => React.createElement("div", { key: backup.id, className: "ad-dsh-backup" },
        React.createElement("span", null, new Date(backup.createdAt).toLocaleString()), React.createElement("code", null, backup.id),
        React.createElement("button", { type: "button", onClick: () => void restore(backup.id), disabled: busy }, "Restore")))));
}

function renderSessionBinding(input: {
  currentSession: string | undefined;
  catalog: BackendCatalog | undefined;
  binding: BackendBinding | null | undefined;
  selectedAgentId: string;
  selectedProjectId: string;
  busy: boolean;
  setSelectedAgentId(value: string): void;
  setSelectedProjectId(value: string): void;
  bindCurrentSession(): Promise<void>;
  unbindCurrentSession(): Promise<void>;
}): ReactNode {
  if (!input.currentSession) return React.createElement("section", { className: "ad-dsh-binding" },
    React.createElement("h3", null, "Current DSH session"),
    React.createElement("p", null, "Open a DSH conversation, then return here to bind that session to an AgentDock agent."));
  if (!input.catalog) return React.createElement("section", { className: "ad-dsh-binding" },
    React.createElement("h3", null, "Current DSH session"), React.createElement("p", null, "Loading AgentDock agent catalog…"));
  const agents = input.catalog.agents.filter((agent) => agent.enabled);
  return React.createElement("section", { className: "ad-dsh-binding", "data-testid": "agentdock-session-binding" },
    React.createElement("div", { className: "ad-dsh-binding-head" },
      React.createElement("div", null, React.createElement("h3", null, "Current DSH session"),
        React.createElement("p", null, "Bind this conversation independently. AgentDock preserves its native Codex/Claude session behind the selected route.")),
      React.createElement("code", null, input.currentSession)),
    React.createElement("div", { className: "ad-dsh-binding-fields" },
      React.createElement("label", null, React.createElement("span", null, "AgentDock agent"),
        React.createElement("select", { value: input.selectedAgentId, disabled: input.busy || agents.length === 0, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => input.setSelectedAgentId(event.currentTarget.value) },
          agents.length === 0 && React.createElement("option", { value: "" }, "No enabled agents"),
          agents.map((agent) => React.createElement("option", { key: agent.id, value: agent.id }, `${agent.id} · ${agent.engineId}`)))),
      React.createElement("label", null, React.createElement("span", null, "Project (optional)"),
        React.createElement("select", { value: input.selectedProjectId, disabled: input.busy, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => input.setSelectedProjectId(event.currentTarget.value) },
          React.createElement("option", { value: "" }, "No project"),
          input.catalog.projects.map((project) => React.createElement("option", { key: project.id, value: project.id }, project.id)))),
      React.createElement("button", { type: "button", className: "primary", disabled: input.busy || !input.selectedAgentId, onClick: () => void input.bindCurrentSession() }, input.binding ? "Update binding" : "Bind session")),
    input.binding && React.createElement("footer", { className: "ad-dsh-binding-status" },
      React.createElement("span", null, "Bound to ", React.createElement("code", null, input.binding.agentId), input.binding.agentDockSessionId ? " · backend session ready" : " · backend session starts on the next turn"),
      React.createElement("button", { type: "button", disabled: input.busy, onClick: () => void input.unbindCurrentSession() }, "Unbind")));
}

function renderPreview(preview: Preview): ReactNode {
  return React.createElement("section", { className: "ad-dsh-preview" },
    React.createElement("h3", null, "Validation preview"),
    preview.highRisk.required && React.createElement("div", { className: "ad-dsh-risk" }, "High-risk: ", preview.highRisk.reasons.join(" · ")),
    preview.policyIssues.length > 0 && React.createElement("div", { className: "ad-dsh-error-list" }, preview.policyIssues.map((issue) => React.createElement("div", { key: `${issue.path}:${issue.message}` }, `${issue.path}: ${issue.message}`))),
    preview.diff.length === 0 ? React.createElement("p", null, "No configuration changes.") : React.createElement("ul", null, preview.diff.slice(0, 30).map((entry) => React.createElement("li", { key: entry.path }, React.createElement("code", null, entry.path)))),
    preview.diff.length > 30 && React.createElement("p", null, `…and ${preview.diff.length - 30} more changes.`));
}

function templateFor(section: Exclude<Section, "advanced">): Record<string, unknown> {
  switch (section) {
    case "agents": return { id: "new-agent", engineId: "", environmentId: "", permissionId: "", enabled: true, processEnv: {}, settings: {} };
    case "engines": return { id: "new-engine", adapter: "", args: [], enabled: true, capabilities: [] };
    case "environments": return { id: "new-environment", directoryMode: "managed", launchArgs: [], settings: {} };
    case "projects": return { id: "new-project", rootDir: "", agentIds: [], environmentIds: [] };
    case "environmentPermissions": return { id: "new-permission", filesystem: { roots: [], write: false }, environment: { allow: [] }, network: "deny" };
  }
}

function label(section: Section): string {
  return ({ agents: "Agents", engines: "Engines", environments: "Environments", projects: "Projects", environmentPermissions: "Permissions", advanced: "Advanced JSON" })[section];
}

function singular(value: string): string { return value === "Permissions" ? "permission" : value.slice(0, -1).toLowerCase(); }
function listLength(value: unknown): number { return Array.isArray(value) ? value.length : 0; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

const STYLES = `
.ad-dsh{max-width:1100px;color:var(--dsh-fg,#e8edf3)}.ad-dsh-header,.ad-dsh-binding-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.ad-dsh h2,.ad-dsh h3,.ad-dsh p{margin:0}.ad-dsh-header p,.ad-dsh-path,.ad-dsh-editor-head p,.ad-dsh-backups>p,.ad-dsh-binding p{margin-top:6px;color:var(--dsh-fg-muted,#97a4b5);font-size:13px}.ad-dsh button,.ad-dsh select{border:1px solid var(--dsh-border,rgba(148,163,184,.28));border-radius:8px;padding:7px 10px;background:var(--dsh-bg-raised,#202833);color:inherit;cursor:pointer}.ad-dsh button:hover,.ad-dsh button.active{border-color:#68d391;background:rgba(104,211,145,.12)}.ad-dsh button.primary{border-color:#68d391;background:#68d391;color:#102016;font-weight:700}.ad-dsh button:disabled,.ad-dsh select:disabled{opacity:.55;cursor:not-allowed}.ad-dsh-path{overflow-wrap:anywhere}.ad-dsh-notice{margin:15px 0;border:1px solid;border-radius:8px;padding:10px 12px;font-size:13px}.ad-dsh-notice.error,.ad-dsh-error-list{border-color:#fb7185;color:#fecdd3;background:rgba(251,113,133,.08)}.ad-dsh-notice.success{border-color:#68d391;color:#bbf7d0;background:rgba(104,211,145,.08)}.ad-dsh-binding{margin:18px 0;border:1px solid var(--dsh-border,rgba(148,163,184,.28));border-radius:10px;padding:14px}.ad-dsh-binding-head code{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ad-dsh-binding-fields{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,1fr) auto;gap:10px;align-items:end;margin-top:14px}.ad-dsh-binding label{display:grid;gap:6px;font-size:12px;color:var(--dsh-fg-muted,#97a4b5)}.ad-dsh-binding-status{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:13px;font-size:12px}.ad-dsh-counts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:18px 0}.ad-dsh-counts button{display:grid;gap:2px;text-align:left}.ad-dsh-counts strong{font-size:22px}.ad-dsh-counts span{color:var(--dsh-fg-muted,#97a4b5);font-size:12px}.ad-dsh-tabs,.ad-dsh-actions{display:flex;flex-wrap:wrap;gap:8px;margin:17px 0}.ad-dsh-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-top:20px}.ad-dsh textarea{width:100%;min-height:385px;margin-top:12px;border:1px solid var(--dsh-border,rgba(148,163,184,.28));border-radius:10px;padding:12px;background:var(--dsh-bg-input,#131922);color:inherit;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}.ad-dsh-preview,.ad-dsh-backups{margin-top:18px;border:1px solid var(--dsh-border,rgba(148,163,184,.28));border-radius:10px;padding:14px}.ad-dsh-preview ul{margin:10px 0 0;padding-left:20px}.ad-dsh-preview li{margin:3px 0}.ad-dsh-risk,.ad-dsh-error-list{margin-top:11px;border:1px solid #fbbf24;border-radius:8px;padding:9px;color:#fde68a;background:rgba(251,191,36,.08);font-size:13px}.ad-dsh-error-list{border-color:#fb7185;color:#fecdd3}.ad-dsh-backup{display:grid;grid-template-columns:minmax(160px,auto) 1fr auto;gap:10px;align-items:center;margin-top:10px;font-size:12px}.ad-dsh-backup code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:720px){.ad-dsh-header,.ad-dsh-editor-head,.ad-dsh-binding-head,.ad-dsh-binding-status{flex-direction:column}.ad-dsh-binding-fields{grid-template-columns:1fr}.ad-dsh-counts{grid-template-columns:repeat(2,minmax(0,1fr))}.ad-dsh-backup{grid-template-columns:1fr}.ad-dsh textarea{min-height:300px}}
`;
