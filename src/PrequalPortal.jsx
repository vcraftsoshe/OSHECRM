import React, { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { Check, Upload, X, FileText } from "lucide-react";

const T = {
  charcoal: "#1A2C2E", teal: "#13DCCC", tealDark: "#0AADA0",
  paper: "#F5F8F7", paperAlt: "#EBF2F0", card: "#FFFFFF",
  ink: "#152423", slate: "#5C7274", slateLight: "#8CA1A2", border: "#DCE6E4",
  coral: "#C25B4E", amber: "#D99A3D",
};
const inputStyle = { border: `1px solid ${T.border}`, color: T.ink, background: "#fff" };
const inputClass = "w-full text-sm px-3 py-2.5 rounded-lg outline-none";
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const STORE_KEY = "oshe-prequal-code";

function readStored() { try { return localStorage.getItem(STORE_KEY) || ""; } catch (e) { return ""; } }
function writeStored(v) { try { if (v) localStorage.setItem(STORE_KEY, v); else localStorage.removeItem(STORE_KEY); } catch (e) { /* storage blocked */ } }
function messageOf(err, fallback) {
  return err && err.message && err.code !== "functions/internal" ? err.message : fallback;
}
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Shell({ children, title }) {
  return (
    <div className="min-h-screen" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <img src="/logo-full.png" alt="OSHE" style={{ height: 80, width: "auto" }} />
          <div className="text-2xl font-bold mt-4" style={{ color: T.ink }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Start({ onStarted }) {
  const [schemes, setSchemes] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [schemeId, setSchemeId] = useState(null);
  const [form, setForm] = useState({ company: "", contactName: "", email: "", hp_ref: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    call("getPrequalSchemes").then((r) => setSchemes(r.schemes || [])).catch((err) => { console.error("Couldn't load pre-quals:", err); setLoadError(true); });
  }, []);

  const valid = schemeId && form.company.trim() && form.contactName.trim() && /^\S+@\S+\.\S+$/.test(form.email.trim());
  const start = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call("startPrequal", { schemeId, ...form });
      if (r.code) onStarted(r.code);
    } catch (err) {
      console.error("Start pre-qual failed:", err);
      setError(messageOf(err, "Something went wrong. Please try again, or contact OSHE directly if it keeps happening."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Pre-qualification">
      {schemes === null && !loadError && <div className="text-sm" style={{ color: T.slateLight }}>Loading…</div>}
      {loadError && <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>Couldn't load the pre-quals. Please refresh the page.</div>}
      {schemes && schemes.length === 0 && <div className="rounded-xl p-8 text-center text-sm" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.slate }}>No pre-quals are available right now.</div>}
      <div className="flex flex-col gap-3">
        {(schemes || []).map((s) => {
          const sel = s.id === schemeId;
          return (
            <button key={s.id} type="button" onClick={() => setSchemeId(sel ? null : s.id)} className="text-left rounded-xl p-5"
              style={{ background: T.card, border: `2px solid ${sel ? T.tealDark : T.border}` }}>
              <div className="text-base font-bold" style={{ color: T.ink }}>{s.name}</div>
              {s.description && <div className="text-sm mt-1" style={{ color: T.slate }}>{s.description}</div>}
            </button>
          );
        })}
      </div>
      {schemeId && (
        <div className="rounded-xl p-6 flex flex-col gap-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <input placeholder="Company" className={inputClass} style={inputStyle} value={form.company} onChange={(e) => set("company", e.target.value)} />
          <input placeholder="Your name" className={inputClass} style={inputStyle} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          <input type="email" placeholder="Email" className={inputClass} style={inputStyle} value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.hp_ref} onChange={(e) => set("hp_ref", e.target.value)} style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }} />
          {error && <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{error}</div>}
          <button onClick={start} disabled={!valid || busy} className="text-sm font-semibold px-5 py-3 rounded-lg" style={{ background: valid ? T.tealDark : T.slateLight, color: "#fff", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      )}
    </Shell>
  );
}

function Form({ code, onLeave }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [fileFlags, setFileFlags] = useState({});
  const [files, setFiles] = useState({});
  const [saveState, setSaveState] = useState("saved");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const timer = useRef(null);
  const latest = useRef({});

  useEffect(() => {
    call("getPrequal", { code })
      .then((d) => {
        setData(d);
        setAnswers(d.answers || {});
        setFiles(d.files || {});
        setFileFlags(Object.fromEntries(Object.entries(d.files || {}).map(([k, v]) => [k, Boolean(v.inApp)])));
      })
      .catch((err) => { console.error("Couldn't load pre-qual:", err); setLoadError(messageOf(err, "Couldn't load this pre-qual.")); });
  }, [code]);

  latest.current = { answers, fileFlags };
  const persist = async (submit) => {
    const { answers: a, fileFlags: f } = latest.current;
    return call("savePrequal", { code, answers: a, fileFlags: f, submit: Boolean(submit) });
  };
  const queueSave = () => {
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await persist(false); setSaveState("saved"); }
      catch (err) { console.error("Save failed:", err); setSaveState("error"); }
    }, 900);
  };
  const setAnswer = (id, patch) => { setAnswers((prev) => ({ ...prev, [id]: { value: "", inApp: false, ...(prev[id] || {}), ...patch } })); queueSave(); };
  const setFlag = (id, v) => { setFileFlags((prev) => ({ ...prev, [id]: v })); queueSave(); };

  const upload = async (u, fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    setError(null);
    setUploadingId(u.id);
    try {
      for (const file of picked) {
        if (file.size > 7 * 1024 * 1024) { setError(`${file.name} is over 7MB. For larger files, email them to OSHE.`); continue; }
        const r = await call("uploadPrequalFile", { code, uploadId: u.id, name: file.name, contentType: file.type, data: await readBase64(file) });
        setFiles((prev) => ({ ...prev, [u.id]: r.files }));
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setError(messageOf(err, "That file didn't upload. Please try again."));
    } finally {
      setUploadingId(null);
    }
  };
  const removeFile = async (u, f) => {
    try {
      const r = await call("removePrequalFile", { code, uploadId: u.id, fileId: f.id });
      setFiles((prev) => ({ ...prev, [u.id]: r.files }));
    } catch (err) { console.error("Remove failed:", err); setError("Couldn't remove that file."); }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      clearTimeout(timer.current);
      const r = await persist(true);
      setData((d) => ({ ...d, status: r.status }));
      setSaveState("saved");
    } catch (err) {
      console.error("Submit failed:", err);
      setError(messageOf(err, "Something went wrong submitting. Your answers are saved, please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <Shell title="Pre-qualification">
        <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{loadError}</div>
        <button onClick={onLeave} className="text-sm font-semibold self-start" style={{ color: T.tealDark }}>Start a new pre-qual</button>
      </Shell>
    );
  }
  if (!data) return <Shell title="Pre-qualification"><div className="text-sm" style={{ color: T.slateLight }}>Loading…</div></Shell>;

  const items = [
    ...data.questions.map((q) => ({ done: Boolean(answers[q.id]?.inApp || String(answers[q.id]?.value || "").trim()) })),
    ...data.uploads.filter((u) => u.required).map((u) => ({ done: Boolean(fileFlags[u.id] || (files[u.id]?.items || []).length) })),
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 100;
  const submitted = data.status === "submitted";

  return (
    <Shell title={data.schemeName}>
      <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: T.slate }}>{data.company}</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: saveState === "error" ? T.coral : T.slateLight }}>
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : (<><Check size={13} /> Saved</>)}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: T.paperAlt }}>
          <div style={{ width: `${pct}%`, height: "100%", background: T.tealDark, transition: "width .3s" }} />
        </div>
        <div className="text-xs font-semibold" style={{ color: T.slate }}>{doneCount} of {items.length} complete</div>
      </div>

      {submitted && (
        <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: "#E4F8F5", border: `1px solid ${T.tealDark}` }}>
          <Check size={20} color={T.tealDark} />
          <div className="text-sm font-semibold" style={{ color: T.ink }}>Submitted. A confirmation has been sent to {data.email}.</div>
        </div>
      )}

      {data.questions.length > 0 && (
        <div className="rounded-xl p-6 flex flex-col gap-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <div className="text-sm font-bold uppercase tracking-wide" style={{ color: T.slate }}>Questions</div>
          {data.questions.map((q, i) => {
            const a = answers[q.id] || { value: "", inApp: false };
            return (
              <div key={q.id} className="flex flex-col gap-2">
                <div className="text-sm font-semibold" style={{ color: T.ink }}>{i + 1}. {q.text}</div>
                {q.kind === "yesno" ? (
                  <div className="flex gap-2">
                    {["Yes", "No"].map((o) => (
                      <button key={o} type="button" disabled={a.inApp} onClick={() => setAnswer(q.id, { value: a.value === o ? "" : o })} className="text-sm font-semibold px-5 py-2 rounded-lg"
                        style={{ background: a.value === o ? T.tealDark : T.paperAlt, color: a.value === o ? "#fff" : T.slate, opacity: a.inApp ? 0.5 : 1 }}>{o}</button>
                    ))}
                  </div>
                ) : q.kind === "longtext" ? (
                  <textarea rows={4} disabled={a.inApp} className={inputClass} style={{ ...inputStyle, resize: "vertical", opacity: a.inApp ? 0.5 : 1 }} value={a.value} onChange={(e) => setAnswer(q.id, { value: e.target.value })} />
                ) : (
                  <input disabled={a.inApp} className={inputClass} style={{ ...inputStyle, opacity: a.inApp ? 0.5 : 1 }} value={a.value} onChange={(e) => setAnswer(q.id, { value: e.target.value })} />
                )}
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: T.slate }}>
                  <input type="checkbox" checked={Boolean(a.inApp)} onChange={(e) => setAnswer(q.id, { inApp: e.target.checked })} />
                  Completed in the app
                </label>
              </div>
            );
          })}
        </div>
      )}

      {data.uploads.length > 0 && (
        <div className="rounded-xl p-6 flex flex-col gap-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <div className="text-sm font-bold uppercase tracking-wide" style={{ color: T.slate }}>Documents</div>
          {data.uploads.map((u) => {
            const f = files[u.id] || { items: [] };
            const flagged = Boolean(fileFlags[u.id]);
            return (
              <div key={u.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold" style={{ color: T.ink }}>{u.label}</div>
                  {u.required && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#FBF1E3", color: T.amber }}>Required</span>}
                </div>
                {(f.items || []).map((file) => (
                  <div key={file.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: T.paperAlt }}>
                    <span className="flex items-center gap-2 min-w-0" style={{ color: T.ink }}><FileText size={14} color={T.tealDark} /><span className="truncate">{file.name}</span></span>
                    <button type="button" onClick={() => removeFile(u, file)} title="Remove"><X size={14} color={T.slateLight} /></button>
                  </div>
                ))}
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer" style={{ background: T.paperAlt, color: T.tealDark, opacity: flagged ? 0.5 : 1 }}>
                    <Upload size={14} /> {uploadingId === u.id ? "Uploading…" : "Upload"}
                    <input type="file" multiple className="hidden" disabled={flagged || uploadingId === u.id} onChange={(e) => { upload(u, e.target.files); e.target.value = ""; }} />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: T.slate }}>
                    <input type="checkbox" checked={flagged} onChange={(e) => setFlag(u.id, e.target.checked)} />
                    Completed in the app
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{error}</div>}
      <button onClick={submit} disabled={submitting} className="text-sm font-semibold px-5 py-3 rounded-lg" style={{ background: T.tealDark, color: "#fff", opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Submitting…" : submitted ? "Submit again" : "Submit"}
      </button>
    </Shell>
  );
}

export default function PrequalPortal() {
  const initial = (() => {
    try { return new URLSearchParams(window.location.search).get("c") || readStored(); } catch (e) { return readStored(); }
  })();
  const [code, setCode] = useState(initial);
  const begin = (c) => {
    writeStored(c);
    setCode(c);
    try { window.history.replaceState(null, "", `/?c=${c}`); } catch (e) { /* ignore */ }
  };
  const leave = () => {
    writeStored("");
    setCode("");
    try { window.history.replaceState(null, "", "/"); } catch (e) { /* ignore */ }
  };
  return code ? <Form code={code} onLeave={leave} /> : <Start onStarted={begin} />;
}
