import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Circle,
  Plus,
  RefreshCw,
  Square,
  Play,
  Trash2,
  X,
  Cpu,
  GitBranch,
  Radio,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

const STATUS_META = {
  running: { color: "#4CAF7D", label: "En ligne" },
  stopped: { color: "#5B6270", label: "Arrêté" },
  error: { color: "#E2574C", label: "Erreur" },
  deploying: { color: "#D9A441", label: "Déploiement" },
};

const emptyForm = {
  name: "",
  repo_url: "",
  branch: "main",
  start_command: "",
  port: "",
  autoupdate: true,
  env_vars: {},
};

export default function PiPaasDashboard() {
  const [apiBase, setApiBase] = useState("http://raspberrypi.local:8000");
  const [apiInput, setApiInput] = useState("http://raspberrypi.local:8000");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [logs, setLogs] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [envRows, setEnvRows] = useState([]);
  const [envSaved, setEnvSaved] = useState(true);
  const [showEnvValues, setShowEnvValues] = useState(false);
  const logsRef = useRef(null);

  const selected = projects.find((p) => p.id === selectedId) || null;

  const fetchProjects = useCallback(
    async (base) => {
      try {
        const res = await fetch(`${base}/projects`);
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        setProjects(data);
        setConnected(true);
        return data;
      } catch (e) {
        setConnected(false);
        return null;
      }
    },
    []
  );

  const fetchLogs = useCallback(
    async (base, id) => {
      try {
        const res = await fetch(`${base}/projects/${id}/logs?lines=200`);
        const text = await res.text();
        setLogs(text);
      } catch (e) {
        setLogs("Impossible de récupérer les logs.");
      }
    },
    []
  );

  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => fetchProjects(apiBase), 8000);
    return () => clearInterval(interval);
  }, [connected, apiBase, fetchProjects]);

  useEffect(() => {
    if (selected && connected) {
      fetchLogs(apiBase, selected.id);
      const interval = setInterval(() => fetchLogs(apiBase, selected.id), 5000);
      return () => clearInterval(interval);
    }
  }, [selected?.id, connected, apiBase, fetchLogs]);

  useEffect(() => {
    if (selected) {
      const rows = Object.entries(selected.env_vars || {}).map(([key, value]) => ({
        key,
        value,
      }));
      setEnvRows(rows);
      setEnvSaved(true);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  async function handleConnect() {
    setConnecting(true);
    const base = apiInput.replace(/\/$/, "");
    const data = await fetchProjects(base);
    setApiBase(base);
    if (data && data.length > 0 && !selectedId) {
      setSelectedId(data[0].id);
    }
    setConnecting(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError("");
    if (!form.name || !form.repo_url || !form.start_command || !form.port) {
      setFormError("Tous les champs sauf la branche sont requis.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, port: parseInt(form.port, 10) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Échec de la création");
      }
      const created = await res.json();
      await fetchProjects(apiBase);
      setSelectedId(created.id);
      setShowForm(false);
      setForm(emptyForm);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action) {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`${apiBase}/projects/${selected.id}/${action}`, { method: "POST" });
      await fetchProjects(apiBase);
      if (action === "deploy") await fetchLogs(apiBase, selected.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`${apiBase}/projects/${selected.id}`, { method: "DELETE" });
      setSelectedId(null);
      await fetchProjects(apiBase);
    } finally {
      setBusy(false);
    }
  }

  function updateEnvRow(index, field, value) {
    const next = [...envRows];
    next[index] = { ...next[index], [field]: value };
    setEnvRows(next);
    setEnvSaved(false);
  }

  function addEnvRow() {
    setEnvRows([...envRows, { key: "", value: "" }]);
    setEnvSaved(false);
  }

  function removeEnvRow(index) {
    setEnvRows(envRows.filter((_, i) => i !== index));
    setEnvSaved(false);
  }

  async function saveEnvVars() {
    if (!selected) return;
    const env_vars = {};
    envRows.forEach((row) => {
      if (row.key) env_vars[row.key] = row.value;
    });
    setBusy(true);
    try {
      await fetch(`${apiBase}/projects/${selected.id}/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env_vars }),
      });
      await fetchProjects(apiBase);
      setEnvSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.root}>
      <style>{FONT_IMPORT}</style>

      {/* Top bar */}
      <header style={styles.topbar}>
        <div style={styles.brand}>
          <Cpu size={18} color="#C7365F" strokeWidth={2.2} />
          <span style={styles.brandText}>Pi PaaS</span>
        </div>

        <div style={styles.connectRow}>
          <Radio size={13} color={connected ? "#4CAF7D" : "#5B6270"} />
          <input
            style={styles.apiInput}
            value={apiInput}
            onChange={(e) => setApiInput(e.target.value)}
            placeholder="http://raspberrypi.local:8000"
            spellCheck={false}
          />
          <button style={styles.connectBtn} onClick={handleConnect} disabled={connecting}>
            {connecting ? "..." : connected ? "Reconnecter" : "Connecter"}
          </button>
        </div>
      </header>

      <div style={styles.body}>
        {/* Sidebar */}
        <aside style={styles.sidebar}>
          <div style={styles.sidebarHead}>
            <span style={styles.sidebarTitle}>Projets</span>
            <button
              style={styles.iconBtn}
              onClick={() => {
                setShowForm(true);
                setFormError("");
              }}
              title="Ajouter un projet"
            >
              <Plus size={16} />
            </button>
          </div>

          {!connected && (
            <div style={styles.sidebarEmpty}>
              Connecte-toi à ton Pi pour voir tes projets.
            </div>
          )}

          {connected && projects.length === 0 && (
            <div style={styles.sidebarEmpty}>
              Aucun projet pour l'instant. Ajoute ton premier dépôt.
            </div>
          )}

          <div style={styles.projectList}>
            {projects.map((p) => {
              const meta = STATUS_META[p.status] || STATUS_META.stopped;
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    ...styles.projectRow,
                    ...(isSelected ? styles.projectRowActive : {}),
                  }}
                >
                  <Circle size={8} fill={meta.color} color={meta.color} />
                  <span style={styles.projectRowName}>{p.name}</span>
                  <ChevronRight size={14} color="#5B6270" />
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main panel */}
        <main style={styles.main}>
          {!selected && (
            <div style={styles.mainEmpty}>
              <Cpu size={32} color="#3A4049" strokeWidth={1.5} />
              <p style={styles.mainEmptyText}>
                {connected
                  ? "Sélectionne un projet pour voir son détail."
                  : "Renseigne l'adresse de ton Pi ci-dessus, puis connecte-toi."}
              </p>
            </div>
          )}

          {selected && (
            <>
              <div style={styles.detailHead}>
                <div>
                  <h1 style={styles.detailTitle}>{selected.name}</h1>
                  <div style={styles.detailMetaRow}>
                    <GitBranch size={13} color="#8B929E" />
                    <span style={styles.metaText}>{selected.branch}</span>
                    <span style={styles.metaDot}>·</span>
                    <span style={styles.metaText}>port {selected.port}</span>
                    <span style={styles.metaDot}>·</span>
                    <span style={styles.metaMono}>
                      {selected.last_commit ? selected.last_commit.slice(0, 7) : "pas encore déployé"}
                    </span>
                  </div>
                </div>
                <div style={styles.statusPill(STATUS_META[selected.status]?.color)}>
                  <Circle size={7} fill={STATUS_META[selected.status]?.color} color={STATUS_META[selected.status]?.color} />
                  {STATUS_META[selected.status]?.label || selected.status}
                </div>
              </div>

              <div style={styles.actionsRow}>
                <button
                  style={styles.actionBtnPrimary}
                  onClick={() => handleAction("deploy")}
                  disabled={busy}
                >
                  <RefreshCw size={14} /> Déployer
                </button>
                <button
                  style={styles.actionBtn}
                  onClick={() => handleAction("stop")}
                  disabled={busy || selected.status === "stopped"}
                >
                  <Square size={14} /> Arrêter
                </button>
                <button style={styles.actionBtnDanger} onClick={handleDelete} disabled={busy}>
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>

              <div style={styles.section}>
                <div style={styles.sectionLabel}>Dépôt</div>
                <div style={styles.repoLine}>{selected.repo_url}</div>
              </div>

              <div style={styles.section}>
                <div style={styles.sectionLabel}>Commande de démarrage</div>
                <div style={styles.commandLine}>{selected.start_command}</div>
              </div>

              <div style={styles.section}>
                <div style={styles.logsHead}>
                  <span style={styles.sectionLabel}>Variables d'environnement</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={styles.iconBtn}
                      onClick={() => setShowEnvValues(!showEnvValues)}
                      title={showEnvValues ? "Masquer les valeurs" : "Afficher les valeurs"}
                    >
                      {showEnvValues ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button style={styles.iconBtn} onClick={addEnvRow} title="Ajouter une variable">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>

                {envRows.length === 0 && (
                  <div style={styles.sidebarEmpty}>Aucune variable définie.</div>
                )}

                <div style={styles.envList}>
                  {envRows.map((row, i) => (
                    <div key={i} style={styles.envRow}>
                      <input
                        style={styles.envKeyInput}
                        value={row.key}
                        onChange={(e) => updateEnvRow(i, "key", e.target.value)}
                        placeholder="CLE"
                        spellCheck={false}
                      />
                      <input
                        style={styles.envValueInput}
                        type={showEnvValues ? "text" : "password"}
                        value={row.value}
                        onChange={(e) => updateEnvRow(i, "value", e.target.value)}
                        placeholder="valeur"
                        spellCheck={false}
                      />
                      <button
                        style={styles.iconBtn}
                        onClick={() => removeEnvRow(i)}
                        title="Supprimer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {envRows.length > 0 && (
                  <button
                    style={{
                      ...styles.envSaveBtn,
                      opacity: envSaved ? 0.5 : 1,
                      cursor: envSaved ? "default" : "pointer",
                    }}
                    onClick={saveEnvVars}
                    disabled={envSaved || busy}
                  >
                    {envSaved ? "Enregistré" : "Enregistrer les variables"}
                  </button>
                )}
              </div>

              <div style={styles.section}>
                <div style={styles.logsHead}>
                  <span style={styles.sectionLabel}>Logs</span>
                  <button
                    style={styles.iconBtn}
                    onClick={() => fetchLogs(apiBase, selected.id)}
                    title="Rafraîchir les logs"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div ref={logsRef} style={styles.logsBox}>
                  {logs || "Pas de logs pour l'instant."}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* New project modal */}
      {showForm && (
        <div style={styles.modalOverlay} onClick={() => setShowForm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHead}>
              <span style={styles.modalTitle}>Nouveau projet</span>
              <button style={styles.iconBtn} onClick={() => setShowForm(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} style={styles.formGrid}>
              <label style={styles.label}>
                Nom
                <input
                  style={styles.input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="mon-site"
                />
              </label>

              <label style={styles.label}>
                URL du dépôt GitHub
                <input
                  style={styles.input}
                  value={form.repo_url}
                  onChange={(e) => setForm({ ...form, repo_url: e.target.value })}
                  placeholder="https://github.com/user/repo.git"
                />
              </label>

              <div style={styles.formRow}>
                <label style={{ ...styles.label, flex: 1 }}>
                  Branche
                  <input
                    style={styles.input}
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  />
                </label>
                <label style={{ ...styles.label, flex: 1 }}>
                  Port
                  <input
                    style={styles.input}
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    placeholder="8001"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <label style={styles.label}>
                Commande de démarrage
                <input
                  style={styles.input}
                  value={form.start_command}
                  onChange={(e) => setForm({ ...form, start_command: e.target.value })}
                  placeholder="python3 main.py"
                />
              </label>

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.autoupdate}
                  onChange={(e) => setForm({ ...form, autoupdate: e.target.checked })}
                />
                Redéployer automatiquement sur chaque push
              </label>

              {formError && <div style={styles.formError}>{formError}</div>}

              <button type="submit" style={styles.submitBtn} disabled={busy}>
                <Play size={14} /> Cloner et ajouter
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    fontFamily: "'Space Grotesk', sans-serif",
    background: "#14171C",
    color: "#ECEEF1",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    fontSize: 14,
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    borderBottom: "1px solid #23272F",
    gap: 16,
    flexWrap: "wrap",
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" },
  connectRow: { display: "flex", alignItems: "center", gap: 8 },
  apiInput: {
    background: "#1C2027",
    border: "1px solid #2A2F38",
    color: "#ECEEF1",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 12.5,
    fontFamily: "'IBM Plex Mono', monospace",
    width: 240,
    outline: "none",
  },
  connectBtn: {
    background: "#C7365F",
    border: "none",
    color: "#fff",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  body: { display: "flex", flex: 1, minHeight: 0 },
  sidebar: {
    width: 240,
    borderRight: "1px solid #23272F",
    display: "flex",
    flexDirection: "column",
    padding: "14px 10px",
    flexShrink: 0,
  },
  sidebarHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 6px 10px 6px",
  },
  sidebarTitle: { fontSize: 11.5, color: "#8B929E", letterSpacing: "0.02em" },
  sidebarEmpty: {
    color: "#5B6270",
    fontSize: 12.5,
    padding: "8px 6px",
    lineHeight: 1.5,
  },
  projectList: { display: "flex", flexDirection: "column", gap: 2 },
  projectRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 8px",
    borderRadius: 5,
    border: "none",
    background: "transparent",
    color: "#ECEEF1",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    textAlign: "left",
  },
  projectRowActive: { background: "#1F232B" },
  projectRowName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  main: { flex: 1, padding: "22px 28px", overflowY: "auto", minWidth: 0 },
  mainEmpty: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    color: "#5B6270",
  },
  mainEmptyText: { fontSize: 13, maxWidth: 280, textAlign: "center", lineHeight: 1.5 },
  detailHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
    gap: 12,
    flexWrap: "wrap",
  },
  detailTitle: { fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" },
  detailMetaRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 6 },
  metaText: { fontSize: 12.5, color: "#8B929E" },
  metaMono: { fontSize: 12, color: "#8B929E", fontFamily: "'IBM Plex Mono', monospace" },
  metaDot: { color: "#3A4049" },
  statusPill: (color) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 20,
    border: `1px solid ${color}33`,
    background: `${color}14`,
    color: color,
    fontSize: 12,
    fontWeight: 500,
  }),
  actionsRow: { display: "flex", gap: 8, marginBottom: 24 },
  actionBtnPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#C7365F",
    border: "none",
    color: "#fff",
    borderRadius: 5,
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  actionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#1C2027",
    border: "1px solid #2A2F38",
    color: "#ECEEF1",
    borderRadius: 5,
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  actionBtnDanger: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #2A2F38",
    color: "#E2574C",
    borderRadius: 5,
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    marginLeft: "auto",
  },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 11.5, color: "#8B929E", marginBottom: 7, letterSpacing: "0.02em" },
  repoLine: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    color: "#C7365F",
    wordBreak: "break-all",
  },
  commandLine: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    background: "#1C2027",
    border: "1px solid #2A2F38",
    borderRadius: 5,
    padding: "8px 10px",
    color: "#ECEEF1",
    display: "inline-block",
  },
  logsHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  envList: { display: "flex", flexDirection: "column", gap: 6 },
  envRow: { display: "flex", gap: 6, alignItems: "center" },
  envKeyInput: {
    background: "#1C2027",
    border: "1px solid #2A2F38",
    color: "#C7365F",
    borderRadius: 5,
    padding: "7px 9px",
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    outline: "none",
    width: 160,
    flexShrink: 0,
  },
  envValueInput: {
    background: "#1C2027",
    border: "1px solid #2A2F38",
    color: "#ECEEF1",
    borderRadius: 5,
    padding: "7px 9px",
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    outline: "none",
    flex: 1,
    minWidth: 0,
  },
  envSaveBtn: {
    marginTop: 10,
    background: "#1C2027",
    border: "1px solid #2A2F38",
    color: "#ECEEF1",
    borderRadius: 5,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "inherit",
  },
  logsBox: {
    background: "#0F1114",
    border: "1px solid #23272F",
    borderRadius: 6,
    padding: 14,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color: "#B8BFC9",
    whiteSpace: "pre-wrap",
    height: 260,
    overflowY: "auto",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#8B929E",
    cursor: "pointer",
    padding: 5,
    display: "flex",
    alignItems: "center",
    borderRadius: 4,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,11,13,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "#1A1D23",
    border: "1px solid #2A2F38",
    borderRadius: 8,
    width: 380,
    maxWidth: "90vw",
    padding: 18,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 15, fontWeight: 600 },
  formGrid: { display: "flex", flexDirection: "column", gap: 12 },
  formRow: { display: "flex", gap: 10 },
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#8B929E" },
  input: {
    background: "#14171C",
    border: "1px solid #2A2F38",
    color: "#ECEEF1",
    borderRadius: 5,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
    outline: "none",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "#B8BFC9",
  },
  formError: { color: "#E2574C", fontSize: 12 },
  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "#C7365F",
    border: "none",
    color: "#fff",
    borderRadius: 5,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 4,
  },
};
