import React, { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { Check } from "lucide-react";

const T = {
  charcoal: "#1A2C2E", teal: "#13DCCC", tealDark: "#0AADA0",
  paper: "#F5F8F7", paperAlt: "#EBF2F0", card: "#FFFFFF",
  ink: "#152423", slate: "#5C7274", slateLight: "#8CA1A2", border: "#DCE6E4",
  coral: "#C25B4E",
};

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "bimonthly", label: "Bimonthly" },
  { value: "quarterly", label: "Quarterly" },
];

function Field({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>{label}{required ? " *" : ""}</span>
      {children}
    </label>
  );
}

const inputStyle = { border: `1px solid ${T.border}`, color: T.ink, background: "#fff" };
const inputClass = "w-full text-sm px-3 py-2.5 rounded-lg outline-none";

export default function SiteReviewForm() {
  const [form, setForm] = useState({
    company: "", address: "", contactName: "", email: "", phone: "",
    frequency: "", inductionRequired: "", inductionDetails: "", onApp: "",
    siteStart: "", siteEnd: "", startMonth: "", website: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const valid = form.company.trim() && form.address.trim() && form.contactName.trim() && form.email.trim() && form.phone.trim()
    && form.frequency && form.onApp && form.startMonth;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "submitSiteReview");
      await fn(form);
      setSubmitted(true);
    } catch (err) {
      console.error("Site review request failed:", err);
      setError("Something went wrong sending this. Please try again, or contact OSHE directly if it keeps happening.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div className="text-center max-w-md p-8">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: T.paperAlt }}>
            <Check size={28} color={T.tealDark} />
          </div>
          <div className="text-xl font-bold mb-2" style={{ color: T.ink }}>Thanks, {form.contactName.split(" ")[0] || "there"}!</div>
          <div className="text-sm" style={{ color: T.slate }}>Your site review request has been sent to the OSHE team.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <img src="/logo-full.png" alt="OSHE" style={{ height: 40, width: "auto" }} />
          <div className="text-2xl font-bold mt-4" style={{ color: T.ink }}>Site Review Request</div>
        </div>

        <div className="rounded-xl p-6 flex flex-col gap-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <Field label="Client name" required>
            <input className={inputClass} style={inputStyle} value={form.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field label="Site address" required>
            <input className={inputClass} style={inputStyle} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Contact name" required>
              <input className={inputClass} style={inputStyle} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
            </Field>
            <Field label="Phone" required>
              <input type="tel" className={inputClass} style={inputStyle} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </div>
          <Field label="Email" required>
            <input type="email" className={inputClass} style={inputStyle} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>

        <div className="rounded-xl p-6 flex flex-col gap-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
          <Field label="How often would you like site reviews" required>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <button key={f.value} type="button" onClick={() => set("frequency", f.value)} className="text-sm font-semibold px-4 py-2 rounded-lg"
                  style={{ background: form.frequency === f.value ? T.tealDark : T.paperAlt, color: form.frequency === f.value ? "#fff" : T.slate }}>
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Requested start month" required>
            <input type="month" className={inputClass} style={inputStyle} value={form.startMonth} onChange={(e) => set("startMonth", e.target.value)} />
          </Field>
          <Field label="Is the site on the OSHE app" required>
            <div className="flex gap-2">
              {["Yes", "No", "Not sure"].map((o) => (
                <button key={o} type="button" onClick={() => set("onApp", o)} className="text-sm font-semibold px-4 py-2 rounded-lg"
                  style={{ background: form.onApp === o ? T.tealDark : T.paperAlt, color: form.onApp === o ? "#fff" : T.slate }}>
                  {o}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Induction requirements">
            <textarea rows={3} className={inputClass + " resize-y"} style={inputStyle} value={form.inductionDetails} onChange={(e) => set("inductionDetails", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Site start date">
              <input type="date" className={inputClass} style={inputStyle} value={form.siteStart} onChange={(e) => set("siteStart", e.target.value)} />
            </Field>
            <Field label="Approximate closing date">
              <input type="date" className={inputClass} style={inputStyle} value={form.siteEnd} onChange={(e) => set("siteEnd", e.target.value)} />
            </Field>
          </div>
          {/* Hidden from people, filled in by simple bots. */}
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} style={{ position: "absolute", left: "-9999px", opacity: 0 }} aria-hidden="true" />
        </div>

        {error && <div className="text-sm text-center rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{error}</div>}

        <button disabled={!valid || submitting} onClick={submit} className="text-sm font-semibold px-6 py-3 rounded-lg self-end"
          style={{ background: valid && !submitting ? T.tealDark : T.slateLight, color: "#fff", cursor: valid && !submitting ? "pointer" : "not-allowed" }}>
          {submitting ? "Sending…" : "Submit request"}
        </button>
      </div>
    </div>
  );
}
