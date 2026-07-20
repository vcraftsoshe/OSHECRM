import React, { useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { Upload, Image as ImageIcon, Check, RotateCcw, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { ALWAYS_SECTIONS, CONDITIONAL_SECTIONS, COMPLIANCE_EXTRA_SECTIONS, ALWAYS_PROCEDURES, CONDITIONAL_PROCEDURES, COMPLIANCE_EXTRA_PROCEDURES, ALWAYS_POLICIES, CONDITIONAL_POLICIES, COMPLIANCE_EXTRA_FORMS, computeOhsmsPack } from "./ohsmsLogic";

const T = {
  charcoal: "#1A2C2E", teal: "#13DCCC", tealDark: "#0AADA0",
  paper: "#F5F8F7", paperAlt: "#EBF2F0", card: "#FFFFFF",
  ink: "#152423", slate: "#5C7274", slateLight: "#8CA1A2", border: "#DCE6E4",
  coral: "#C25B4E",
};

const termsSections = [
  { title: "1. Subscription and Access", body: [
    "OSHE Limited grants the Company access to the OSHE App and its associated resources on a subscription basis for the agreed term.",
    "These Terms may be updated by OSHE at any time. The Company will be notified of any changes, and updated terms will be supplied in writing.",
    "Access is provided based on the number of authorised users selected by the Company, with fees calculated in accordance with the Pricing Schedule.",
  ]},
  { title: "2. Subscription Term and Renewal", body: [
    "The Company agrees to a minimum term of 12 months from the date of subscription.",
    "Subscriptions automatically renew at the end of each term. OSHE will send a renewal reminder 30 days in advance.",
    "The Company must provide written notice if it does not wish to renew. Failure to provide notice before the renewal date will result in automatic renewal.",
    "Any price adjustments will be communicated in advance and will only apply from the renewal date.",
  ]},
  { title: "3. Client Information", body: [
    "A Client Information Form must be completed and returned by the Company. This information must be true and accurate.",
    "Information provided will be treated in accordance with the Privacy Act 2020 (NZ) and will not be shared without the Company's consent unless required by law.",
  ]},
  { title: "4. Termination", body: [
    "OSHE reserves the right to terminate the subscription if these Terms are breached.",
    "Early termination by the Company will require payment of the remaining balance for the full 12 month term.",
  ]},
  { title: "5. Product Pricing and Delivery", body: [
    "Prices displayed at www.oshe.co.nz are correct at the time of publishing. OSHE reserves the right to update pricing at any time.",
    "Once pricing is agreed upon and a subscription begins, those rates will remain fixed for the subscription term.",
    "All prices are in New Zealand Dollars and exclusive of GST.",
    "Products and services will be delivered once the initial setup payment has cleared.",
    "Obvious pricing errors are not binding.",
    "Subscription fees are calculated monthly in advance based on the number of authorised users. Pricing starts from $179 per month for up to 10 users, and $249 per month for up to 20 users. Companies requiring 20+ users will be provided with an enterprise quote. Sole traders and paper-only (no app) arrangements are priced separately. All prices are exclusive of GST.",
  ]},
  { title: "6. Additional Services", body: [
    "Travel exceeding 30 km from Tauranga Central will incur a travel fee of $1.07 per kilometer.",
    "Additional hours including training or support are billed monthly as requested.",
    "These hours must be used within the same month and cannot be rolled over.",
  ]},
  { title: "7. Intellectual Property", body: [
    "All documents are provided in template format only.",
    "It is the Company's responsibility to customise and review these for relevance and compliance with its operations.",
    "All documentation is delivered in PDF format and must not be modified or redistributed without written permission from OSHE.",
  ]},
  { title: "8. Disclaimer", body: [
    "OSHE has taken reasonable care in supplying documentation and information. However, accuracy is not guaranteed and content is subject to change.",
    "OSHE is not liable for the consequences of decisions, actions, or omissions made by the Company.",
    "OSHE provides a digital platform and associated system tools. It is the responsibility of the Company to ensure the system is actively used, maintained, and followed by its personnel.",
    "OSHE is not responsible for the consequences of failing to use the system correctly or at all.",
    "While OSHE provides documentation and form templates, it is the Company's responsibility to review, customise, and ensure suitability and legal compliance.",
    "OSHE accepts no responsibility for failure to implement or modify templates or forms appropriately.",
  ]},
  { title: "9. Payment Terms", body: [
    "Invoices are due on the 20th of the month following the invoice date unless otherwise agreed.",
    "A late payment fee or interest may be applied to overdue invoices at a rate of up to 15%, representing a reasonable estimate of administration and recovery costs.",
    "The Company is responsible for all debt recovery costs incurred in the event of non payment.",
  ]},
  { title: "10. Limitation of Liability", body: [
    "To the maximum extent permitted by law, OSHE's total liability for any loss or claim arising from this Agreement is limited to the total subscription fees paid in the previous 12 months.",
    "OSHE is not liable for any indirect, consequential, or special damages.",
  ]},
  { title: "11. Force Majeure", body: [
    "OSHE is not liable for failure or delay in performance due to circumstances beyond its control, including natural disasters, internet outages, cyberattacks, pandemics, or governmental restrictions.",
  ]},
  { title: "12. Data Protection and Privacy", body: [
    "OSHE complies with the Privacy Act 2020 and maintains a Privacy Policy on the OSHE website at www.oshe.co.nz which sets out how personal information is handled, stored, accessed and protected, including OSHE's right to access information for the purpose of providing services and support.",
  ]},
  { title: "13. Governing Law and Dispute Resolution", body: [
    "This Agreement is governed by the laws of New Zealand.",
    "Disputes will first be addressed through good faith negotiations.",
    "If unresolved, both parties agree to mediation prior to taking legal action.",
  ]},
  { title: "14. Entire Agreement and Amendments", body: [
    "This Agreement constitutes the entire understanding between the parties and overrides all prior communications or agreements.",
    "Any amendments must be in writing and signed by both parties.",
  ]},
];

function Field({ label, required, hint, children }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-1.5" style={{ color: T.ink }}>
        {label} {required && <span style={{ color: T.coral }}>*</span>}
      </div>
      {hint && <div className="text-xs mb-1.5" style={{ color: T.slateLight }}>{hint}</div>}
      {children}
    </div>
  );
}

const inputStyle = { border: `1px solid ${T.border}`, color: T.ink, background: "#fff" };

const emergencyOptions = ["Fire", "Medical emergency", "Serious injury or fatality", "Hazardous substance spill", "Vehicle accident", "Plant roll over", "Natural disaster", "Electrical incident", "Working at Heights rescue", "Confined Space rescue", "Excavation collapse", "Violence or aggressive behaviour", "Lone working", "Service strike", "Chainsaw", "Other"];

function ChipGroup({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o);
        return (
          <button key={o} type="button" onClick={() => onToggle(o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm"
            style={{ background: active ? T.tealDark : "#fff", color: active ? "#fff" : T.ink, border: `1px solid ${active ? T.tealDark : T.border}` }}>
            {active && <Check size={12} />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function YesNo({ question, value, onChange, hint, disabled }) {
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${T.border}` }}>
      <div>
        <div className="text-sm" style={{ color: T.ink }}>{question}</div>
        {hint && <div className="text-xs mt-0.5" style={{ color: T.slateLight }}>{hint}</div>}
      </div>
      <div className="flex gap-1.5 shrink-0 ml-4">
        {["Yes", "No"].map((o) => (
          <button key={o} type="button" disabled={disabled} onClick={() => onChange(o === "Yes")}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: (o === "Yes" ? value === true : value === false) ? T.tealDark : "#fff",
              color: (o === "Yes" ? value === true : value === false) ? "#fff" : T.slate,
              border: `1px solid ${(o === "Yes" ? value === true : value === false) ? T.tealDark : T.border}`,
              opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer",
            }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function PackList({ title, items }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full py-2">
        <span className="text-sm font-semibold" style={{ color: T.ink }}>{title}</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: T.tealDark }}>
          {items.length} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {items.map((it) => <span key={it} className="text-xs px-2.5 py-1 rounded-full" style={{ background: T.paperAlt, color: T.slate }}>{it}</span>)}
        </div>
      )}
    </div>
  );
}

const SignaturePad = React.forwardRef(function SignaturePad({ onSign }, forwardedRef) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = T.ink;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    if (forwardedRef) forwardedRef.current = canvasRef.current;
  }, [forwardedRef]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x, y };
  };
  const start = (e) => { drawing.current = true; const { x, y } = pos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y); ctx.stroke();
    onSign(true);
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onSign(false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef} width={600} height={140}
        className="w-full rounded-lg"
        style={{ border: `1px dashed ${T.slateLight}`, background: T.paperAlt, touchAction: "none", cursor: "crosshair" }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button onClick={clear} className="flex items-center gap-1.5 text-xs font-semibold mt-2" style={{ color: T.slate }}>
        <RotateCcw size={12} /> Clear signature
      </button>
    </div>
  );
});

export default function SignupForm() {
  const { leadId } = useParams();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    company: "", email: "", contactName: "", accountsEmail: "", phone: "", startDate: "",
    address: "", workTasks: "", appUsers: "", paymentFreq: "", requireOhsms: "",
  });
  const [t, setT] = useState({
    contractors: null, physicalWorkplace: null, plant: null, vehicles: null, ppe: null,
    hazardousSubstances: null, healthMonitoring: null, erp: true,
    workers: null, wellbeing: null,
    continualImprovement: true,
    compliance: null,
  });
  const [logo, setLogo] = useState(null);
  const [existingFiles, setExistingFiles] = useState([]);
  const [signed, setSigned] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const signatureCanvasRef = useRef(null);
  const [emergencies, setEmergencies] = useState([]);
  const [emergencyOther, setEmergencyOther] = useState("");

  const toggleEmergency = (val) => setEmergencies((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setTrig = (k, v) => setT((prev) => {
    const next = { ...prev, [k]: v };
    if (k === "compliance" && v === true) next.continualImprovement = true;
    return next;
  });

  const steps = ["Company details", "Plan & Safety Details", "Logo & Sign-off"];
  const wantsOhsms = form.requireOhsms === "Yes";
  const pack = wantsOhsms ? computeOhsmsPack(t) : null;

  const step0Valid = form.company && form.email && form.contactName && form.accountsEmail && form.phone && form.address;
  const triggersAnswered = !wantsOhsms || [t.contractors, t.physicalWorkplace, t.plant, t.vehicles, t.ppe, t.hazardousSubstances, t.healthMonitoring, t.workers, t.wellbeing, t.compliance].every((v) => v !== null);
  const step1Valid = form.appUsers && form.paymentFreq && form.requireOhsms && triggersAnswered;
  const canSubmit = step0Valid && step1Valid && agreed && signed;
  const canAdvance = step === 0 ? step0Valid : step === 1 ? step1Valid : true;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const signatureDataUrl = signatureCanvasRef.current ? signatureCanvasRef.current.toDataURL("image/png") : null;
      const submitSignup = httpsCallable(functions, "submitSignup");
      await submitSignup({
        leadId: leadId || null,
        form,
        triggers: t,
        emergencies,
        emergencyOther,
        logoDataUrl: logo,
        existingFiles,
        signatureDataUrl,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Sign-up submission failed:", err);
      setSubmitError("Something went wrong submitting this — please try again, or contact OSHE directly if it keeps happening.");
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
          <div className="text-sm" style={{ color: T.slate }}>
            Your details have been sent through to the OSHE team. They'll be in touch shortly to get everything set up for {form.company || "your company"}.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <img src="/logo-full.png" alt="OSHE" style={{ height: 40, width: "auto" }} />
          <div className="text-2xl font-bold mt-4" style={{ color: T.ink }}>Client Information Form</div>
        </div>

        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: i <= step ? T.tealDark : T.paperAlt, color: i <= step ? "#fff" : T.slateLight }}>
                  {i < step ? <Check size={13} /> : i + 1}
                </div>
                <span className="text-xs font-semibold hidden sm:inline" style={{ color: i === step ? T.ink : T.slateLight }}>{s}</span>
              </div>
              {i < steps.length - 1 && <div className="flex-1 h-px" style={{ background: i < step ? T.tealDark : T.border }} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 0: Company details */}
        {step === 0 && (
          <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: T.card, border: `1px solid ${T.border}` }}>
            <div className="grid grid-cols-2 gap-5">
              <Field label="Company Name" required>
                <input value={form.company} onChange={(e) => set("company", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
              <Field label="Email Address" required>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
              <Field label="Contact Name" required>
                <input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
              <Field label="Accounts Email Address" required>
                <input type="email" value={form.accountsEmail} onChange={(e) => set("accountsEmail", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
              <Field label="Contact Number" required>
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
              <Field label="Preferred Start Date">
                <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
              </Field>
            </div>
            <Field label="Physical Address" required>
              <input value={form.address} onChange={(e) => set("address", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle} />
            </Field>
            <Field label="Please list your General Work Tasks">
              <textarea rows={3} value={form.workTasks} onChange={(e) => set("workTasks", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none resize-none" style={inputStyle} />
            </Field>
          </div>
        )}

        {/* Step 1: Plan & Safety Details */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div className="rounded-2xl p-6 grid grid-cols-2 gap-5" style={{ background: T.card, border: `1px solid ${T.border}` }}>
              <Field label="App user #" required>
                <select value={form.appUsers} onChange={(e) => set("appUsers", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle}>
                  <option value="">Select option...</option>
                  <option>$179+ per month for upto 10 users</option>
                  <option>$249+ per month for upto 20 users</option>
                  <option>20+ users, enterprise cost quoted</option>
                  <option>Sole Trader</option>
                </select>
              </Field>
              <Field label="Would you like your payments monthly or annually" required>
                <select value={form.paymentFreq} onChange={(e) => set("paymentFreq", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle}>
                  <option value="">Select option...</option>
                  <option>Monthly</option><option>Annually</option>
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Do you require a OHSMS" required hint="This is the system (manual, policy, procedures etc)">
                  <select value={form.requireOhsms} onChange={(e) => set("requireOhsms", e.target.value)} className="w-full text-sm px-3 py-2.5 rounded-lg outline-none" style={inputStyle}>
                    <option value="">Select option...</option>
                    <option>Yes</option>
                  </select>
                </Field>
              </div>
            </div>

            {wantsOhsms && (
              <>
                <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                  <div className="text-sm mb-3" style={{ color: T.slate }}>Answer Yes/No — this decides exactly what goes into your safety system, nothing more.</div>

                  <div className="text-xs font-bold uppercase tracking-wide mt-2 mb-1" style={{ color: T.tealDark }}>1. Contractors</div>
                  <YesNo question="Do you engage contractors?" value={t.contractors} onChange={(v) => setTrig("contractors", v)} />

                  <div className="text-xs font-bold uppercase tracking-wide mt-4 mb-1" style={{ color: T.tealDark }}>2. Workplace & Operations</div>
                  <YesNo question="Does your business operate from a physical workplace?" hint="Office, workshop, warehouse, yard, factory" value={t.physicalWorkplace} onChange={(v) => setTrig("physicalWorkplace", v)} />
                  <YesNo question="Do you own, hire or operate plant and equipment?" value={t.plant} onChange={(v) => setTrig("plant", v)} />
                  <YesNo question="Do workers drive vehicles for work?" value={t.vehicles} onChange={(v) => setTrig("vehicles", v)} />
                  <YesNo question="Do workers use Personal Protective Equipment (PPE)?" value={t.ppe} onChange={(v) => setTrig("ppe", v)} />
                  <YesNo question="Does your business store or use hazardous substances?" value={t.hazardousSubstances} onChange={(v) => setTrig("hazardousSubstances", v)} />
                  <YesNo question="Do workers undertake activities requiring exposure or health monitoring?" value={t.healthMonitoring} onChange={(v) => setTrig("healthMonitoring", v)} />
                  <YesNo question="Does your business require an Emergency Response Plan?" value={t.erp} onChange={(v) => setTrig("erp", v)} />
                  {t.erp === true && (
                    <div className="pt-2 pb-3">
                      <div className="text-sm mb-2" style={{ color: T.ink }}>Which emergencies could reasonably occur?</div>
                      <ChipGroup options={emergencyOptions} selected={emergencies} onToggle={toggleEmergency} />
                      {emergencies.includes("Other") && (
                        <input value={emergencyOther} onChange={(e) => setEmergencyOther(e.target.value)} placeholder="Tell us what else..."
                          className="w-full text-sm px-3 py-2 rounded-lg outline-none mt-2" style={inputStyle} />
                      )}
                    </div>
                  )}

                  <div className="text-xs font-bold uppercase tracking-wide mt-4 mb-1" style={{ color: T.tealDark }}>3. Worker Management</div>
                  <YesNo question="Do you employ workers?" value={t.workers} onChange={(v) => setTrig("workers", v)} />
                  <YesNo question="Would you like to include a Wellbeing Management System?" value={t.wellbeing} onChange={(v) => setTrig("wellbeing", v)} />

                  <div className="text-xs font-bold uppercase tracking-wide mt-4 mb-1" style={{ color: T.tealDark }}>4. Compliance schemes</div>
                  <YesNo question="Do you need to meet SiteWise and/or Totika?" value={t.compliance} onChange={(v) => setTrig("compliance", v)} />
                </div>
                {/* `pack` is computed above from the trigger answers and is what drives document generation
                    internally (the CRM's Systems builder) — deliberately not displayed to the client here. */}
              </>
            )}
          </div>
        )}

        {/* Step 2: Logo & Sign-off */}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
              <Field label="Would you like your logo on all documents? ($250+ one-off fee)" hint="Please attach your logo here">
                <label className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-lg text-sm cursor-pointer"
                  style={{ border: `1.5px dashed ${T.slateLight}`, color: T.slate, background: T.paperAlt }}>
                  {logo ? <ImageIcon size={22} color={T.tealDark} /> : <Upload size={20} />}
                  {logo ? "Logo attached — click to change" : "Click to upload your logo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setLogo(reader.result);
                    reader.readAsDataURL(file);
                  }} />
                </label>
              </Field>
            </div>

            <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
              <Field label="Do you have any existing documents you'd like to send us?" hint="Anything you already have — old H&S folders, registers, policies — attach them here and we'll work them into your system.">
                <label className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-lg text-sm cursor-pointer"
                  style={{ border: `1.5px dashed ${T.slateLight}`, color: T.slate, background: T.paperAlt }}>
                  <Upload size={20} />
                  Click to upload one or more files
                  <input type="file" multiple className="hidden" onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach((file) => {
                      const reader = new FileReader();
                      reader.onload = () => setExistingFiles((prev) => [...prev, { name: file.name, dataUrl: reader.result }]);
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                </label>
                {existingFiles.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-3">
                    {existingFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: T.paperAlt }}>
                        <span style={{ color: T.ink }}>{f.name}</span>
                        <button type="button" onClick={() => setExistingFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ color: T.slateLight }}>
                          <RotateCcw size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
              <div className="text-lg font-bold mb-3" style={{ color: T.ink }}>Terms & Conditions</div>
              <div className="rounded-lg p-4 text-xs leading-relaxed overflow-y-auto" style={{ background: T.paperAlt, color: T.slate, maxHeight: 260, border: `1px solid ${T.border}` }}>
                {termsSections.map((sec) => (
                  <div key={sec.title} className="mb-3">
                    <p className="font-semibold mb-1" style={{ color: T.ink }}>{sec.title}</p>
                    {sec.body.map((para, i) => <p key={i} className="mb-1.5">{para}</p>)}
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer" style={{ color: T.ink }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                By signing below you are agreeing you have read the Terms & Conditions above <span style={{ color: T.coral }}>*</span>
              </label>
            </div>

            <div className="rounded-2xl p-6" style={{ background: T.card, border: `1px solid ${T.border}` }}>
              <div className="text-sm font-semibold mb-2" style={{ color: T.ink }}>Sign here <span style={{ color: T.coral }}>*</span></div>
              <SignaturePad ref={signatureCanvasRef} onSign={setSigned} />
            </div>
          </div>
        )}

        {submitError && (
          <div className="text-sm text-center rounded-lg px-4 py-3" style={{ background: "#F8EBE9", color: T.coral }}>{submitError}</div>
        )}

        <div className="flex items-center justify-between pb-6">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg" style={{ color: step === 0 ? T.slateLight : T.slate, cursor: step === 0 ? "default" : "pointer" }}>
            <ChevronLeft size={16} /> Back
          </button>
          {step < steps.length - 1 ? (
            <button onClick={() => canAdvance && setStep((s) => s + 1)} disabled={!canAdvance}
              className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-lg"
              style={{ background: canAdvance ? T.tealDark : T.slateLight, color: "#fff", cursor: canAdvance ? "pointer" : "not-allowed" }}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button disabled={!canSubmit || submitting} onClick={handleSubmit}
              className="text-sm font-semibold px-6 py-2.5 rounded-lg"
              style={{ background: canSubmit && !submitting ? T.tealDark : T.slateLight, color: "#fff", cursor: canSubmit && !submitting ? "pointer" : "not-allowed" }}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
