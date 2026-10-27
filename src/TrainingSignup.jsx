import React, { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { Check, Calendar, Clock, Video, MapPin } from "lucide-react";

const T = {
  charcoal: "#1A2C2E", teal: "#13DCCC", tealDark: "#0AADA0",
  paper: "#F5F8F7", paperAlt: "#EBF2F0", card: "#FFFFFF",
  ink: "#152423", slate: "#5C7274", slateLight: "#8CA1A2", border: "#DCE6E4",
  coral: "#C25B4E",
};

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const inputStyle = { border: `1px solid ${T.border}`, color: T.ink, background: "#fff" };
const inputClass = "w-full text-sm px-3 py-2.5 rounded-lg outline-none";

export default function TrainingSignup() {
  const [sessions, setSessions] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ company: "", name: "", email: "", hp_ref: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    httpsCallable(functions, "getTrainingSessions")()
      .then((res) => setSessions(res.data.sessions || []))
      .catch((err) => { console.error("Couldn't load training sessions:", err); setLoadError(true); });
  }, []);

  const selected = (sessions || []).find((s) => s.id === selectedId);
  const valid = selected && form.company.trim() && form.name.trim() && /^\S+@\S+\.\S+$/.test(form.email.trim());

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await httpsCallable(functions, "signupForTraining")({ sessionId: selected.id, ...form });
      setDone(selected);
    } catch (err) {
      console.error("Training sign-up failed:", err);
      setError(err && err.message && err.code !== "functions/internal" ? err.message : "Something went wrong signing you up. Please try again, or contact OSHE directly if it keeps happening.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div className="text-center max-w-md p-8">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: T.paperAlt }}>
            <Check size={28} color={T.tealDark} />
          </div>
          <div className="text-xl font-bold mb-2" style={{ color: T.ink }}>You're signed up, {form.name.split(" ")[0] || "there"}!</div>
          <div className="text-sm" style={{ color: T.slate }}>{done.title}</div>
          <div className="text-sm" style={{ color: T.slate }}>{fmtDate(done.date)}, {fmtTime(done.time)}</div>
          <div className="text-sm mt-3" style={{ color: T.slate }}>A confirmation has been sent to {form.email}.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <img src="/logo-full.png" alt="OSHE" style={{ height: 80, width: "auto" }} />
          <div className="text-2xl font-bold mt-4" style={{ color: T.ink }}>Training Sessions</div>
        </div>

        {sessions === null && !loadError && <div className="text-sm" style={{ color: T.slateLight }}>Loading…</div>}
        {loadError && <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>Couldn't load the sessions. Please refresh the page.</div>}
        {sessions && sessions.length === 0 && (
          <div className="rounded-xl p-8 text-center text-sm" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.slate }}>No sessions are scheduled right now.</div>
        )}

        <div className="flex flex-col gap-3">
          {(sessions || []).map((s) => {
            const full = s.spotsLeft !== null && s.spotsLeft <= 0;
            const isSel = s.id === selectedId;
            return (
              <button key={s.id} type="button" disabled={full} onClick={() => setSelectedId(isSel ? null : s.id)}
                className="text-left rounded-xl p-5 flex flex-col gap-2"
                style={{ background: T.card, border: `2px solid ${isSel ? T.tealDark : T.border}`, opacity: full ? 0.55 : 1, cursor: full ? "not-allowed" : "pointer" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-base font-bold" style={{ color: T.ink }}>{s.title}</div>
                  {full ? (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md shrink-0" style={{ background: T.paperAlt, color: T.slate }}>Full</span>
                  ) : s.spotsLeft !== null ? (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md shrink-0" style={{ background: T.paperAlt, color: T.tealDark }}>{s.spotsLeft} spot{s.spotsLeft === 1 ? "" : "s"} left</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: T.slate }}>
                  <span className="flex items-center gap-1.5"><Calendar size={14} /> {fmtDate(s.date)}</span>
                  <span className="flex items-center gap-1.5"><Clock size={14} /> {fmtTime(s.time)}{s.durationMins ? `, ${s.durationMins} min` : ""} (NZ time)</span>
                  <span className="flex items-center gap-1.5">{s.platform === "In person" ? <MapPin size={14} /> : <Video size={14} />} {s.platform}{s.platform === "In person" && s.venue ? `, ${s.venue}` : ""}</span>
                </div>
                {s.description && <div className="text-sm" style={{ color: T.ink }}>{s.description}</div>}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="rounded-xl p-6 flex flex-col gap-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
            <div className="text-sm font-semibold" style={{ color: T.ink }}>Sign up for {selected.title}</div>
            {[["company", "Company", "text"], ["name", "Your name", "text"], ["email", "Email", "email"]].map(([k, label, type]) => (
              <label key={k} className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>{label} *</span>
                <input type={type} className={inputClass} style={inputStyle} value={form[k]} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
            <input tabIndex={-1} autoComplete="off" value={form.hp_ref} onChange={(e) => set("hp_ref", e.target.value)} style={{ position: "absolute", left: "-9999px", opacity: 0 }} aria-hidden="true" />
            {error && <div className="text-sm rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{error}</div>}
            <button disabled={!valid || submitting} onClick={submit} className="text-sm font-semibold px-6 py-3 rounded-lg self-end"
              style={{ background: valid && !submitting ? T.tealDark : T.slateLight, color: "#fff", cursor: valid && !submitting ? "pointer" : "not-allowed" }}>
              {submitting ? "Signing up…" : "Sign up"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
