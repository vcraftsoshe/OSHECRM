import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Users, TrendingUp, Bell, Building2, CreditCard, StickyNote,
  ChevronRight, Plus, Check, Upload, Calendar, X, Search,
  ClipboardList, Layers, Circle, CheckCircle2, Image as ImageIcon,
  Repeat, Trash2, ListChecks, ListTodo, Mail, ArrowUpRight, Store, LayoutDashboard, ChevronDown
} from "lucide-react";
import { collection, doc, onSnapshot, updateDoc, setDoc, getDocs, getDoc, deleteDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";

/* ---------- Design tokens (OSHE brand) ---------- */
const T = {
  charcoal: "#1A2C2E", charcoalLight: "#24393C", charcoalSoft: "#2E4548",
  teal: "#13DCCC", tealDark: "#0AADA0",
  paper: "#F5F8F7", paperAlt: "#EBF2F0", card: "#FFFFFF",
  ink: "#152423", slate: "#5C7274", slateLight: "#8CA1A2", border: "#DCE6E4",
  amber: "#D99A3D", coral: "#C25B4E", blue: "#5C8AA6",
};

const TEAM = ["Vanessa", "Sophie", "Judith", "Jo"];

const stageOrder = ["New Lead", "Contacted", "Proposal Sent", "Won", "Lost"];
const stageMeta = {
  "New Lead": { color: T.slateLight, bg: "#EEF2F2" },
  "Contacted": { color: T.blue, bg: "#EAF1F4" },
  "Proposal Sent": { color: T.amber, bg: "#FBF1E3" },
  "Won": { color: T.tealDark, bg: "#E4F8F5" },
  "Lost": { color: T.coral, bg: "#F8EBE9" },
};

const extraStatusMeta = {
  "Requested": { color: T.slateLight, bg: "#EEF2F2" },
  "In Progress": { color: T.amber, bg: "#FBF1E3" },
  "Done": { color: T.tealDark, bg: "#E4F8F5" },
};
const extraStatusFlow = ["Requested", "In Progress", "Done"];

const CLIENT_PROFILES = ["Enterprise Client", "Hourly Client", "Standard Client"];

const billingTypeMeta = {
  Hourly: { label: "Hourly — billed against included hours", color: T.tealDark },
  SubscriptionHours: { label: "Subscription + hours — flat fee plus an hours allowance to track", color: T.blue },
  FlatFee: { label: "Flat fee only — nothing to track", color: T.slateLight },
};

const priorityMeta = {
  High: { color: T.coral, bg: "#F8EBE9" },
  Medium: { color: T.amber, bg: "#FBF1E3" },
  Low: { color: T.blue, bg: "#EAF1F4" },
};

const defaultOnboardingTemplate = [
  { id: "welcome", title: "Send welcome pack & introduce team", owner: "Vanessa", dueDays: 2 },
  { id: "kickoff", title: "Schedule kickoff call", owner: "Vanessa", dueDays: 5 },
  { id: "record", title: "Confirm client record + Firestore entry", owner: "Judith", dueDays: 5 },
  { id: "ohsms", title: "Scope OHSMS / policy requirements", owner: "Sophie", dueDays: 10 },
  { id: "docs", title: "Build & deliver initial documents", owner: "Sophie", dueDays: 20 },
  { id: "reporting", title: "Set up monthly reporting cadence", owner: "Jo", dueDays: 25 },
];

/* ---------- Mock data ---------- */
const initialClients = [
  {
    id: "bmc", name: "BMC Construction", legalName: "Brendan Murray Construction 2019 Ltd", logo: null,
    contract: { start: "2024-02-01", renewal: "2027-02-01", value: "$24,000 / yr", plan: "Full H&S Retainer" },
    billing: { contact: "Darryl Dawson", email: "accounts@bmcconstruction.co.nz", terms: "Monthly, 20th", status: "Current" },
    billingType: "Hourly", billingSetupDone: true, profile: "Enterprise Client",
    contacts: [
      { id: 1, name: "Darryl Dawson", role: "Director", email: "darryl@bmcconstruction.co.nz", phone: "021 555 0110" },
      { id: 2, name: "Site Manager — Applefields", role: "Site Contact", email: "applefields@bmcconstruction.co.nz", phone: "021 555 0192" },
    ],
    notes: [
      { id: 1, author: "Sarah Thomas", date: "2026-07-14", text: "Sent updated task analyses for Applefields site, waiting on sign-off from site manager." },
      { id: 2, author: "Judith Page", date: "2026-07-02", text: "Confirmed June monthly report received well, no changes requested." },
    ],
    reminders: [
      { id: 1, text: "Send July monthly H&S report", date: "2026-08-05", recurring: "monthly", done: false, assignee: "Sophie" },
      { id: 2, text: "OHSMS annual review due", date: "2026-09-01", recurring: "yearly", done: false, assignee: "Sophie" },
    ],
    ohsmsLastIssued: "2025-09-01", ohsmsDue: "2026-09-01",
    extras: [
      { id: 1, date: "2026-07-10", description: "One-off site audit for Applefields ahead of client visit", status: "Done", hours: 2 },
      { id: 2, date: "2026-07-17", description: "Extra toolbox talk resource requested for new site", status: "In Progress", hours: 3 },
    ],
    hours: {
      included: 12,
      log: [
        { id: 1, date: "2026-07-02", member: "Sophie", hours: 3, description: "June monthly report build" },
        { id: 2, date: "2026-07-09", member: "Judith", hours: 2, description: "Data pull + checklist" },
        { id: 3, date: "2026-07-15", member: "Sarah Thomas", hours: 4, description: "Site review write-ups" },
        { id: 4, date: "2026-07-11", member: "—", hours: 2, description: "Extra: Applefields site audit" },
      ],
    },
    users: { log: [{ id: 1, month: "2026-06", count: 14 }, { id: 2, month: "2026-07", count: 16 }] },
    intake: null,
  },
  {
    id: "radius", name: "Radius Care Applefields", legalName: "Radius Care Applefields Ltd", logo: null,
    contract: { start: "2026-05-12", renewal: "2027-05-12", value: "$8,500 / yr", plan: "HSMP Build + Support" },
    billing: { contact: "Finance Team", email: "finance@radiuscare.co.nz", terms: "Quarterly", status: "Current" },
    billingType: "FlatFee", billingSetupDone: true, profile: "Standard Client",
    contacts: [
      { id: 1, name: "Finance Team", role: "Billing Contact", email: "finance@radiuscare.co.nz", phone: "" },
      { id: 2, name: "Facility Manager", role: "Primary Contact", email: "facility@radiuscare.co.nz", phone: "021 555 0233" },
    ],
    notes: [{ id: 1, author: "Sophie", date: "2026-07-01", text: "HSMP delivered, org pyramid and hazard diagram signed off." }],
    reminders: [{ id: 1, text: "Check in on HSMP rollout", date: "2026-08-01", recurring: "none", done: false, assignee: "Sophie" }],
    ohsmsLastIssued: "2026-07-01", ohsmsDue: "2027-07-01",
    extras: [], hours: { included: 0, log: [] },
    users: { log: [{ id: 1, month: "2026-07", count: 5 }] },
    intake: null,
  },
  {
    id: "manaaki", name: "Manaaki Ora Trust", legalName: "Manaaki Ora Trust", logo: null,
    contract: { start: "2025-11-01", renewal: "2026-11-01", value: "$6,000 / yr", plan: "Monthly Reporting" },
    billing: { contact: "Trust Board", email: "admin@manaakiora.org.nz", terms: "Monthly, 1st", status: "Overdue" },
    billingType: "SubscriptionHours", billingSetupDone: true, profile: "Hourly Client",
    contacts: [{ id: 1, name: "Trust Board", role: "Billing Contact", email: "admin@manaakiora.org.nz", phone: "" }],
    notes: [{ id: 1, author: "Sarah Thomas", date: "2026-06-28", text: "May report delivered, they'd like donut chart to include YoY comparison next time." }],
    reminders: [{ id: 1, text: "Follow up on overdue invoice", date: "2026-07-22", recurring: "none", done: false, assignee: "Vanessa" }],
    ohsmsLastIssued: "2026-01-15", ohsmsDue: "2026-08-15",
    extras: [{ id: 1, date: "2026-06-20", description: "Requested YoY comparison added to donut chart", status: "Requested", hours: 1 }],
    hours: { included: 6, log: [{ id: 1, date: "2026-06-25", member: "Sarah Thomas", hours: 5, description: "May report build" }] },
    users: { log: [{ id: 1, month: "2026-07", count: 3 }] },
    intake: null,
  },
  {
    id: "coastal", name: "Coastal Build Group", legalName: "Coastal Build Group Ltd", logo: null,
    contract: { start: "2025-03-01", renewal: "2026-03-01", value: "$4,200 / yr", plan: "Monthly Compliance Pack" },
    billing: { contact: "Rangi Ropata", email: "accounts@coastalbuild.co.nz", terms: "Monthly, 1st", status: "Current" },
    billingType: "FlatFee", billingSetupDone: true, profile: "Standard Client",
    contacts: [{ id: 1, name: "Rangi Ropata", role: "Director", email: "rangi@coastalbuild.co.nz", phone: "" }],
    notes: [], reminders: [], ohsmsLastIssued: "2025-09-01", ohsmsDue: "2026-09-01",
    extras: [], hours: { included: 0, log: [{ id: 1, date: "2026-07-18", member: "Sophie", hours: 3, description: "Ad-hoc query support outside the usual pack" }] }, users: { log: [{ id: 1, month: "2026-07", count: 4 }] },
    intake: null,
  },
  {
    id: "primefencing", name: "Prime Fencing Ltd", legalName: "Prime Fencing Ltd", logo: null,
    contract: { start: "2025-08-15", renewal: "2026-08-15", value: "$3,000 / yr", plan: "Monthly Compliance Pack" },
    billing: { contact: "Aroha Ngata", email: "office@primefencing.co.nz", terms: "Monthly, 15th", status: "Current" },
    billingType: "FlatFee", billingSetupDone: true, profile: "Standard Client",
    contacts: [{ id: 1, name: "Aroha Ngata", role: "Office Manager", email: "aroha@primefencing.co.nz", phone: "" }],
    notes: [], reminders: [], ohsmsLastIssued: "2025-08-15", ohsmsDue: "2026-08-15",
    extras: [], hours: { included: 0, log: [] }, users: { log: [{ id: 1, month: "2026-07", count: 2 }] },
    intake: null,
  },
];

const initialLeads = [
  { id: 1, company: "Coastline Builders Ltd", contact: "Mike Herrera", value: "$14,000", stage: "New Lead", formEmail: null, formStatus: "none", notes: [] },
  { id: 2, company: "Northline Civil", contact: "Priya Nair", value: "$9,500", stage: "Contacted", formEmail: null, formStatus: "none", notes: [] },
  { id: 3, company: "Foundation Plus", contact: "Tane Walker", value: "$18,000", stage: "Proposal Sent", formEmail: null, formStatus: "none", notes: [{ id: 1, text: "Wants a walk-through of the OHSMS builder before signing.", date: "2026-07-16" }] },
  { id: 4, company: "Summit Roofing Co", contact: "Grace Liu", value: "$5,000", stage: "Won", formEmail: "grace@summitroofing.co.nz", formStatus: "sent", notes: [] },
  { id: 5, company: "Harbour Fitout", contact: "Dana Reid", value: "$7,200", stage: "Lost", formEmail: null, formStatus: "none", notes: [{ id: 1, text: "Went with a competitor on price.", date: "2026-07-05" }] },
];

const initialTasks = [
  { id: 1, title: "Review Manaaki Ora chart feedback", assignee: "Sophie", priority: "Medium", done: false },
  { id: 2, title: "Chase overdue invoice", assignee: "Vanessa", priority: "High", done: false },
  { id: 3, title: "Update BMC monthly checklist template", assignee: "Judith", priority: "Low", done: false },
  { id: 4, title: "Draft July report skeleton", assignee: "Jo", priority: "Medium", done: false },
];

const initialResellers = [
  {
    id: "res1", name: "Kiwi Safety Consulting", contactEmail: "hello@kiwisafetyconsulting.co.nz", contactPhone: "021 555 0301",
    clients: [
      { id: "resc1", name: "Alpine Roofing", users: { log: [{ id: 1, month: "2026-06", count: 6 }, { id: 2, month: "2026-07", count: 8 }] } },
      { id: "resc2", name: "Southland Scaffolding", users: { log: [{ id: 1, month: "2026-07", count: 5 }] } },
    ],
    tasks: [
      { id: 1, text: "Confirm per-user rate for Q3 with them", done: false, assignee: "Vanessa", date: "2026-07-25" },
    ],
  },
  {
    id: "res2", name: "Site Safe Partners", contactEmail: "team@sitesafepartners.co.nz", contactPhone: "",
    clients: [
      { id: "resc3", name: "Northland Earthworks", users: { log: [{ id: 1, month: "2026-07", count: 12 }] } },
    ],
    tasks: [
      { id: 1, text: "They've asked about a bulk discount past 20 users — needs a decision", done: false, assignee: "Vanessa", date: "2026-07-28" },
    ],
  },
];

const ohsmsSections = [
  { id: "policy", title: "H&S Policy Statement", blurb: "Signed policy statement establishing {{COMPANY}}'s commitment to health and safety." },
  { id: "hazard", title: "Hazard Identification & Management", blurb: "Process for identifying, assessing and controlling hazards across {{COMPANY}} sites." },
  { id: "emergency", title: "Emergency Procedures", blurb: "Evacuation, fire, medical emergency and civil defence procedures for {{COMPANY}} sites." },
  { id: "induction", title: "Training & Site Induction", blurb: "Induction requirements and ongoing training register for {{COMPANY}} workers." },
  { id: "incident", title: "Incident & Near-Miss Reporting", blurb: "Reporting, investigation and corrective action process." },
  { id: "ppe", title: "PPE Requirements", blurb: "Minimum PPE standards across {{COMPANY}} sites." },
  { id: "contractor", title: "Contractor & Subcontractor Management", blurb: "Pre-qualification and induction of contractors working for {{COMPANY}}." },
  { id: "drugalcohol", title: "Drug & Alcohol Policy", blurb: "Testing regime and consequences under {{COMPANY}}'s zero-tolerance approach." },
];
const policySections = [
  { id: "siterules", title: "Site-Specific Rules", blurb: "Rules specific to each {{COMPANY}} site, reviewed per project." },
  { id: "vehicles", title: "Vehicle & Mobile Plant", blurb: "Operating rules for vehicles and plant on {{COMPANY}} sites." },
  { id: "heights", title: "Working at Height", blurb: "Fall prevention and control procedures." },
  { id: "manualhandling", title: "Manual Handling", blurb: "Safe lifting and manual handling procedures for {{COMPANY}} staff." },
  { id: "confinedspace", title: "Confined Space Entry", blurb: "Entry permit and monitoring procedure." },
  { id: "electrical", title: "Electrical Safety", blurb: "Isolation and lock-out/tag-out procedures." },
];

function today() { return new Date().toISOString().slice(0, 10); }

// A short two-tone chime, synthesized in-browser — no audio file needed.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  } catch (err) {
    console.error("Couldn't play notification sound:", err);
  }
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function daysUntil(d) { return Math.ceil((new Date(d) - new Date(today())) / 86400000); }
function addDays(dateStr, days) { const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function urgencyColor(dueDate) {
  const d = daysUntil(dueDate);
  return d < 0 ? T.coral : d <= 3 ? T.amber : T.slate;
}
function currentMonth() { return today().slice(0, 7); }

/* ---------- Shared bits ---------- */
function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm transition-colors"
      style={{ background: active ? T.charcoalSoft : "transparent", color: active ? T.teal : "#B9C7C6" }}>
      <Icon size={18} /><span style={{ fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}
function Pill({ children, color, bg }) {
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color, background: bg }}>{children}</span>;
}
function Card({ children, style, className, ...rest }) {
  return <div className={"rounded-xl " + (className || "")} style={{ background: T.card, border: `1px solid ${T.border}`, ...style }} {...rest}>{children}</div>;
}

/* ---------- Onboarding (lives on the client record) ---------- */
function ClientOnboarding({ client, onboardings, updateOnboardingsForClient, workflows, pushNotification, goToWorkflows }) {
  const [pickerWorkflowId, setPickerWorkflowId] = useState(workflows.find((w) => w.isDefault)?.id || workflows[0]?.id);
  const [showArchive, setShowArchive] = useState(false);
  const [showStarter, setShowStarter] = useState(false);
  const list = onboardings[client.id] || [];
  const activeList = list.filter((i) => !i.completedDate);
  const archived = list.filter((i) => i.completedDate);

  const markDone = (instId, stepId) => {
    updateOnboardingsForClient(client.id, (clientList) => clientList.map((inst) => {
      if (inst.id !== instId) return inst;
      const steps = inst.steps.map((s) => (s.id === stepId ? { ...s, done: true } : s));
      const nowComplete = steps.every((s) => s.done);
      if (nowComplete) {
        pushNotification({ forPerson: "Vanessa", clientId: client.id, clientName: client.name, message: `${client.name} — ${inst.workflowName} complete, add to billing` });
        return { ...inst, steps, completedDate: today() };
      }
      return { ...inst, steps };
    }));
  };

  const startOnboarding = () => {
    const wf = workflows.find((w) => w.id === pickerWorkflowId);
    if (!wf) return;
    const newInst = {
      id: "ob" + Date.now(), workflowId: wf.id, workflowName: wf.name, startedDate: today(), completedDate: null,
      steps: wf.steps.map((s) => ({ ...s, done: false, dueDate: addDays(today(), s.dueDays) })),
    };
    updateOnboardingsForClient(client.id, (clientList) => [...clientList, newInst]);
    setShowStarter(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: T.slate }}>
          {activeList.length === 0 ? "No workflows running for this client" : `${activeList.length} workflow${activeList.length > 1 ? "s" : ""} running`}
        </div>
        <button onClick={() => setShowStarter((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.charcoal, color: T.teal }}>
          <Plus size={13} /> Start a workflow
        </button>
      </div>

      {showStarter && (
        <Card style={{ padding: 16 }}>
          <div className="flex items-center gap-2">
            <select value={pickerWorkflowId} onChange={(e) => setPickerWorkflowId(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={startOnboarding} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>Start</button>
            <button onClick={goToWorkflows} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Manage workflows</button>
          </div>
        </Card>
      )}

      {activeList.map((inst) => {
        const currentIdx = inst.steps.findIndex((s) => !s.done);
        return (
          <div key={inst.id} className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: T.ink }}>{inst.workflowName}</span>
                <Pill color={T.amber} bg={T.paperAlt}>With {inst.steps[currentIdx].owner}</Pill>
              </div>
              <button onClick={goToWorkflows} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                Edit this workflow
              </button>
            </div>
            <Card style={{ padding: 18 }}>
              <div className="flex flex-col gap-2">
                {inst.steps.map((s, i) => {
                  const isCurrent = i === currentIdx;
                  return (
                    <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg"
                      style={{ background: isCurrent ? T.paperAlt : "transparent", border: `1px solid ${isCurrent ? T.tealDark : "transparent"}` }}>
                      <div className="flex items-center gap-2.5">
                        {s.done ? <CheckCircle2 size={16} color={T.tealDark} /> : <Circle size={16} color={isCurrent ? T.amber : T.slateLight} />}
                        <div>
                          <div className="text-sm" style={{ color: T.ink, textDecoration: s.done ? "line-through" : "none" }}>{s.title}</div>
                          <div className="text-xs flex items-center gap-2" style={{ color: T.slate }}>
                            <span>{s.owner}</span>
                            {!s.done && s.dueDate && (
                              <span className="flex items-center gap-1" style={{ color: urgencyColor(s.dueDate) }}>
                                <Calendar size={10} /> {daysUntil(s.dueDate) < 0 ? `Overdue · was due ${fmtDate(s.dueDate)}` : `Due ${fmtDate(s.dueDate)}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isCurrent && !s.done && (
                        <button onClick={() => markDone(inst.id, s.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>
                          Mark done &amp; hand off
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        );
      })}

      {activeList.length === 0 && !showStarter && (
        <Card style={{ padding: 24 }}>
          <div className="text-sm" style={{ color: T.slate }}>Nothing running right now — use "Start a workflow" above.</div>
        </Card>
      )}

      {archived.length > 0 && (
        <div>
          <button onClick={() => setShowArchive((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: T.slate }}>
            <ListChecks size={13} /> {showArchive ? "Hide" : "Show"} completed workflow{archived.length > 1 ? "s" : ""} ({archived.length})
          </button>
          {showArchive && (
            <div className="flex flex-col gap-2 mt-2">
              {archived.map((inst) => (
                <Card key={inst.id} style={{ padding: 14, opacity: 0.75 }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: T.ink }}>{inst.workflowName}</span>
                    <Pill color={T.tealDark} bg={T.paperAlt}>Completed {fmtDate(inst.completedDate)}</Pill>
                  </div>
                  <div className="text-xs mt-1" style={{ color: T.slateLight }}>Started {fmtDate(inst.startedDate)} &middot; {inst.steps.length} steps</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Clients module ---------- */
function ClientsView({ clients, selectedId, setSelectedId, onboardings, updateOnboardingsForClient, workflows, pushNotification, goToWorkflows, tabRequest }) {
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    if (tabRequest && tabRequest.nonce) setTab(tabRequest.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRequest && tabRequest.nonce]);
  const [newHour, setNewHour] = useState({ member: TEAM[0], hours: "", description: "" });
  const [newExtra, setNewExtra] = useState({ description: "", hours: "" });
  const [newUserCount, setNewUserCount] = useState("");
  const [newContact, setNewContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [noteDraft, setNoteDraft] = useState({ text: "", tags: [] });
  const [newReminder, setNewReminder] = useState({ text: "", date: "", recurring: "none", assignee: TEAM[0] });
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: "", legalName: "", plan: "", contractStart: "", contractRenewal: "",
    billingContact: "", billingEmail: "", billingTerms: "", billingStatus: "Current",
    billingType: "FlatFee", profile: "Standard Client", includedHours: "", ohsmsLastIssued: "",
  });
  const setNCF = (field, value) => setNewClientForm((f) => ({ ...f, [field]: value }));
  const [showArchived, setShowArchived] = useState(false);
  const [showArchivedHours, setShowArchivedHours] = useState(false);
  const visibleClients = clients.filter((c) => (showArchived ? c.archived : !c.archived));

  const archiveClient = (id) => updateDoc(doc(db, "clients", id), { archived: true });
  const unarchiveClient = (id) => updateDoc(doc(db, "clients", id), { archived: false });
  const deleteClientPermanently = (id) => {
    if (!window.confirm("Permanently delete this client? This can't be undone.")) return;
    deleteDoc(doc(db, "clients", id));
    if (id === client.id) {
      const next = clients.find((c) => c.id !== id);
      if (next) setSelectedId(next.id);
    }
  };

  const updateClient = (fn) => {
    const updated = fn(client);
    const { id, ...fields } = updated;
    updateDoc(doc(db, "clients", client.id), fields);
  };

  const addClient = async () => {
    if (!newClientForm.name.trim()) return;
    const id = "c" + Date.now();
    const lastIssued = newClientForm.ohsmsLastIssued || null;
    await setDoc(doc(db, "clients", id), {
      name: newClientForm.name, legalName: newClientForm.legalName || newClientForm.name, logo: null,
      contract: {
        start: newClientForm.contractStart || today(),
        renewal: newClientForm.contractRenewal || addDays(today(), 365),
        plan: newClientForm.plan || "Plan to confirm",
      },
      billing: {
        contact: newClientForm.billingContact, email: newClientForm.billingEmail,
        terms: newClientForm.billingTerms || "TBC", status: newClientForm.billingStatus,
      },
      billingType: newClientForm.billingType, billingSetupDone: true, profile: newClientForm.profile,
      contacts: [], notes: [], reminders: [], extras: [],
      hours: { included: Number(newClientForm.includedHours) || 0, log: [] }, users: { log: [] },
      ohsmsLastIssued: lastIssued, ohsmsDue: lastIssued ? addDays(lastIssued, 365) : addDays(today(), 365),
      intake: null,
    });
    setSelectedId(id);
    setNewClientForm({ name: "", legalName: "", plan: "", contractStart: "", contractRenewal: "", billingContact: "", billingEmail: "", billingTerms: "", billingStatus: "Current", billingType: "FlatFee", profile: "Standard Client", includedHours: "", ohsmsLastIssued: "" });
    setShowAddClient(false);
  };

  const cycleExtraStatus = (extraId) => {
    updateClient((c) => {
      const extras = c.extras.map((e) => {
        if (e.id !== extraId) return e;
        const nextIdx = Math.min(extraStatusFlow.indexOf(e.status) + 1, extraStatusFlow.length - 1);
        return { ...e, status: extraStatusFlow[nextIdx] };
      });
      const justDone = extras.find((e) => e.id === extraId && e.status === "Done");
      let hours = c.hours;
      if (justDone) {
        hours = { ...c.hours, log: [...c.hours.log, { id: Date.now(), date: today(), member: "—", hours: justDone.hours, description: `Extra: ${justDone.description}`, archived: false }] };
      }
      return { ...c, extras, hours };
    });
  };

  const addExtra = () => {
    if (!newExtra.description.trim()) return;
    updateClient((c) => ({ ...c, extras: [...c.extras, { id: Date.now(), date: today(), description: newExtra.description, status: "Requested", hours: Number(newExtra.hours) || 0 }] }));
    setNewExtra({ description: "", hours: "" });
  };
  const addHour = () => {
    if (!newHour.description.trim() || !newHour.hours) return;
    updateClient((c) => ({ ...c, hours: { ...c.hours, log: [...c.hours.log, { id: Date.now(), date: today(), member: newHour.member, hours: Number(newHour.hours), description: newHour.description }] } }));
    setNewHour({ member: TEAM[0], hours: "", description: "" });
  };
  const addUserCount = () => {
    if (!newUserCount) return;
    updateClient((c) => ({ ...c, users: { log: [...c.users.log, { id: Date.now(), month: currentMonth(), count: Number(newUserCount) }] } }));
    setNewUserCount("");
  };
  const addContact = () => {
    if (!newContact.name.trim()) return;
    updateClient((c) => ({ ...c, contacts: [...(c.contacts || []), { id: Date.now(), ...newContact }] }));
    setNewContact({ name: "", role: "", email: "", phone: "" });
  };
  const removeContact = (id) => updateClient((c) => ({ ...c, contacts: c.contacts.filter((ct) => ct.id !== id) }));
  const toggleNoteTag = (person) => setNoteDraft((d) => ({ ...d, tags: d.tags.includes(person) ? d.tags.filter((p) => p !== person) : [...d.tags, person] }));
  const addNote = () => {
    if (!noteDraft.text.trim()) return;
    updateClient((c) => ({ ...c, notes: [...c.notes, { id: Date.now(), author: "You", date: today(), text: noteDraft.text, tags: noteDraft.tags }] }));
    noteDraft.tags.forEach((person) => pushNotification({
      forPerson: person, clientId: client.id, clientName: client.name,
      message: `Tagged on a note for ${client.name}: "${noteDraft.text.slice(0, 60)}${noteDraft.text.length > 60 ? "…" : ""}"`,
    }));
    setNoteDraft({ text: "", tags: [] });
  };
  const addReminder = () => {
    if (!newReminder.text.trim() || !newReminder.date) return;
    updateClient((c) => ({ ...c, reminders: [...c.reminders, { id: Date.now(), ...newReminder, done: false }] }));
    setNewReminder({ text: "", date: "", recurring: "none", assignee: TEAM[0] });
  };
  const toggleReminderDone = (id) => updateClient((c) => ({ ...c, reminders: c.reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)) }));
  const removeReminder = (id) => updateClient((c) => ({ ...c, reminders: c.reminders.filter((r) => r.id !== id) }));

  const dueIn = daysUntil(client.ohsmsDue);
  const urgency = dueIn < 0 ? { label: "Overdue", color: T.coral } : dueIn <= 30 ? { label: `Due in ${dueIn}d`, color: T.amber } : { label: "On track", color: T.tealDark };

  return (
    <div className="flex h-full gap-6">
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: T.paperAlt }}>
          <Search size={15} color={T.slate} />
          <input placeholder="Search clients" className="bg-transparent text-sm outline-none w-full" style={{ color: T.ink }} />
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {visibleClients.map((c) => {
            const d = daysUntil(c.ohsmsDue);
            const dot = d < 0 ? T.coral : d <= 30 ? T.amber : T.tealDark;
            return (
              <button key={c.id} onClick={() => setSelectedId(c.id)} className="text-left p-3 rounded-xl transition-colors"
                style={{ background: c.id === client.id ? T.paperAlt : T.card, border: `1px solid ${c.id === client.id ? T.tealDark : T.border}`, opacity: c.archived ? 0.6 : 1 }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: T.ink }}>{c.name}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
                </div>
                <div className="text-xs mt-1" style={{ color: T.slate }}>{c.contract.plan}</div>
              </button>
            );
          })}
          {visibleClients.length === 0 && <div className="text-xs text-center py-4" style={{ color: T.slateLight }}>{showArchived ? "No archived clients." : "No clients yet."}</div>}
        </div>
        {!showAddClient && (
          <button onClick={() => setShowAddClient(true)} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold mt-1" style={{ background: T.charcoal, color: T.teal }}>
            <Plus size={15} /> Add client
          </button>
        )}
        <button onClick={() => setShowArchived((v) => !v)} className="text-xs font-semibold text-center py-1" style={{ color: T.slate }}>
          {showArchived ? "Show active clients" : `Show archived (${clients.filter((c) => c.archived).length})`}
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {showAddClient ? (
          <Card style={{ padding: 24 }} className="overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold" style={{ color: T.ink }}>Add client</div>
              <button onClick={() => setShowAddClient(false)}><X size={18} color={T.slateLight} /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Name *</div>
                <input value={newClientForm.name} onChange={(e) => setNCF("name", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Legal name</div>
                <input value={newClientForm.legalName} onChange={(e) => setNCF("legalName", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Plan</div>
                <input value={newClientForm.plan} onChange={(e) => setNCF("plan", e.target.value)} placeholder="e.g. Full H&S Retainer" className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Billing type</div>
                <select value={newClientForm.billingType} onChange={(e) => setNCF("billingType", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  <option value="FlatFee">Flat fee only</option>
                  <option value="SubscriptionHours">Subscription + hours</option>
                  <option value="Hourly">Hourly</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Client profile</div>
                <select value={newClientForm.profile} onChange={(e) => setNCF("profile", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  {CLIENT_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Contract start</div>
                <input type="date" value={newClientForm.contractStart} onChange={(e) => setNCF("contractStart", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Contract renewal</div>
                <input type="date" value={newClientForm.contractRenewal} onChange={(e) => setNCF("contractRenewal", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Included hours / month</div>
                <input type="number" value={newClientForm.includedHours} onChange={(e) => setNCF("includedHours", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>OHSMS last issued</div>
                <input type="date" value={newClientForm.ohsmsLastIssued} onChange={(e) => setNCF("ohsmsLastIssued", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <div className="text-[11px] mt-1" style={{ color: T.slateLight }}>Renewal auto-sets to a year after this.</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Billing contact</div>
                <input value={newClientForm.billingContact} onChange={(e) => setNCF("billingContact", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Billing email</div>
                <input value={newClientForm.billingEmail} onChange={(e) => setNCF("billingEmail", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Billing terms</div>
                <input value={newClientForm.billingTerms} onChange={(e) => setNCF("billingTerms", e.target.value)} placeholder="e.g. Monthly, 20th" className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Billing status</div>
                <select value={newClientForm.billingStatus} onChange={(e) => setNCF("billingStatus", e.target.value)} className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  <option value="Current">Current</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowAddClient(false)} className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>Cancel</button>
              <button onClick={addClient} className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>Create client</button>
            </div>
          </Card>
        ) : (
          <>
        <Card style={{ padding: "20px 24px" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold" style={{ color: T.ink }}>{client.name}</div>
              <div className="text-sm" style={{ color: T.slate }}>{client.legalName}</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill color={urgency.color} bg={T.paperAlt}>OHSMS: {urgency.label}</Pill>
              {client.archived ? (
                <button onClick={() => unarchiveClient(client.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Unarchive</button>
              ) : (
                <button onClick={() => archiveClient(client.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>Archive</button>
              )}
              <button onClick={() => deleteClientPermanently(client.id)} title="Delete permanently"><Trash2 size={15} color={T.slateLight} /></button>
            </div>
          </div>
          <div className="flex gap-1 mt-5 border-b overflow-x-auto" style={{ borderColor: T.border }}>
            {[
              { id: "overview", label: "Overview", icon: Building2 },
              { id: "contract", label: "Contract", icon: CreditCard },
              { id: "billing", label: "Billing", icon: ClipboardList },
              { id: "onboarding", label: "Workflows", icon: ListChecks },
              { id: "notes", label: "Notes", icon: StickyNote },
              { id: "reminders", label: "Reminders", icon: Bell },
            ].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium -mb-px whitespace-nowrap"
                style={{ color: tab === t.id ? T.tealDark : T.slate, borderBottom: tab === t.id ? `2px solid ${T.tealDark}` : "2px solid transparent" }}>
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>
        </Card>

        <div className="flex-1 overflow-y-auto">
          {tab === "overview" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Card style={{ padding: 20 }}>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Plan</div>
                  <div className="text-base font-semibold mt-1" style={{ color: T.ink }}>{client.contract.plan}</div>
                </Card>
                <Card style={{ padding: 20 }}>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>OHSMS renewal</div>
                  <div className="text-base font-semibold mt-1" style={{ color: T.ink }}>{fmtDate(client.ohsmsDue)}</div>
                  <div className="text-sm mt-1" style={{ color: urgency.color }}>{urgency.label}</div>
                  <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${T.border}` }}>
                    <span className="text-[11px]" style={{ color: T.slateLight }}>Last issued</span>
                    <input type="date" value={client.ohsmsLastIssued || ""} onChange={(e) => updateClient((c) => ({ ...c, ohsmsLastIssued: e.target.value, ohsmsDue: addDays(e.target.value, 365) }))}
                      className="text-xs px-1.5 py-1 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    <button onClick={() => updateClient((c) => ({ ...c, ohsmsLastIssued: today(), ohsmsDue: addDays(today(), 365) }))}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                      Mark issued today
                    </button>
                  </div>
                </Card>
              </div>
              <Card style={{ padding: 20 }}>
                <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Contacts</div>
                <div className="flex flex-col gap-2 mb-3">
                  {(client.contacts || []).map((ct) => (
                    <div key={ct.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                      <div>
                        <span className="font-medium" style={{ color: T.ink }}>{ct.name}</span>
                        {ct.role && <span className="ml-2 text-xs" style={{ color: T.slate }}>{ct.role}</span>}
                        <div className="text-xs" style={{ color: T.slateLight }}>{[ct.email, ct.phone].filter(Boolean).join(" · ")}</div>
                      </div>
                      <button onClick={() => removeContact(ct.id)}><Trash2 size={14} color={T.slateLight} /></button>
                    </div>
                  ))}
                  {(!client.contacts || client.contacts.length === 0) && <div className="text-xs" style={{ color: T.slateLight }}>No contacts added yet.</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, width: 140 }} />
                  <input placeholder="Role" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, width: 120 }} />
                  <input placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, width: 170 }} />
                  <input placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, width: 120 }} />
                  <button onClick={addContact} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add contact</button>
                </div>
              </Card>
              {client.intake && (
                <Card style={{ padding: 20 }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Mail size={15} color={T.tealDark} />
                    <div className="text-sm font-semibold" style={{ color: T.ink }}>Sign-up form — submitted {fmtDate(client.intake.submittedDate)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
                    <div><div className="text-xs font-semibold" style={{ color: T.slate }}>CONTACT</div><div style={{ color: T.ink }}>{client.intake.contactName} &middot; {client.intake.contactEmail}</div></div>
                    <div><div className="text-xs font-semibold" style={{ color: T.slate }}>SUPPORT HOURS REQUESTED</div><div style={{ color: T.ink }}>{client.intake.supportHours} hrs / month</div></div>
                    <div className="col-span-2"><div className="text-xs font-semibold" style={{ color: T.slate }}>EXISTING WORK IN PLACE</div><div style={{ color: T.ink }}>{client.intake.existingWork}</div></div>
                    <div className="col-span-2">
                      <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>REQUESTED OHSMS SECTIONS</div>
                      <div className="flex flex-wrap gap-1.5">
                        {client.intake.requestedSections.map((s) => <Pill key={s} color={T.tealDark} bg={T.paperAlt}>{s}</Pill>)}
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === "contract" && (
            <Card style={{ padding: 20 }}>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>CONTRACT START</div><div style={{ color: T.ink }}>{fmtDate(client.contract.start)}</div></div>
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>RENEWAL</div><div style={{ color: T.ink }}>{fmtDate(client.contract.renewal)}</div></div>
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>BILLING CONTACT</div><div style={{ color: T.ink }}>{client.billing.contact}</div></div>
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>BILLING EMAIL</div><div style={{ color: T.ink }}>{client.billing.email}</div></div>
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>TERMS</div><div style={{ color: T.ink }}>{client.billing.terms}</div></div>
                <div><div className="text-xs font-semibold" style={{ color: T.slate }}>STATUS</div><Pill color={client.billing.status === "Overdue" ? T.coral : T.tealDark} bg={T.paperAlt}>{client.billing.status}</Pill></div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: T.slate }}>BILLING TYPE</div>
                  <select value={client.billingType || "FlatFee"} onChange={(e) => updateClient((c) => ({ ...c, billingType: e.target.value }))}
                    className="text-sm px-2 py-1 rounded-lg outline-none mt-0.5" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    <option value="FlatFee">Flat fee only — nothing to track</option>
                    <option value="SubscriptionHours">Subscription + hours to track</option>
                    <option value="Hourly">Hourly — billed against included hours</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: T.slate }}>CLIENT PROFILE</div>
                  <select value={client.profile || "Standard Client"} onChange={(e) => updateClient((c) => ({ ...c, profile: e.target.value }))}
                    className="text-sm px-2 py-1 rounded-lg outline-none mt-0.5" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {CLIENT_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </Card>
          )}

          {tab === "billing" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Pill color={billingTypeMeta[client.billingType || "FlatFee"].color} bg={T.paperAlt}>
                  {billingTypeMeta[client.billingType || "FlatFee"].label}
                </Pill>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Card style={{ padding: 16 }}>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Hours this month</div>
                  <div className="text-xl font-bold mt-1 flex items-center gap-1" style={{ color: T.ink }}>
                    {client.hours.log.filter((h) => h.date.slice(0, 7) === currentMonth()).reduce((s, h) => s + h.hours, 0)}
                    <span className="text-sm font-normal flex items-center gap-1" style={{ color: T.slate }}>
                      / <input type="number" value={client.hours.included} onChange={(e) => updateClient((c) => ({ ...c, hours: { ...c.hours, included: Number(e.target.value) || 0 } }))}
                        className="w-14 text-sm font-normal outline-none rounded px-1" style={{ color: T.slate, border: `1px solid transparent` }}
                        onFocus={(ev) => (ev.target.style.border = `1px solid ${T.border}`)} onBlur={(ev) => (ev.target.style.border = "1px solid transparent")} /> incl.
                    </span>
                  </div>
                </Card>
                <Card style={{ padding: 16 }}>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>App users this month</div>
                  <div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{client.users.log[client.users.log.length - 1]?.count ?? "—"}</div>
                </Card>
                <Card style={{ padding: 16 }}>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Open extras</div>
                  <div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{client.extras.filter((e) => e.status !== "Done").length}</div>
                </Card>
              </div>

              <Card style={{ padding: 16 }}>
                <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Monthly hours</div>
                <div className="flex flex-col gap-2 mb-3">
                  {client.hours.log.filter((h) => h.date.slice(0, 7) === currentMonth()).map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                      <div><span className="font-medium" style={{ color: T.ink }}>{h.member}</span><span className="ml-2" style={{ color: T.slate }}>{h.description}</span></div>
                      <div className="flex items-center gap-3 shrink-0"><span style={{ color: T.slate }}>{fmtDate(h.date)}</span><span className="font-bold" style={{ color: T.tealDark }}>{h.hours}h</span></div>
                    </div>
                  ))}
                  {client.hours.log.filter((h) => h.date.slice(0, 7) === currentMonth()).length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No hours logged yet this month.</div>}
                </div>
                <div className="flex items-center gap-2">
                  <select value={newHour.member} onChange={(e) => setNewHour({ ...newHour, member: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input placeholder="What was the work?" value={newHour.description} onChange={(e) => setNewHour({ ...newHour, description: e.target.value })}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <input placeholder="Hrs" value={newHour.hours} onChange={(e) => setNewHour({ ...newHour, hours: e.target.value })}
                    className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <button onClick={addHour} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log</button>
                </div>
                {client.hours.log.some((h) => h.date.slice(0, 7) !== currentMonth()) && (
                  <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${T.border}` }}>
                    <button onClick={() => setShowArchivedHours((v) => !v)} className="text-xs font-semibold" style={{ color: T.slate }}>
                      {showArchivedHours ? "Hide" : "Show"} previous months ({client.hours.log.filter((h) => h.date.slice(0, 7) !== currentMonth()).length})
                    </button>
                    {showArchivedHours && (
                      <div className="flex flex-col gap-2 mt-2">
                        {client.hours.log.filter((h) => h.date.slice(0, 7) !== currentMonth()).map((h) => (
                          <div key={h.id} className="flex items-center justify-between text-sm py-1.5" style={{ opacity: 0.6, borderBottom: `1px solid ${T.border}` }}>
                            <div><span className="font-medium" style={{ color: T.ink }}>{h.member}</span><span className="ml-2" style={{ color: T.slate }}>{h.description}</span></div>
                            <div className="flex items-center gap-3 shrink-0"><span style={{ color: T.slate }}>{fmtDate(h.date)}</span><span className="font-bold" style={{ color: T.slate }}>{h.hours}h</span></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card style={{ padding: 16 }}>
                <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>App users by month</div>
                <div className="flex flex-col gap-2 mb-3">
                  {client.users.log.map((u) => (
                    <div key={u.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ color: T.ink }}>{u.month}</span><span className="font-bold" style={{ color: T.tealDark }}>{u.count} users</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input placeholder="Users this month" value={newUserCount} onChange={(e) => setNewUserCount(e.target.value)}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <button onClick={addUserCount} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log</button>
                </div>
              </Card>

              <Card style={{ padding: 16 }}>
                <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Extra work requests</div>
                <div className="flex flex-col gap-2 mb-3">
                  {client.extras.map((e) => {
                    const meta = extraStatusMeta[e.status];
                    return (
                      <div key={e.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                        <div><span style={{ color: T.ink }}>{e.description}</span><span className="ml-2 text-xs" style={{ color: T.slateLight }}>{fmtDate(e.date)} &middot; {e.hours}h</span></div>
                        <button onClick={() => cycleExtraStatus(e.id)}><Pill color={meta.color} bg={meta.bg}>{e.status}</Pill></button>
                      </div>
                    );
                  })}
                  {client.extras.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No extra requests logged.</div>}
                </div>
                <div className="flex items-center gap-2">
                  <input placeholder="Describe the extra work requested" value={newExtra.description} onChange={(e) => setNewExtra({ ...newExtra, description: e.target.value })}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <input placeholder="Hrs" value={newExtra.hours} onChange={(e) => setNewExtra({ ...newExtra, hours: e.target.value })}
                    className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <button onClick={addExtra} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
                </div>
              </Card>
            </div>
          )}

          {tab === "onboarding" && (
            <ClientOnboarding client={client} onboardings={onboardings} updateOnboardingsForClient={updateOnboardingsForClient} workflows={workflows} pushNotification={pushNotification} goToWorkflows={goToWorkflows} />
          )}

          {tab === "notes" && (
            <div className="flex flex-col gap-3">
              <Card style={{ padding: 14 }}>
                <textarea placeholder="Write a client note..." rows={2} value={noteDraft.text} onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
                  className="w-full text-sm outline-none resize-none bg-transparent" style={{ color: T.ink }} />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] mr-1" style={{ color: T.slateLight }}>Tag:</span>
                    {TEAM.map((m) => (
                      <button key={m} onClick={() => toggleNoteTag(m)} className="text-[11px] font-semibold px-2 py-1 rounded-full"
                        style={{ background: noteDraft.tags.includes(m) ? T.tealDark : T.paperAlt, color: noteDraft.tags.includes(m) ? "#fff" : T.slate }}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <button onClick={addNote} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>Add note</button>
                </div>
              </Card>
              {client.notes.map((n) => (
                <Card key={n.id} style={{ padding: 14 }}>
                  <div className="flex justify-between text-xs mb-1.5" style={{ color: T.slate }}><span className="font-semibold">{n.author}</span><span>{fmtDate(n.date)}</span></div>
                  <div className="text-sm" style={{ color: T.ink }}>{n.text}</div>
                  {n.tags && n.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      {n.tags.map((t) => <Pill key={t} color={T.tealDark} bg={T.paperAlt}>@{t}</Pill>)}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {tab === "reminders" && (
            <div className="flex flex-col gap-3">
              {client.reminders.map((r) => (
                <Card key={r.id} style={{ padding: 14, opacity: r.done ? 0.55 : 1 }} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleReminderDone(r.id)}>
                      {r.done ? <CheckCircle2 size={16} color={T.tealDark} /> : <Circle size={16} color={T.slate} />}
                    </button>
                    <div>
                      <div className="text-sm font-medium" style={{ color: T.ink, textDecoration: r.done ? "line-through" : "none" }}>{r.text}</div>
                      <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: T.slate }}>
                        <span className="flex items-center gap-1" style={{ color: urgencyColor(r.date) }}><Calendar size={11} /> {fmtDate(r.date)}</span>
                        {r.recurring !== "none" && <span className="flex items-center gap-1"><Repeat size={11} /> {r.recurring}</span>}
                        <Pill color={T.tealDark} bg={T.paperAlt}>{r.assignee || "Unassigned"}</Pill>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => removeReminder(r.id)}><Trash2 size={14} color={T.slateLight} /></button>
                </Card>
              ))}
              {client.reminders.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No reminders yet.</div>}
              <Card style={{ padding: 14 }} className="flex items-center gap-2 flex-wrap">
                <input placeholder="Reminder" value={newReminder.text} onChange={(e) => setNewReminder({ ...newReminder, text: e.target.value })}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 160 }} />
                <input type="date" value={newReminder.date} onChange={(e) => setNewReminder({ ...newReminder, date: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <select value={newReminder.assignee} onChange={(e) => setNewReminder({ ...newReminder, assignee: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={newReminder.recurring} onChange={(e) => setNewReminder({ ...newReminder, recurring: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  <option value="none">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <button onClick={addReminder} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
              </Card>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

/* ---------- Systems / document builder ---------- */
function SystemsView({ clients, selectedId, setSelectedId }) {
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [builder, setBuilder] = useState("ohsms");
  const sections = builder === "ohsms" ? ohsmsSections : policySections;
  const [checked, setChecked] = useState(() => Object.fromEntries(sections.map((s) => [s.id, true])));
  const [logo, setLogo] = useState(null);
  const included = sections.filter((s) => checked[s.id]);

  return (
    <div className="flex h-full gap-6">
      <div className="w-64 shrink-0 flex flex-col gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Client</div>
          <select value={client.id} onChange={(e) => setSelectedId(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex rounded-lg p-1" style={{ background: T.paperAlt }}>
          {["ohsms", "policies"].map((b) => (
            <button key={b} onClick={() => setBuilder(b)} className="flex-1 text-xs font-semibold py-1.5 rounded-md"
              style={{ background: builder === b ? T.card : "transparent", color: builder === b ? T.tealDark : T.slate }}>
              {b === "ohsms" ? "OHSMS" : "Policies & Procedures"}
            </button>
          ))}
        </div>
        <Card style={{ padding: 16 }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Client logo</div>
          <button onClick={() => setLogo(logo ? null : "placeholder")} className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-lg text-xs"
            style={{ border: `1.5px dashed ${T.slateLight}`, color: T.slate, background: T.paperAlt }}>
            {logo ? <ImageIcon size={20} color={T.tealDark} /> : <Upload size={18} />}
            {logo ? "logo uploaded" : "Upload logo"}
          </button>

        </Card>
        <Card style={{ padding: 16 }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Redo reminder</div>
          <div className="text-sm font-medium" style={{ color: T.ink }}>{fmtDate(client.ohsmsDue)}</div>
          <div className="text-xs mt-1" style={{ color: T.slate }}>Auto-reminder fires 1 month prior</div>
          <div className="text-xs mt-3 pt-3" style={{ color: T.tealDark, borderTop: `1px solid ${T.border}` }}>
            Client form link →<br /><span style={{ color: T.slate }}>oshe.co.nz/renew/{client.id}</span>
          </div>
        </Card>
      </div>

      <div className="w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
        <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Sections {included.length}/{sections.length} selected</div>
        {sections.map((s) => (
          <button key={s.id} onClick={() => setChecked((c) => ({ ...c, [s.id]: !c[s.id] }))} className="flex items-start gap-3 p-3 rounded-lg text-left transition-colors"
            style={{ background: checked[s.id] ? T.paperAlt : T.card, border: `1px solid ${checked[s.id] ? T.tealDark : T.border}` }}>
            {checked[s.id] ? <CheckCircle2 size={17} color={T.tealDark} className="shrink-0 mt-0.5" /> : <Circle size={17} color={T.slateLight} className="shrink-0 mt-0.5" />}
            <div className="text-sm font-medium" style={{ color: T.ink }}>{s.title}</div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Live preview — {builder === "ohsms" ? "OHSMS Manual" : "Policies & Procedures"}</div>
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}`, background: "#fff", maxHeight: "calc(100% - 28px)", overflowY: "auto" }}>
          <div style={{ background: T.charcoal, padding: "36px 32px", color: "#fff" }}>
            <div className="w-16 h-16 rounded-md flex items-center justify-center mb-6" style={{ background: logo ? T.teal : "rgba(255,255,255,0.08)", border: "1px dashed rgba(255,255,255,0.3)" }}>
              {logo ? <ImageIcon size={22} color={T.charcoal} /> : <ImageIcon size={18} color="rgba(255,255,255,0.4)" />}
            </div>
            <div className="text-xs tracking-widest uppercase" style={{ color: T.teal }}>{builder === "ohsms" ? "Health & Safety Management System" : "Policies & Procedures"}</div>
            <div className="text-2xl font-bold mt-2">{client.name}</div>
            <div className="text-sm mt-1" style={{ color: "#9FB4B3" }}>Prepared by OSHE Limited &middot; {fmtDate(today())}</div>
          </div>
          <div className="p-6 flex flex-col gap-4">
            {included.length === 0 && <div className="text-sm text-center py-10" style={{ color: T.slateLight }}>No sections selected — tick items on the left to build the manual.</div>}
            {included.map((s, i) => (
              <div key={s.id}>
                <div className="text-sm font-bold" style={{ color: T.tealDark }}>{i + 1}. {s.title}</div>
                <div className="text-xs mt-1 leading-relaxed" style={{ color: T.slate }}>{s.blurb.replace("{{COMPANY}}", client.name)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sales pipeline ---------- */
function SalesView({ leads, convertLeadToClient }) {
  const [emailDrafts, setEmailDrafts] = useState({});
  const [expandedNotes, setExpandedNotes] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLead, setNewLead] = useState({ company: "", contact: "", value: "" });

  const setStage = (id, stage) => updateDoc(doc(db, "leads", id), { stage });

  const sendForm = (lead) => {
    const email = emailDrafts[lead.id];
    if (!email) return;
    updateDoc(doc(db, "leads", lead.id), { formEmail: email, formStatus: "sent" });
  };

  const addLead = async () => {
    if (!newLead.company.trim()) return;
    const id = "lead" + Date.now();
    await setDoc(doc(db, "leads", id), {
      company: newLead.company, contact: newLead.contact, value: newLead.value,
      stage: "New Lead", formEmail: null, formStatus: "none", notes: [],
    });
    setNewLead({ company: "", contact: "", value: "" });
    setShowAddLead(false);
  };

  const addNote = (leadId) => {
    const text = noteDrafts[leadId];
    if (!text || !text.trim()) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    updateDoc(doc(db, "leads", leadId), { notes: [...lead.notes, { id: Date.now(), text, date: today() }] });
    setNoteDrafts({ ...noteDrafts, [leadId]: "" });
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setShowAddLead((v) => !v)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: T.charcoal, color: T.teal }}>
          <Plus size={16} /> Add lead
        </button>
        {showAddLead && (
          <Card style={{ padding: 12 }} className="flex items-center gap-2 flex-1 ml-4">
            <input placeholder="Company" value={newLead.company} onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
              className="flex-1 text-sm px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <input placeholder="Contact name" value={newLead.contact} onChange={(e) => setNewLead({ ...newLead, contact: e.target.value })}
              className="flex-1 text-sm px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <input placeholder="Est. value" value={newLead.value} onChange={(e) => setNewLead({ ...newLead, value: e.target.value })}
              className="w-28 text-sm px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <button onClick={addLead} className="text-xs font-semibold px-3 py-2 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Save</button>
          </Card>
        )}
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto min-h-0">
        {stageOrder.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          const meta = stageMeta[stage];
          return (
            <div key={stage} className="w-72 shrink-0 flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color }} /><span className="text-sm font-semibold" style={{ color: T.ink }}>{stage}</span></div>
                <span className="text-xs font-semibold" style={{ color: T.slate }}>{items.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto">
                {items.map((l) => (
                  <Card key={l.id} style={{ padding: 12, borderTop: `3px solid ${meta.color}` }}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold" style={{ color: T.ink }}>{l.company}</div>
                      <select value={l.stage} onChange={(e) => setStage(l.id, e.target.value)}
                        className="text-[11px] px-1.5 py-1 rounded-md outline-none" style={{ border: `1px solid ${T.border}`, color: T.slate, background: T.paperAlt }}>
                        {stageOrder.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: T.slate }}>{l.contact}</div>
                    <div className="text-xs font-bold mt-1.5" style={{ color: T.tealDark }}>{l.value}</div>

                    {stage === "Won" && l.formStatus === "none" && (
                      <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${T.border}` }}>
                        <input placeholder="Client email for sign-up form" value={emailDrafts[l.id] || ""} onChange={(e) => setEmailDrafts({ ...emailDrafts, [l.id]: e.target.value })}
                          className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                        <button onClick={() => sendForm(l)} className="flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>
                          <Mail size={12} /> Send sign-up form
                        </button>
                      </div>
                    )}
                    {stage === "Won" && l.formStatus === "sent" && (
                      <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${T.border}` }}>
                        <div className="text-xs" style={{ color: T.amber }}>Awaiting client form &middot; sent to {l.formEmail}</div>
                        <div className="flex items-center gap-1.5">
                          <input readOnly value={`${window.location.origin}/signup/${l.id}`}
                            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.slate, background: T.paperAlt }} />
                          <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/signup/${l.id}`)}
                            className="text-xs font-semibold px-2 py-1.5 rounded-lg shrink-0" style={{ background: T.paperAlt, color: T.tealDark }}>Copy</button>
                        </div>
                        <div className="text-[11px]" style={{ color: T.slateLight }}>Automated emailing isn't live yet — copy this link and send it yourself for now.</div>
                        <button onClick={() => convertLeadToClient(l)} className="flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                          <ArrowUpRight size={12} /> Simulate form completed
                        </button>
                      </div>
                    )}

                    <button onClick={() => setExpandedNotes({ ...expandedNotes, [l.id]: !expandedNotes[l.id] })}
                      className="flex items-center gap-1.5 text-[11px] font-semibold mt-3 pt-2" style={{ color: T.slate, borderTop: `1px solid ${T.border}` }}>
                      <StickyNote size={12} /> {l.notes.length > 0 ? `${l.notes.length} note${l.notes.length > 1 ? "s" : ""}` : "Add note"}
                    </button>
                    {expandedNotes[l.id] && (
                      <div className="flex flex-col gap-1.5 mt-2">
                        {l.notes.map((n) => (
                          <div key={n.id} className="text-xs rounded-lg p-2" style={{ background: T.paperAlt, color: T.ink }}>
                            {n.text}<div className="text-[10px] mt-0.5" style={{ color: T.slateLight }}>{fmtDate(n.date)}</div>
                          </div>
                        ))}
                        <div className="flex items-center gap-1.5">
                          <input placeholder="Note..." value={noteDrafts[l.id] || ""} onChange={(e) => setNoteDrafts({ ...noteDrafts, [l.id]: e.target.value })}
                            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                          <button onClick={() => addNote(l.id)} className="text-[11px] font-semibold px-2 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
                {items.length === 0 && <div className="text-xs text-center py-4" style={{ color: T.slateLight }}>Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Resellers (consultants who resell the app, billed per user) ---------- */
function ResellersView({ resellers, selectedId, setSelectedId }) {
  const reseller = resellers.find((r) => r.id === selectedId) || resellers[0];
  const [showAddReseller, setShowAddReseller] = useState(false);
  const [newResellerName, setNewResellerName] = useState("");
  const [newClient, setNewClient] = useState({ name: "", users: "" });
  const [expandedResellerClients, setExpandedResellerClients] = useState({});
  const toggleResellerClientHistory = (id) => setExpandedResellerClients((prev) => ({ ...prev, [id]: !prev[id] }));
  const [newTask, setNewTask] = useState({ text: "", assignee: TEAM[0] });
  const [showArchived, setShowArchived] = useState(false);
  const visibleResellers = resellers.filter((r) => (showArchived ? r.archived : !r.archived));

  const updateReseller = (fn) => {
    const updated = fn(reseller);
    const { id, ...fields } = updated;
    updateDoc(doc(db, "resellers", reseller.id), fields);
  };
  const latestUsers = (c) => c.users.log[c.users.log.length - 1]?.count ?? 0;
  const totalUsers = reseller.clients.reduce((s, c) => s + latestUsers(c), 0);

  const archiveReseller = (id) => updateDoc(doc(db, "resellers", id), { archived: true });
  const unarchiveReseller = (id) => updateDoc(doc(db, "resellers", id), { archived: false });
  const deleteResellerPermanently = (id) => {
    if (!window.confirm("Permanently delete this reseller? This can't be undone.")) return;
    deleteDoc(doc(db, "resellers", id));
    if (id === reseller.id) {
      const next = resellers.find((r) => r.id !== id);
      if (next) setSelectedId(next.id);
    }
  };

  const addReseller = async () => {
    if (!newResellerName.trim()) return;
    const id = "res" + Date.now();
    await setDoc(doc(db, "resellers", id), { name: newResellerName, contactEmail: "", contactPhone: "", clients: [], tasks: [], archived: false });
    setSelectedId(id);
    setNewResellerName("");
    setShowAddReseller(false);
  };

  const addResellerClient = () => {
    if (!newClient.name.trim()) return;
    updateReseller((r) => ({
      ...r,
      clients: [...r.clients, { id: Date.now(), name: newClient.name, users: { log: newClient.users ? [{ id: Date.now(), month: currentMonth(), count: Number(newClient.users) }] : [] } }],
    }));
    setNewClient({ name: "", users: "" });
  };
  const removeResellerClient = (clientId) => updateReseller((r) => ({ ...r, clients: r.clients.filter((c) => c.id !== clientId) }));
  const logResellerClientUsers = (clientId, count) => {
    if (!count) return;
    updateReseller((r) => ({ ...r, clients: r.clients.map((c) => (c.id === clientId ? { ...c, users: { log: [...c.users.log, { id: Date.now(), month: currentMonth(), count: Number(count) }] } } : c)) }));
  };

  const addTask = () => {
    if (!newTask.text.trim()) return;
    updateReseller((r) => ({ ...r, tasks: [...r.tasks, { id: Date.now(), text: newTask.text, assignee: newTask.assignee, done: false, date: today() }] }));
    setNewTask({ text: "", assignee: TEAM[0] });
  };
  const toggleTask = (taskId) => updateReseller((r) => ({ ...r, tasks: r.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }));
  const removeTask = (taskId) => updateReseller((r) => ({ ...r, tasks: r.tasks.filter((t) => t.id !== taskId) }));

  return (
    <div className="flex h-full gap-6">
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="flex flex-col gap-2 overflow-y-auto">
          {visibleResellers.map((r) => {
            const activeCount = r.clients.filter((c) => c.users.log.some((u) => u.month === currentMonth())).length;
            const total = r.clients.reduce((s, c) => s + latestUsers(c), 0);
            return (
              <button key={r.id} onClick={() => setSelectedId(r.id)} className="text-left p-3 rounded-xl transition-colors"
                style={{ background: r.id === reseller.id ? T.paperAlt : T.card, border: `1px solid ${r.id === reseller.id ? T.tealDark : T.border}`, opacity: r.archived ? 0.6 : 1 }}>
                <div className="text-sm font-semibold" style={{ color: T.ink }}>{r.name}</div>
                <div className="text-xs mt-1" style={{ color: T.slate }}>{activeCount} client{activeCount !== 1 ? "s" : ""} this month &middot; {total} users</div>
              </button>
            );
          })}
          {visibleResellers.length === 0 && <div className="text-xs text-center py-4" style={{ color: T.slateLight }}>{showArchived ? "No archived resellers." : "No resellers yet."}</div>}
        </div>
        {showAddReseller ? (
          <Card style={{ padding: 12 }} className="flex items-center gap-2">
            <input placeholder="Reseller name" value={newResellerName} onChange={(e) => setNewResellerName(e.target.value)}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <button onClick={addReseller} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Save</button>
          </Card>
        ) : (
          <button onClick={() => setShowAddReseller(true)} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold" style={{ background: T.charcoal, color: T.teal }}>
            <Plus size={15} /> Add reseller
          </button>
        )}
        <button onClick={() => setShowArchived((v) => !v)} className="text-xs font-semibold text-center py-1" style={{ color: T.slate }}>
          {showArchived ? "Show active resellers" : `Show archived (${resellers.filter((r) => r.archived).length})`}
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-y-auto">
        <Card style={{ padding: "20px 24px" }}>
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold" style={{ color: T.ink }}>{reseller.name}</div>
            <div className="flex items-center gap-2">
              <Pill color={T.tealDark} bg={T.paperAlt}>{totalUsers} users this month</Pill>
              {reseller.archived ? (
                <button onClick={() => unarchiveReseller(reseller.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Unarchive</button>
              ) : (
                <button onClick={() => archiveReseller(reseller.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>Archive</button>
              )}
              <button onClick={() => deleteResellerPermanently(reseller.id)} title="Delete permanently"><Trash2 size={15} color={T.slateLight} /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Contact email</div>
              <input value={reseller.contactEmail} onChange={(e) => updateReseller((r) => ({ ...r, contactEmail: e.target.value }))}
                className="text-sm mt-1 w-full outline-none rounded-lg px-1 -ml-1" style={{ color: T.ink, border: "1px solid transparent" }}
                onFocus={(ev) => (ev.target.style.border = `1px solid ${T.border}`)} onBlur={(ev) => (ev.target.style.border = "1px solid transparent")} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Contact phone</div>
              <input value={reseller.contactPhone} onChange={(e) => updateReseller((r) => ({ ...r, contactPhone: e.target.value }))}
                className="text-sm mt-1 w-full outline-none rounded-lg px-1 -ml-1" style={{ color: T.ink, border: "1px solid transparent" }}
                onFocus={(ev) => (ev.target.style.border = `1px solid ${T.border}`)} onBlur={(ev) => (ev.target.style.border = "1px solid transparent")} />
            </div>
          </div>
        </Card>

        <Card style={{ padding: 16 }}>
          <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Their clients</div>
          <div className="flex flex-col gap-2 mb-3">
            {reseller.clients.map((c) => (
              <div key={c.id} style={{ borderBottom: `1px solid ${T.border}` }} className="py-1.5">
                <div className="flex items-center justify-between text-sm">
                  <button onClick={() => toggleResellerClientHistory(c.id)} className="flex items-center gap-1.5" style={{ color: T.ink }}>
                    <ChevronDown size={13} color={T.slateLight} style={{ transform: expandedResellerClients[c.id] ? "none" : "rotate(-90deg)" }} />
                    {c.name}
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="font-bold" style={{ color: T.tealDark }}>{latestUsers(c)} users</span>
                    <input type="number" placeholder="New count" onKeyDown={(e) => { if (e.key === "Enter") { logResellerClientUsers(c.id, e.target.value); e.target.value = ""; } }}
                      className="w-24 text-xs px-2 py-1 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    <button onClick={() => removeResellerClient(c.id)}><Trash2 size={14} color={T.slateLight} /></button>
                  </div>
                </div>
                {expandedResellerClients[c.id] && (
                  <div className="mt-2 mb-1 rounded-lg" style={{ background: T.paperAlt, border: `1px solid ${T.border}` }}>
                    {[...c.users.log].reverse().map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-xs px-3 py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ color: T.slate }}>{u.month}</span>
                        <span className="font-semibold" style={{ color: T.ink }}>{u.count} users</span>
                      </div>
                    ))}
                    {c.users.log.length === 0 && <div className="text-xs px-3 py-2" style={{ color: T.slateLight }}>No history logged yet.</div>}
                  </div>
                )}
              </div>
            ))}
            {reseller.clients.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No clients logged for this reseller yet.</div>}
          </div>
          <div className="flex items-center gap-2">
            <input placeholder="Client name" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <input placeholder="Users" value={newClient.users} onChange={(e) => setNewClient({ ...newClient, users: e.target.value })}
              className="w-20 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <button onClick={addResellerClient} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
          </div>

        </Card>

        <Card style={{ padding: 16 }}>
          <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Requests &amp; things to consider</div>
          <div className="flex flex-col gap-2 mb-3">
            {reseller.tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${T.border}`, opacity: t.done ? 0.55 : 1 }}>
                <div className="flex items-center gap-2.5">
                  <button onClick={() => toggleTask(t.id)}>{t.done ? <CheckCircle2 size={16} color={T.tealDark} /> : <Circle size={16} color={T.slate} />}</button>
                  <div>
                    <div className="text-sm" style={{ color: T.ink, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</div>
                    <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: T.slate }}>
                      <Pill color={T.tealDark} bg={T.paperAlt}>{t.assignee}</Pill>
                      {t.date && <span className="flex items-center gap-1" style={{ color: urgencyColor(t.date) }}><Calendar size={10} /> {fmtDate(t.date)}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => removeTask(t.id)}><Trash2 size={14} color={T.slateLight} /></button>
              </div>
            ))}
            {reseller.tasks.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing outstanding for this reseller.</div>}
          </div>
          <div className="flex items-center gap-2">
            <input placeholder="What do we need to do or decide?" value={newTask.text} onChange={(e) => setNewTask({ ...newTask, text: e.target.value })}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
            <select value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}
              className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
              {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={addTask} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Billing overview (all clients) ---------- */
function BillingOverview({ clients, resellers }) {
  const [showFlatFee, setShowFlatFee] = useState(false);
  const newClients = clients.filter((c) => c.billingSetupDone === false);
  const setUpClients = clients.filter((c) => c.billingSetupDone !== false);
  const hasHoursThisMonth = (c) => c.hours.log.some((h) => h.date.slice(0, 7) === currentMonth());

  const needsAttention = setUpClients.filter((c) => (c.billingType || "FlatFee") !== "FlatFee" || hasHoursThisMonth(c)).map((c) => ({
    id: c.id, name: c.name, type: c.billingType || "FlatFee", adHoc: (c.billingType || "FlatFee") === "FlatFee",
    logged: c.hours.log.filter((h) => h.date.slice(0, 7) === currentMonth()).reduce((s, h) => s + h.hours, 0),
    included: c.hours.included,
    users: c.users.log[c.users.log.length - 1]?.count ?? 0,
    status: c.billing.status,
  }));
  const flatFeeRows = setUpClients.filter((c) => (c.billingType || "FlatFee") === "FlatFee" && !hasHoursThisMonth(c)).map((c) => ({
    id: c.id, name: c.name,
    plan: c.contract.plan,
    users: c.users.log[c.users.log.length - 1]?.count ?? 0,
    openExtras: c.extras.filter((e) => e.status !== "Done").length,
    status: c.billing.status,
  }));
  const totalHours = needsAttention.reduce((s, r) => s + r.logged, 0);
  const totalUsers = [...needsAttention, ...flatFeeRows].reduce((s, r) => s + r.users, 0);

  const markBillingSetUp = (id) => updateDoc(doc(db, "clients", id), { billingSetupDone: true });

  // A reseller's client count is "how many of their clients logged a user count this month", not a running total of everyone ever added.
  const billingActiveClients = (r) => r.clients.filter((c) => c.users.log.some((u) => u.month === currentMonth()));
  const resellerRows = resellers.map((r) => {
    const active = billingActiveClients(r);
    return { id: r.id, name: r.name, clientCount: active.length, users: active.reduce((s, c) => s + (c.users.log[c.users.log.length - 1]?.count ?? 0), 0) };
  });
  const resellerTotalUsers = resellerRows.reduce((s, r) => s + r.users, 0);

  return (
    <div className="flex flex-col gap-4">
      {newClients.length > 0 && (
        <Card style={{ padding: 16, borderLeft: `3px solid ${T.amber}` }}>
          <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>New clients — set up for billing</div>
          <div className="text-xs mb-3" style={{ color: T.slate }}>Came through the sign-up form this month and still need adding in Xero. Clear each once it's done.</div>
          <div className="flex flex-col gap-2">
            {newClients.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                <div>
                  <span className="text-sm font-medium" style={{ color: T.ink }}>{c.name}</span>
                  <span className="ml-2 text-xs" style={{ color: T.slateLight }}>{c.billing.contact} &middot; {c.billing.email}</span>
                </div>
                <button onClick={() => markBillingSetUp(c.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Added to Xero</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Hours logged this month</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{totalHours}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Total direct app users</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{totalUsers}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Clients with hours to review</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{needsAttention.length}</div></Card>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Clients with hours to review — Hourly &amp; Subscription + Hours</div>
      <Card style={{ padding: 0 }}>
        <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1.3fr 1fr 1fr 1fr 1fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
          <div>Client</div><div>Type</div><div>Hours logged</div><div>Included</div><div>Over / under</div><div>Users</div><div>Status</div>
        </div>
        {needsAttention.map((r) => {
          const diff = r.included > 0 ? r.logged - r.included : null;
          return (
            <div key={r.id} className="grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: "2fr 1.3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ color: T.ink }} className="font-medium">{r.name}</div>
              <div><Pill color={r.adHoc ? T.amber : billingTypeMeta[r.type].color} bg={T.paperAlt}>{r.adHoc ? "Flat + ad-hoc" : r.type === "Hourly" ? "Hourly" : "Sub + hours"}</Pill></div>
              <div style={{ color: T.ink }}>{r.logged}h</div>
              <div style={{ color: T.slate }}>{r.included > 0 ? `${r.included}h` : "—"}</div>
              <div style={{ color: diff === null ? T.slateLight : diff > 0 ? T.coral : T.tealDark }}>{diff === null ? "—" : diff > 0 ? `+${diff}h` : `${diff}h`}</div>
              <div style={{ color: T.ink }}>{r.users}</div>
              <div><Pill color={r.status === "Overdue" ? T.coral : T.tealDark} bg={T.paperAlt}>{r.status}</Pill></div>
            </div>
          );
        })}
        {needsAttention.length === 0 && <div className="text-xs px-4 py-3" style={{ color: T.slateLight }}>Nothing needs hours reviewed right now.</div>}
      </Card>

      <button onClick={() => setShowFlatFee((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold mt-2" style={{ color: T.slate }}>
        <ListChecks size={13} /> {showFlatFee ? "Hide" : "Show"} flat-fee clients ({flatFeeRows.length})
      </button>
      {showFlatFee && (
        <Card style={{ padding: 0 }}>
          <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
            <div>Client</div><div>Plan</div><div>Users</div><div>Open extras</div><div>Status</div>
          </div>
          {flatFeeRows.map((r) => (
            <div key={r.id} className="grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ color: T.ink }} className="font-medium">{r.name}</div>
              <div style={{ color: T.slate }}>{r.plan}</div>
              <div style={{ color: T.ink }}>{r.users}</div>
              <div style={{ color: r.openExtras > 0 ? T.amber : T.slateLight }}>{r.openExtras}</div>
              <div><Pill color={r.status === "Overdue" ? T.coral : T.tealDark} bg={T.paperAlt}>{r.status}</Pill></div>
            </div>
          ))}
          {flatFeeRows.length === 0 && <div className="text-xs px-4 py-3" style={{ color: T.slateLight }}>No flat-fee clients right now.</div>}
        </Card>
      )}


      <div className="text-xs font-semibold uppercase tracking-wide mt-2" style={{ color: T.slate }}>Resellers — billed per user</div>
      <div className="grid grid-cols-3 gap-4">
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Resellers</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{resellerRows.length}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Reseller users this month</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{resellerTotalUsers}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Their billing clients this month</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{resellerRows.reduce((s, r) => s + r.clientCount, 0)}</div></Card>
      </div>
      <Card style={{ padding: 0 }}>
        <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
          <div>Reseller</div><div>Clients this month</div><div>Users to bill</div>
        </div>
        {resellerRows.map((r) => (
          <div key={r.id} className="grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: "2fr 1fr 1fr", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ color: T.ink }} className="font-medium">{r.name}</div>
            <div style={{ color: T.slate }}>{r.clientCount}</div>
            <div style={{ color: T.tealDark }} className="font-bold">{r.users}</div>
          </div>
        ))}
        {resellerRows.length === 0 && <div className="text-xs px-4 py-3" style={{ color: T.slateLight }}>No resellers yet.</div>}
      </Card>

    </div>
  );
}

/* ---------- My Tasks (per person) ---------- */
function TasksView({ tasks, clients, onboardings, currentUser, goToClient, resellers, goToReseller }) {
  const [person, setPerson] = useState(currentUser || TEAM[0]);
  const [draft, setDraft] = useState({ title: "", priority: "Medium", clientId: "", dueDate: "" });

  const resellerTasks = useMemo(() => {
    const out = [];
    resellers.forEach((r) => {
      r.tasks.filter((t) => !t.done && t.assignee === person).forEach((t) => {
        out.push({ id: `res-${r.id}-${t.id}`, title: t.text, resellerId: r.id, resellerName: r.name, dueDate: t.date });
      });
    });
    return out;
  }, [resellers, person]);

  const onboardingTasks = useMemo(() => {
    const out = [];
    clients.forEach((c) => {
      const list = onboardings[c.id] || [];
      list.filter((i) => !i.completedDate).forEach((inst) => {
        const currentIdx = inst.steps.findIndex((s) => !s.done);
        if (currentIdx === -1) return;
        const step = inst.steps[currentIdx];
        if (step.owner === person) out.push({ id: `ob-${inst.id}-${step.id}`, title: step.title, clientId: c.id, clientName: c.name, workflowName: inst.workflowName, dueDate: step.dueDate, isOnboarding: true });
      });
    });
    return out;
  }, [clients, onboardings, person]);

  const reminderTasks = useMemo(() => {
    const out = [];
    clients.forEach((c) => {
      c.reminders.filter((r) => !r.done && r.assignee === person).forEach((r) => {
        out.push({ id: `rem-${c.id}-${r.id}`, title: r.text, clientId: c.id, clientName: c.name, dueDate: r.date });
      });
    });
    return out;
  }, [clients, person]);

  const myTasksAll = tasks.filter((t) => t.assignee === person);
  const activeTasks = myTasksAll.filter((t) => !t.done);
  const completedTasks = myTasksAll.filter((t) => t.done);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  const addTask = () => {
    if (!draft.title.trim()) return;
    const clientName = clients.find((c) => c.id === draft.clientId)?.name || null;
    const id = "task" + Date.now();
    setDoc(doc(db, "tasks", id), { title: draft.title, assignee: person, priority: draft.priority, done: false, clientId: draft.clientId || null, clientName, dueDate: draft.dueDate || null });
    setDraft({ title: "", priority: "Medium", clientId: "", dueDate: "" });
  };
  const toggleDone = (id) => {
    const t = tasks.find((x) => x.id === id);
    if (t) updateDoc(doc(db, "tasks", id), { done: !t.done });
  };
  const deleteTaskPermanently = (id) => deleteDoc(doc(db, "tasks", id));
  const setPriority = (id, priority) => updateDoc(doc(db, "tasks", id), { priority });

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      <div className="flex rounded-lg p-1 w-full max-w-md" style={{ background: T.paperAlt }}>
        {TEAM.map((m) => (
          <button key={m} onClick={() => setPerson(m)} className="flex-1 text-xs font-semibold py-1.5 rounded-md"
            style={{ background: person === m ? T.card : "transparent", color: person === m ? T.tealDark : T.slate }}>
            {m}
          </button>
        ))}
      </div>

      {onboardingTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>From workflows</div>
          {onboardingTasks.map((t) => (
            <Card key={t.id} onClick={() => goToClient(t.clientId, "onboarding")} style={{ padding: 14, borderLeft: `3px solid ${T.tealDark}`, cursor: "pointer" }} className="flex items-center justify-between hover:opacity-80">
              <div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                  <span>{t.clientName}</span>
                  <span style={{ color: T.slateLight }}>&middot; {t.workflowName}</span>
                  {t.dueDate && <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {daysUntil(t.dueDate) < 0 ? `Overdue · ${fmtDate(t.dueDate)}` : fmtDate(t.dueDate)}</span>}
                </div>
              </div>
              <Pill color={T.tealDark} bg={T.paperAlt}>Workflow</Pill>
            </Card>
          ))}
        </div>
      )}

      {reminderTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>From reminders</div>
          {reminderTasks.map((t) => (
            <Card key={t.id} onClick={() => goToClient(t.clientId, "reminders")} style={{ padding: 14, borderLeft: `3px solid ${T.amber}`, cursor: "pointer" }} className="flex items-center justify-between hover:opacity-80">
              <div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                  <span>{t.clientName}</span>
                  <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {daysUntil(t.dueDate) < 0 ? `Overdue · ${fmtDate(t.dueDate)}` : fmtDate(t.dueDate)}</span>
                </div>
              </div>
              <Pill color={T.amber} bg={T.paperAlt}>Reminder</Pill>
            </Card>
          ))}
        </div>
      )}

      {resellerTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>From resellers</div>
          {resellerTasks.map((t) => (
            <Card key={t.id} onClick={() => goToReseller(t.resellerId)} style={{ padding: 14, borderLeft: `3px solid ${T.blue}`, cursor: "pointer" }} className="flex items-center justify-between hover:opacity-80">
              <div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                  <span>{t.resellerName}</span>
                  {t.dueDate && <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {daysUntil(t.dueDate) < 0 ? `Overdue · ${fmtDate(t.dueDate)}` : fmtDate(t.dueDate)}</span>}
                </div>
              </div>
              <Pill color={T.blue} bg={T.paperAlt}>Reseller</Pill>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Tasks</div>
        {activeTasks.map((t) => {
          const meta = priorityMeta[t.priority];
          const clickable = Boolean(t.clientId);
          return (
            <Card key={t.id} onClick={() => clickable && goToClient(t.clientId, "overview")}
              style={{ padding: 14, cursor: clickable ? "pointer" : "default" }}
              className={"flex items-center justify-between" + (clickable ? " hover:opacity-80" : "")}>
              <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }}><Circle size={18} color={T.slateLight} /></button>
                <div>
                  <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                  {(t.clientName || t.dueDate) && (
                    <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                      {t.clientName && <span>{t.clientName}</span>}
                      {t.dueDate && <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {fmtDate(t.dueDate)}</span>}
                    </div>
                  )}
                </div>
              </div>
              <select value={t.priority} onClick={(e) => e.stopPropagation()} onChange={(e) => setPriority(t.id, e.target.value)} className="text-xs font-semibold px-2.5 py-1 rounded-full outline-none border-none"
                style={{ color: meta.color, background: meta.bg }}>
                {Object.keys(priorityMeta).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Card>
          );
        })}
        {activeTasks.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No tasks assigned.</div>}
      </div>

      {completedTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <button onClick={() => setShowCompletedTasks((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: T.slate }}>
            <ListChecks size={13} /> {showCompletedTasks ? "Hide" : "Show"} completed ({completedTasks.length})
          </button>
          {showCompletedTasks && completedTasks.map((t) => (
            <Card key={t.id} style={{ padding: 14, opacity: 0.6 }} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => toggleDone(t.id)}><CheckCircle2 size={18} color={T.tealDark} /></button>
                <div className="text-sm font-medium" style={{ color: T.ink, textDecoration: "line-through" }}>{t.title}</div>
              </div>
              <button onClick={() => deleteTaskPermanently(t.id)}><Trash2 size={14} color={T.slateLight} /></button>
            </Card>
          ))}
        </div>
      )}

      <Card style={{ padding: 14 }} className="flex items-center gap-2 flex-wrap">
        <input placeholder={`Add a task for ${person}`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="flex-1 text-sm px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 160 }} />
        <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
          className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
        <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
          {Object.keys(priorityMeta).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={addTask} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
      </Card>
    </div>
  );
}

/* ---------- Notifications bell ---------- */
function NotificationsBell({ notifications, dismissNotification, reminderCount, currentUser }) {
  const [open, setOpen] = useState(false);
  const active = notifications.filter((n) => !n.dismissed && n.forPerson === currentUser);
  const dismiss = (id) => dismissNotification(id);

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: T.paperAlt }}>
        <Bell size={14} color={T.slate} />
        <span className="text-xs font-medium" style={{ color: T.ink }}>{active.length + reminderCount} updates</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 rounded-xl z-10" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide px-4 pt-3 pb-2" style={{ color: T.slate }}>Notifications for {currentUser}</div>
          {active.length === 0 && <div className="text-xs px-4 pb-3" style={{ color: T.slateLight }}>Nothing waiting.</div>}
          {active.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2 px-4 py-2.5" style={{ borderTop: `1px solid ${T.border}` }}>
              <div className="text-xs" style={{ color: T.ink }}>{n.message}</div>
              <button onClick={() => dismiss(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0" style={{ background: T.paperAlt, color: T.tealDark }}>
                {n.type === "handover" ? "Added to Xero" : "Got it"}
              </button>
            </div>
          ))}
          <div className="text-xs px-4 py-2.5" style={{ color: T.slate, borderTop: `1px solid ${T.border}` }}>{reminderCount} reminders due within 2 weeks</div>
        </div>
      )}
    </div>
  );
}

/* ---------- Workflows (onboarding templates, managed on-site) ---------- */
function WorkflowsView({ workflows }) {
  const addWorkflow = () => {
    const id = "wf-" + Date.now();
    setDoc(doc(db, "workflows", id), { name: "New Workflow", isDefault: false, steps: [{ id: "step" + Date.now(), title: "First step", owner: TEAM[0], dueDays: 3 }] });
  };
  const removeWorkflow = (id) => deleteDoc(doc(db, "workflows", id));
  const setDefault = (id) => {
    workflows.forEach((w) => updateDoc(doc(db, "workflows", w.id), { isDefault: w.id === id }));
  };
  const updateWorkflow = (id, fn) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return;
    const updated = fn(wf);
    const { id: _id, ...fields } = updated;
    updateDoc(doc(db, "workflows", id), fields);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-end">
        <button onClick={addWorkflow} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold shrink-0" style={{ background: T.charcoal, color: T.teal }}>
          <Plus size={15} /> New workflow
        </button>
      </div>

      {workflows.map((wf) => (
        <Card key={wf.id} style={{ padding: 18 }}>
          <div className="flex items-center justify-between mb-4">
            <input value={wf.name} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, name: e.target.value }))}
              className="text-base font-bold px-2 py-1 rounded-lg outline-none -ml-2" style={{ color: T.ink, border: "1px solid transparent" }}
              onFocus={(e) => (e.target.style.border = `1px solid ${T.border}`)} onBlur={(e) => (e.target.style.border = "1px solid transparent")} />
            <div className="flex items-center gap-2">
              {wf.isDefault ? <Pill color={T.tealDark} bg={T.paperAlt}>Default for new clients</Pill> : (
                <button onClick={() => setDefault(wf.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Make default</button>
              )}
              <button onClick={() => removeWorkflow(wf.id)}><Trash2 size={15} color={T.slateLight} /></button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {wf.steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-xs font-semibold" style={{ color: T.slateLight }}>{i + 1}</span>
                <input value={step.title} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, title: e.target.value } : s)) }))}
                  className="flex-1 px-2 py-1.5 rounded-lg outline-none text-sm" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <select value={step.owner} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, owner: e.target.value } : s)) }))}
                  className="px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input type="number" value={step.dueDays} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, dueDays: Number(e.target.value) } : s)) }))}
                  className="w-16 px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Due, days from onboarding start" />
                <span className="text-[11px] shrink-0" style={{ color: T.slateLight }}>days</span>
                <button onClick={() => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.filter((s) => s.id !== step.id) }))}><Trash2 size={14} color={T.slateLight} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => updateWorkflow(wf.id, (w) => ({ ...w, steps: [...w.steps, { id: "step" + Date.now(), title: "New step", owner: TEAM[0], dueDays: 7 }] }))}
            className="flex items-center gap-1.5 text-xs font-semibold mt-3" style={{ color: T.tealDark }}>
            <Plus size={13} /> Add step
          </button>
        </Card>
      ))}
    </div>
  );
}


/* ---------- Dashboards (client journey, split by profile) ---------- */
function dashboardMonths() {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}
function monthLabel(m) {
  return new Date(m + "-02").toLocaleDateString("en-NZ", { month: "short" });
}
// Touchpoints = logged hours + notes for that month — the two things in the data model
// that carry a real date and represent actual client-facing activity.
function touchpointCounts(client, months) {
  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  (client.hours?.log || []).forEach((h) => { const m = (h.date || "").slice(0, 7); if (m in counts) counts[m]++; });
  (client.notes || []).forEach((n) => { const m = (n.date || "").slice(0, 7); if (m in counts) counts[m]++; });
  return counts;
}

function DashboardsView({ clients }) {
  const months = useMemo(() => dashboardMonths(), []);
  const active = clients.filter((c) => !c.archived);
  const groups = CLIENT_PROFILES.map((p) => ({ profile: p, list: active.filter((c) => (c.profile || "Standard Client") === p) }));

  return (
    <div className="flex flex-col gap-8">
      <div className="text-sm" style={{ color: T.slate }}>
        Each dot is a month; darker means more touchpoints (hours logged + notes added) that month — a quick way to spot a client who's gone quiet.
      </div>
      {groups.map((g) => (
        <div key={g.profile}>
          <div className="text-sm font-bold mb-3" style={{ color: T.ink }}>
            {g.profile} <span className="font-normal" style={{ color: T.slateLight }}>({g.list.length})</span>
          </div>
          <Card style={{ padding: 16, overflowX: "auto" }}>
            {g.list.length === 0 ? (
              <div className="text-xs py-3" style={{ color: T.slateLight }}>No clients with this profile yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "160px repeat(12, minmax(28px, 1fr))", gap: 6, minWidth: 560 }}>
                <div />
                {months.map((m) => <div key={m} className="text-[10px] text-center font-semibold" style={{ color: T.slateLight }}>{monthLabel(m)}</div>)}
                {g.list.map((c) => {
                  const counts = touchpointCounts(c, months);
                  return (
                    <React.Fragment key={c.id}>
                      <div className="text-xs font-medium py-1.5 truncate" style={{ color: T.ink }}>{c.name}</div>
                      {months.map((m) => {
                        const n = counts[m];
                        const color = n === 0 ? T.border : n <= 2 ? T.amber : T.tealDark;
                        return (
                          <div key={m} className="flex items-center justify-center py-1.5">
                            <div title={`${c.name} — ${monthLabel(m)}: ${n} touchpoint${n === 1 ? "" : "s"}`}
                              style={{ width: 14, height: 14, borderRadius: 999, background: color, opacity: n === 0 ? 0.5 : 1 }} />
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ))}
      <div className="text-xs text-center" style={{ color: T.slateLight }}>
        Hover a dot to see the exact count. Task completions aren't counted yet since tasks don't currently record a completion date.
      </div>
    </div>
  );
}


export default function App() {
  const [module, setModule] = useState("clients");
  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const teamDoc = await getDoc(doc(db, "team", uid));
        setCurrentUser(teamDoc.exists() ? teamDoc.data().name : auth.currentUser.email);
      } catch (err) {
        console.error("Could not look up team member:", err);
        setCurrentUser(auth.currentUser.email);
      }
    })();
  }, []);
  // Clients now live in Firestore. On first run (empty collection) we seed the
  // sample data you've been testing with, using the same ids ("bmc", "radius", etc.)
  // so everything else that references those ids keeps working.
  const [clients, setClients] = useState([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [clientsError, setClientsError] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "clients"),
      (snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setClientsLoaded(true);
      },
      (err) => {
        console.error("Clients subscription failed:", err);
        setClientsError(err.message || String(err));
        setClientsLoaded(true);
      }
    );
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "clients"));
        if (snap.empty) {
          await Promise.all(
            initialClients.map((c) => {
              const { id, ...data } = c;
              return setDoc(doc(db, "clients", id), data);
            })
          );
        }
      } catch (err) {
        console.error("Client seed failed (likely a Firestore permissions issue):", err);
      }
    })();
  }, []);
  // Leads now live in Firestore, same pattern as clients: live subscription plus a
  // one-time seed of the mock data using the same ids so nothing else breaks.
  const [leads, setLeads] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "leads"),
      (snap) => setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Leads subscription failed:", err)
    );
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "leads"));
        if (snap.empty) {
          await Promise.all(
            initialLeads.map((l) => {
              const { id, ...data } = l;
              return setDoc(doc(db, "leads", String(id)), data);
            })
          );
        }
      } catch (err) {
        console.error("Lead seed failed (likely a Firestore permissions issue):", err);
      }
    })();
  }, []);
  // My Tasks — real Firestore collection, one doc per task.
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "tasks"), (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Tasks subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "tasks"));
        if (snap.empty) await Promise.all(initialTasks.map((t) => { const { id, ...data } = t; return setDoc(doc(db, "tasks", String(id)), data); }));
      } catch (err) { console.error("Task seed failed (likely a Firestore permissions issue):", err); }
    })();
  }, []);

  // Resellers — real Firestore collection, one doc per reseller (their clients/tasks stay nested arrays, same as before).
  const [resellers, setResellers] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "resellers"), (snap) => setResellers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Resellers subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "resellers"));
        if (snap.empty) await Promise.all(initialResellers.map((r) => { const { id, ...data } = r; return setDoc(doc(db, "resellers", id), data); }));
      } catch (err) { console.error("Reseller seed failed (likely a Firestore permissions issue):", err); }
    })();
  }, []);
  const [selectedReseller, setSelectedReseller] = useState(initialResellers[0].id);
  const goToReseller = (resellerId) => {
    setSelectedReseller(resellerId);
    setModule("resellers");
  };
  const [selectedClient, setSelectedClient] = useState(initialClients[0].id);
  const [clientTabRequest, setClientTabRequest] = useState({ tab: null, nonce: 0 });
  const goToClient = (clientId, tab) => {
    setSelectedClient(clientId);
    setModule("clients");
    setClientTabRequest({ tab: tab || "overview", nonce: Date.now() });
  };

  // Workflows — real Firestore collection, one doc per workflow template.
  const initialWorkflows = [
    { id: "wf-standard", name: "Standard Onboarding", isDefault: true, steps: defaultOnboardingTemplate },
    {
      id: "wf-fasttrack", name: "Fast-Track (small client)", isDefault: false,
      steps: [
        { id: "welcome", title: "Send welcome pack", owner: "Vanessa", dueDays: 1 },
        { id: "record", title: "Confirm client record", owner: "Judith", dueDays: 2 },
        { id: "docs", title: "Build & deliver documents", owner: "Sophie", dueDays: 7 },
      ],
    },
    {
      id: "wf-prequal", name: "Pre-Qualification", isDefault: false,
      steps: [
        { id: "request", title: "Request pre-qual documentation from client", owner: "Vanessa", dueDays: 2 },
        { id: "review", title: "Review submitted documentation", owner: "Judith", dueDays: 7 },
        { id: "gapcheck", title: "Identify and flag any gaps", owner: "Sophie", dueDays: 10 },
        { id: "signoff", title: "Sign off pre-qualification", owner: "Jo", dueDays: 14 },
      ],
    },
  ];
  const [workflows, setWorkflows] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "workflows"), (snap) => setWorkflows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Workflows subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "workflows"));
        if (snap.empty) await Promise.all(initialWorkflows.map((w) => { const { id, ...data } = w; return setDoc(doc(db, "workflows", id), data); }));
      } catch (err) { console.error("Workflow seed failed (likely a Firestore permissions issue):", err); }
    })();
  }, []);

  // Onboardings — one Firestore doc per client, holding that client's list of onboarding instances.
  // Kept as a { [clientId]: [...] } shape in local state to match every existing read site.
  const initialOnboardings = {
    radius: [
      {
        id: "ob-seed-radius", workflowId: "wf-standard", workflowName: "Standard Onboarding",
        startedDate: "2026-05-12", completedDate: null,
        steps: [
          { id: "welcome", title: "Send welcome pack & introduce team", owner: "Vanessa", dueDate: "2026-05-14", done: true },
          { id: "kickoff", title: "Schedule kickoff call", owner: "Vanessa", dueDate: "2026-05-17", done: true },
          { id: "record", title: "Confirm client record + Firestore entry", owner: "Judith", dueDate: "2026-05-17", done: true },
          { id: "ohsms", title: "Scope OHSMS / policy requirements", owner: "Sophie", dueDate: "2026-05-22", done: true },
          { id: "docs", title: "Build & deliver initial documents", owner: "Sophie", dueDate: "2026-06-01", done: false },
          { id: "reporting", title: "Set up monthly reporting cadence", owner: "Jo", dueDate: "2026-06-06", done: false },
        ],
      },
      {
        id: "ob-seed-radius-prequal", workflowId: "wf-prequal", workflowName: "Pre-Qualification",
        startedDate: "2026-07-10", completedDate: null,
        steps: [
          { id: "request", title: "Request pre-qual documentation from client", owner: "Vanessa", dueDate: "2026-07-12", done: true },
          { id: "review", title: "Review submitted documentation", owner: "Judith", dueDate: "2026-07-17", done: false },
          { id: "gapcheck", title: "Identify and flag any gaps", owner: "Sophie", dueDate: today(), done: false },
          { id: "signoff", title: "Sign off pre-qualification", owner: "Jo", dueDate: "2026-07-24", done: false },
        ],
      },
    ],
  };
  const [onboardings, setOnboardingsState] = useState({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onboardings"), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data().list || []; });
      setOnboardingsState(map);
    }, (err) => console.error("Onboardings subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "onboardings"));
        if (snap.empty) await Promise.all(Object.entries(initialOnboardings).map(([clientId, list]) => setDoc(doc(db, "onboardings", clientId), { list })));
      } catch (err) { console.error("Onboarding seed failed (likely a Firestore permissions issue):", err); }
    })();
  }, []);
  // Writes a specific client's onboarding list. updaterFn receives that client's current list and returns the new one.
  const updateOnboardingsForClient = async (clientId, updaterFn) => {
    const current = onboardings[clientId] || [];
    const next = updaterFn(current);
    await setDoc(doc(db, "onboardings", clientId), { list: next });
  };

  // Notifications — real Firestore collection, starts empty (nothing to seed).
  const [notifications, setNotificationsState] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "notifications"), (snap) => setNotificationsState(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Notifications subscription failed:", err));
    return unsub;
  }, []);

  // Sound alert: chime whenever a brand-new notification arrives for the logged-in person
  // (not for the batch that loads in on first page load — only genuinely new ones after that).
  const seenNotificationIds = useRef(null);
  useEffect(() => {
    const mine = notifications.filter((n) => n.forPerson === currentUser && !n.dismissed);
    const mineIds = new Set(mine.map((n) => n.id));
    if (seenNotificationIds.current === null) {
      seenNotificationIds.current = mineIds;
      return;
    }
    const isNew = [...mineIds].some((id) => !seenNotificationIds.current.has(id));
    if (isNew) playChime();
    seenNotificationIds.current = mineIds;
  }, [notifications, currentUser]);

  // Sound alert: once per day, if there's a reminder due within 2 weeks for anyone.
  // Gated by localStorage so it doesn't chime on every single page load/refresh.
  useEffect(() => {
    if (!clientsLoaded || clients.length === 0) return;
    const dueSoon = clients.flatMap((c) => c.reminders).some((r) => daysUntil(r.date) <= 14);
    if (!dueSoon) return;
    const key = "oshe-reminder-chime-" + today();
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    playChime();
  }, [clients, clientsLoaded]);

  const pushNotification = async ({ forPerson, clientId, clientName, message, type }) => {
    if (notifications.some((n) => n.clientId === clientId && n.forPerson === forPerson && n.message === message)) return;
    const id = "notif" + Date.now();
    await setDoc(doc(db, "notifications", id), {
      forPerson, clientId, clientName, message,
      type: type || (message.includes("handed over") ? "handover" : "mention"),
      dismissed: false,
    });
  };
  const dismissNotification = (id) => updateDoc(doc(db, "notifications", id), { dismissed: true });

  const convertLeadToClient = async (lead) => {
    const id = "c" + Date.now();
    const intake = {
      submittedDate: today(), contactEmail: lead.formEmail, contactName: lead.contact,
      requestedSections: ["policy", "hazard", "induction", "ppe"], supportHours: 6,
      existingWork: "No formal OHSMS in place yet — currently relying on a basic site safety folder.",
    };
    const newClient = {
      name: lead.company, legalName: lead.company, logo: null,
      contract: { start: today(), renewal: addDays(today(), 365), value: lead.value + " / yr", plan: "New client — plan to confirm" },
      billing: { contact: lead.contact, email: lead.formEmail, terms: "TBC", status: "Current" },
      billingType: "FlatFee", billingSetupDone: false, profile: "Standard Client",
      notes: [], reminders: [], contacts: [], ohsmsLastIssued: null, ohsmsDue: addDays(today(), 90),
      extras: [], hours: { included: intake.supportHours, log: [] }, users: { log: [] }, intake,
    };
    await setDoc(doc(db, "clients", id), newClient);
    const wf = workflows.find((w) => w.isDefault) || workflows[0];
    await setDoc(doc(db, "onboardings", id), {
      list: [{
        id: "ob" + Date.now(), workflowId: wf.id, workflowName: wf.name, startedDate: today(), completedDate: null,
        steps: wf.steps.map((s) => ({ ...s, done: false, dueDate: addDays(today(), s.dueDays) })),
      }],
    });
    await deleteDoc(doc(db, "leads", lead.id));
    setSelectedClient(id);
    setModule("clients");
  };

  const upcomingReminders = useMemo(() => clients.flatMap((c) => c.reminders).filter((r) => daysUntil(r.date) <= 14), [clients]);

  if (!clientsLoaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: T.slate }}>
        Loading client data…
      </div>
    );
  }

  if (clientsError) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
        <div style={{ fontWeight: 700, color: T.coral }}>Couldn't load client data</div>
        <div style={{ color: T.slate, fontSize: 13, maxWidth: 480 }}>{clientsError}</div>
        <div style={{ color: T.slateLight, fontSize: 12, maxWidth: 480 }}>
          This is almost always a Firestore permissions issue — check that a document exists in the <code>team</code> collection with your exact User UID as its Document ID.
        </div>
      </div>
    );
  }

  if (clientsLoaded && clients.length === 0 && module === "clients") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: T.slate }}>
        No clients yet — this should populate automatically within a moment. If it doesn't after a refresh, check the browser console for errors.
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="w-56 shrink-0 flex flex-col p-4 gap-1" style={{ background: T.charcoal }}>
        <div className="px-3 py-3 mb-3">
          <img src="/logo.png" alt="OSHE" style={{ height: 36, width: "auto" }} />
        </div>
        <NavItem icon={Users} label="Clients" active={module === "clients"} onClick={() => setModule("clients")} />
        <NavItem icon={Layers} label="Systems" active={module === "systems"} onClick={() => setModule("systems")} />
        <NavItem icon={TrendingUp} label="Sales" active={module === "sales"} onClick={() => setModule("sales")} />
        <NavItem icon={ClipboardList} label="Billing" active={module === "billing"} onClick={() => setModule("billing")} />
        <NavItem icon={LayoutDashboard} label="Dashboards" active={module === "dashboards"} onClick={() => setModule("dashboards")} />
        <NavItem icon={Store} label="Resellers" active={module === "resellers"} onClick={() => setModule("resellers")} />
        <NavItem icon={ListChecks} label="Workflows" active={module === "workflows"} onClick={() => setModule("workflows")} />
        <NavItem icon={ListTodo} label="My Tasks" active={module === "tasks"} onClick={() => setModule("tasks")} />
        <div className="flex-1" />
        <div className="px-3 pb-2">
          <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "#5C7274" }}>Logged in as</div>
          <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: T.charcoalSoft, color: "#fff" }}>
            {currentUser || "…"}
          </div>
        </div>
        <div className="text-[11px] px-3 pb-1" style={{ color: "#5C7274" }}>Clients is live &middot; other tabs still mock data</div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-8 py-5" style={{ borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div className="text-xl font-bold" style={{ color: T.ink }}>
              {{ clients: "Clients", systems: "Systems", sales: "Sales", billing: "Billing", workflows: "Workflows", resellers: "Resellers", tasks: "My Tasks", dashboards: "Dashboards" }[module]}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell notifications={notifications} dismissNotification={dismissNotification} reminderCount={upcomingReminders.length} currentUser={currentUser} />
            <button onClick={() => signOut(auth)} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>
              Sign out
            </button>
          </div>
        </div>

        <div className="flex-1 p-8 min-h-0">
          {module === "clients" && (
            <ClientsView clients={clients} selectedId={selectedClient} setSelectedId={setSelectedClient}
              onboardings={onboardings} updateOnboardingsForClient={updateOnboardingsForClient} workflows={workflows}
              pushNotification={pushNotification} goToWorkflows={() => setModule("workflows")} tabRequest={clientTabRequest} />
          )}
          {module === "systems" && <SystemsView clients={clients} selectedId={selectedClient} setSelectedId={setSelectedClient} />}
          {module === "sales" && <SalesView leads={leads} convertLeadToClient={convertLeadToClient} />}
          {module === "billing" && <BillingOverview clients={clients} resellers={resellers} />}
          {module === "dashboards" && <DashboardsView clients={clients} />}
          {module === "workflows" && <WorkflowsView workflows={workflows} />}
          {module === "resellers" && <ResellersView resellers={resellers} selectedId={selectedReseller} setSelectedId={setSelectedReseller} />}
          {module === "tasks" && <TasksView tasks={tasks} clients={clients} onboardings={onboardings} currentUser={currentUser} goToClient={goToClient} resellers={resellers} goToReseller={goToReseller} />}
        </div>
      </div>
    </div>
  );
}
