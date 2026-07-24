import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Users, TrendingUp, Bell, Building2, CreditCard, StickyNote,
  ChevronRight, Plus, Check, Upload, Calendar, X, Search,
  ClipboardList, Layers, Circle, CheckCircle2, Image as ImageIcon,
  Repeat, Trash2, ListChecks, ListTodo, Mail, ArrowUpRight, Store, LayoutDashboard, ChevronDown
} from "lucide-react";
import { collection, doc, onSnapshot, updateDoc, setDoc, getDocs, getDoc, deleteDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { ref as storageRef, getDownloadURL, uploadBytes } from "firebase/storage";
import { db, auth, storage } from "./firebase";
import { SECTION_ITEMS, ALWAYS_PROCEDURES, CONDITIONAL_PROCEDURES, COMPLIANCE_EXTRA_PROCEDURES, ALWAYS_POLICIES, CONDITIONAL_POLICIES } from "./ohsmsLogic";

/* ---------- Resilient dynamic import ----------
   Vite splits `await import("pdf-lib")` into its own hashed chunk file
   (e.g. index-t6SStVor.js). Firebase Hosting swaps out ALL files on every
   deploy, so a browser tab left open across a deploy will try to fetch a
   chunk filename that no longer exists -> "Failed to fetch dynamically
   imported module". Instead of surfacing that as a broken PDF export, we
   force a one-time hard reload so the tab picks up the current build. */
async function importWithReloadOnStaleChunk(loader) {
  try {
    return await loader();
  } catch (err) {
    const msg = String(err && err.message);
    const isStaleChunk =
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg);
    if (isStaleChunk) {
      const key = "oshe_stale_chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        // Reload is in-flight; keep this call pending so nothing downstream runs.
        return new Promise(() => {});
      }
    }
    throw err;
  }
}

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
  // Whenever the OHSMS issue date is set (manually or via "Mark issued today"), automatically
  // create or update a yearly reminder assigned to Jo for the upcoming annual review — so nobody
  // has to remember to add it by hand. Fires 1 month before the review is due, matching the
  // "Redo reminder" card's stated behavior. Uses a fixed id so re-issuing updates the same
  // reminder rather than piling up duplicates.
  const withOhsmsReminder = (c, dueDate) => {
    const reminder = { id: "ohsms-annual-review", text: "OHSMS annual review due", date: addDays(dueDate, -30), recurring: "yearly", done: false, assignee: "Jo" };
    const idx = c.reminders.findIndex((r) => r.id === "ohsms-annual-review");
    const reminders = idx >= 0 ? c.reminders.map((r, i) => (i === idx ? reminder : r)) : [...c.reminders, reminder];
    return { ...c, reminders };
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
                    <input type="date" value={client.ohsmsLastIssued || ""} onChange={(e) => updateClient((c) => withOhsmsReminder({ ...c, ohsmsLastIssued: e.target.value, ohsmsDue: addDays(e.target.value, 365) }, addDays(e.target.value, 365)))}
                      className="text-xs px-1.5 py-1 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    <button onClick={() => updateClient((c) => withOhsmsReminder({ ...c, ohsmsLastIssued: today(), ohsmsDue: addDays(today(), 365) }, addDays(today(), 365)))}
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
                    {client.intake.phone && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>PHONE</div><div style={{ color: T.ink }}>{client.intake.phone}</div></div>}
                    {client.intake.address && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>ADDRESS</div><div style={{ color: T.ink }}>{client.intake.address}</div></div>}
                    {client.intake.appUsers && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>APP TIER</div><div style={{ color: T.ink }}>{client.intake.appUsers}</div></div>}
                    {client.intake.paymentFreq && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>PAYMENT</div><div style={{ color: T.ink }}>{client.intake.paymentFreq}</div></div>}
                    {client.intake.requireOhsms && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>OHSMS REQUIRED</div><div style={{ color: T.ink }}>{client.intake.requireOhsms}</div></div>}
                    {client.intake.supportHours != null && <div><div className="text-xs font-semibold" style={{ color: T.slate }}>SUPPORT HOURS REQUESTED</div><div style={{ color: T.ink }}>{client.intake.supportHours} hrs / month</div></div>}
                    {client.intake.workTasks && <div className="col-span-2"><div className="text-xs font-semibold" style={{ color: T.slate }}>GENERAL WORK TASKS</div><div style={{ color: T.ink }}>{client.intake.workTasks}</div></div>}
                    {client.intake.existingWork && <div className="col-span-2"><div className="text-xs font-semibold" style={{ color: T.slate }}>EXISTING WORK IN PLACE</div><div style={{ color: T.ink }}>{client.intake.existingWork}</div></div>}

                    {Array.isArray(client.intake.requestedSections) && client.intake.requestedSections.length > 0 && (
                      <div className="col-span-2">
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>REQUESTED OHSMS SECTIONS</div>
                        <div className="flex flex-wrap gap-1.5">
                          {client.intake.requestedSections.map((s) => <Pill key={s} color={T.tealDark} bg={T.paperAlt}>{s}</Pill>)}
                        </div>
                      </div>
                    )}

                    {Array.isArray(client.intake.emergencies) && client.intake.emergencies.length > 0 && (
                      <div className="col-span-2">
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>EMERGENCIES IDENTIFIED</div>
                        <div className="flex flex-wrap gap-1.5">
                          {client.intake.emergencies.map((e) => <Pill key={e} color={T.tealDark} bg={T.paperAlt}>{e}</Pill>)}
                        </div>
                        {client.intake.emergencyOther && <div className="text-xs mt-1" style={{ color: T.slate }}>Other: {client.intake.emergencyOther}</div>}
                      </div>
                    )}

                    {client.intake.ohsmsPack && (
                      <div className="col-span-2">
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>OHSMS PACK (from their answers)</div>
                        <div className="flex gap-2 flex-wrap">
                          <Pill color={T.tealDark} bg={T.paperAlt}>{(client.intake.ohsmsPack.sections || []).length} sections</Pill>
                          <Pill color={T.tealDark} bg={T.paperAlt}>{(client.intake.ohsmsPack.procedures || []).length} procedures</Pill>
                          <Pill color={T.tealDark} bg={T.paperAlt}>{(client.intake.ohsmsPack.policies || []).length} policies</Pill>
                          {(client.intake.ohsmsPack.forms || []).length > 0 && <Pill color={T.tealDark} bg={T.paperAlt}>{client.intake.ohsmsPack.forms.length} forms</Pill>}
                        </div>
                      </div>
                    )}

                    {client.intake.signedTermsPath && (
                      <div className="col-span-2 text-xs" style={{ color: T.slateLight }}>Signed T&amp;Cs PDF stored at: {client.intake.signedTermsPath}</div>
                    )}
                    {Array.isArray(client.intake.existingFiles) && client.intake.existingFiles.length > 0 && (
                      <div className="col-span-2">
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>FILES THEY UPLOADED</div>
                        <div className="flex flex-col gap-1">
                          {client.intake.existingFiles.map((f, i) => (
                            <button key={i} type="button" onClick={async () => {
                              try {
                                const url = await getDownloadURL(storageRef(storage, f.path));
                                window.open(url, "_blank");
                              } catch (err) {
                                console.error("Couldn't open file:", err);
                                alert("Couldn't open that file — it may not have finished uploading, or the link has expired.");
                              }
                            }} className="text-xs text-left underline" style={{ color: T.tealDark }}>
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === "contract" && (
            <Card style={{ padding: 20 }}>
              <div className="mb-4">
                <div className="text-xs font-semibold" style={{ color: T.slate }}>PLAN</div>
                <input
                  defaultValue={client.contract.plan || ""}
                  onBlur={(e) => updateClient((c) => ({ ...c, contract: { ...c.contract, plan: e.target.value } }))}
                  placeholder="e.g. Full H&S Retainer, Monthly Compliance Pack..."
                  className="w-full text-sm px-2.5 py-2 rounded-lg outline-none mt-1"
                  style={{ border: `1px solid ${T.border}`, color: T.ink }}
                />
              </div>
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
const DOCUMENT_CATEGORIES = [
  {
    key: "sections", label: "Manual Sections",
    itemList: SECTION_ITEMS.map((i) => i.label),
    alwaysLabels: SECTION_ITEMS.filter((i) => i.always).map((i) => i.label),
    complianceExtraLabels: [],
  },
  {
    key: "procedures", label: "Procedures",
    itemList: [...ALWAYS_PROCEDURES, ...CONDITIONAL_PROCEDURES.map((c) => c.label), ...COMPLIANCE_EXTRA_PROCEDURES],
    alwaysLabels: ALWAYS_PROCEDURES,
    complianceExtraLabels: COMPLIANCE_EXTRA_PROCEDURES,
  },
  {
    key: "policies", label: "Policies",
    itemList: [...ALWAYS_POLICIES, ...CONDITIONAL_POLICIES.map((c) => c.label)],
    alwaysLabels: ALWAYS_POLICIES,
    complianceExtraLabels: [],
  },
];

function categoryItems(category) {
  return category.itemList;
}

function templateKey(categoryKey, label) {
  return `${categoryKey}::${label}`.replace(/\//g, "-");
}

// Manual section labels carry their real document number as a stable key (e.g. "11. Contractors",
// "5.1 Participation and Consultation") — but if a client doesn't need some sections, keeping
// those original numbers leaves gaps (11, 14, 16...) which reads as broken, not intentional.
// This renumbers for DISPLAY only, based purely on what's actually included and in what order,
// while correctly keeping subheadings under their renumbered parent (so if section 16 becomes
// the new "12", its 16.1/16.2 subheadings become 12.1/12.2).
function renumberSections(labels) {
  let topCounter = 0;
  let subCounter = 0;
  return labels.map((label) => {
    const subMatch = label.match(/^\d+\.\d+\s+(.*)$/);
    const topMatch = label.match(/^\d+\.\s+(.*)$/);
    if (subMatch) {
      subCounter++;
      return `${topCounter}.${subCounter} ${subMatch[1]}`;
    }
    if (topMatch) {
      topCounter++;
      subCounter = 0;
      return `${topCounter}. ${topMatch[1]}`;
    }
    return label;
  });
}

// Default ticks: if this client actually has a computed OHSMS pack (came through the real
// sign-up form), use exactly what their answers produced. Otherwise (legacy/manually-added
// clients), fall back to just the always-included items ticked, everything else left for
// Sophie/Vanessa to decide manually.
function defaultChecked(client, category) {
  const packList = client?.intake?.ohsmsPack?.[category.key];
  return Object.fromEntries(categoryItems(category).map((label) => [label, packList ? packList.includes(label) : category.alwaysLabels.includes(label)]));
}

async function exportReviewLogPdf(entries) {
  const { PDFDocument, StandardFonts, rgb } = await importWithReloadOnStaleChunk(() => import("pdf-lib"));
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let page = pdfDoc.addPage([595, 842]);
  let y = 792;

  const ensureSpace = (needed) => { if (y - needed < margin) { page = pdfDoc.addPage([595, 842]); y = 792; } };

  page.drawText("OSHE System Review & Change Log", { x: margin, y, size: 14, font: boldFont, color: rgb(0.08, 0.16, 0.14) });
  y -= 20;
  page.drawText(`Exported ${fmtDate(today())}`, { x: margin, y, size: 9, font, color: rgb(0.36, 0.45, 0.45) });
  y -= 26;

  const sorted = [...entries].reverse();
  if (sorted.length === 0) {
    page.drawText("No review or change entries logged yet.", { x: margin, y, size: 10, font, color: rgb(0.36, 0.45, 0.45) });
  }
  sorted.forEach((entry) => {
    ensureSpace(40);
    page.drawText(`${fmtDate(entry.date)} — ${entry.type} — ${entry.person}`, { x: margin, y, size: 10, font: boldFont, color: rgb(0.08, 0.16, 0.14) });
    y -= 14;
    const words = (entry.notes || "").split(" ");
    let line = "";
    words.forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, 9) > 495 && line) {
        ensureSpace(12);
        page.drawText(line, { x: margin, y, size: 9, font, color: rgb(0.36, 0.45, 0.45) });
        y -= 12;
        line = w;
      } else line = test;
    });
    if (line) { ensureSpace(12); page.drawText(line, { x: margin, y, size: 9, font, color: rgb(0.36, 0.45, 0.45) }); y -= 12; }
    y -= 10;
  });

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `OSHE-system-review-log.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadClientLogoImage(client, pdfDoc) {
  if (!client.logo) return null;
  try {
    const url = await getDownloadURL(storageRef(storage, client.logo));
    const resp = await fetch(url);
    const bytes = await resp.arrayBuffer();
    if (client.logo.toLowerCase().endsWith(".jpg") || client.logo.toLowerCase().endsWith(".jpeg")) {
      return await pdfDoc.embedJpg(bytes);
    }
    return await pdfDoc.embedPng(bytes);
  } catch (err) {
    console.error("Couldn't load client logo for PDF:", err);
    return null;
  }
}

// Loads a real reference-diagram image bundled at /public/diagrams/<name> and embeds it
// into the PDF being built. Returns null (silently) if the file isn't there yet, so callers
// can fall back to a hand-drawn version rather than breaking the export.
async function loadStaticDiagramImage(pdfDoc, filename) {
  try {
    const resp = await fetch(`/diagrams/${filename}`);
    if (!resp.ok) return null;
    const bytes = await resp.arrayBuffer();
    if (filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")) {
      return await pdfDoc.embedJpg(bytes);
    }
    return await pdfDoc.embedPng(bytes);
  } catch (err) {
    console.error(`Couldn't load diagram image /diagrams/${filename}:`, err);
    return null;
  }
}

// Draws an embedded diagram image scaled to fit maxWidth, returning the y position below it.
function drawDiagramImage({ page, image, x, y0, maxWidth, maxHeight = 320 }) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const w = image.width * scale, h = image.height * scale;
  page.drawImage(image, { x, y: y0 - h, width: w, height: h });
  return y0 - h - 14;
}

// The Health & Safety Policy quadrant content — real wording from the reference Policy
// document. Client name is interpolated at render time via a template function.
const DEEP_GREEN = [0.06, 0.20, 0.16];
function getPolicyQuadrants(clientName) {
  return [
    { label: `(PCBU) ${clientName}`, color: DEEP_GREEN, items: [
      "Provide a safe and healthy work environment",
      "Prevent work related injury, ill health and adverse effects to mental wellbeing",
      "Provide Personal Protective Equipment and applicable training on its use",
      "Meet and exceed our legislative obligations",
      "Provide information, supervision, training and instruction to workers",
      "Continually improve our Health and Safety Management System",
      "Manage contractors to ensure they do not pose a risk to our workers or themselves",
      "Actively monitor exposure to substances hazardous to health",
      "Identify hazards, control risks and review controls",
      "Provide workplace facilities and first aid",
      "Prepare, implement, and maintain a plan for emergencies",
      "Provide and maintain safe plant, structures, and systems of work",
    ] },
    { label: "Officers", color: DEEP_GREEN, items: [
      `Ensure that ${clientName} meets legislative requirements`,
      "Gain and maintain knowledge of work health and safety matters",
      "Understand the nature of the business, its operation and the hazards and risks associated with the operation",
      `Ensure ${clientName} has and uses resources to ensure risks to health and safety are eliminated or minimised`,
      `Ensure ${clientName} has processes for receiving, communicating and considering information regarding incidents, hazards, and risks`,
      `Ensure ${clientName} responds in a timely manner to any information received in relation to health and safety`,
      `Ensure ${clientName} implements processes and complies with any duties`,
    ] },
    { label: "Supervisors", color: DEEP_GREEN, items: [
      "Support the Officer in meeting his/her duties",
      "Lead Health and Safety by example",
      "Promote a positive Health and Safety culture",
      "Enable and encourage workers to communicate and participate in Health and Safety",
      "Ensure that processes and procedures are communicated and followed",
      "Ensure workers are competent for the work being undertaken",
      `Ensure that all policies, procedures, and objectives are in place and compatible with ${clientName}'s direction, work practices, goals, and targets`,
      "Support early return to work",
    ] },
    { label: "Workers", color: DEEP_GREEN, items: [
      "Take reasonable care for his/her own Health and Safety",
      "Take reasonable care that his/her acts or omissions do not adversely affect the health and safety of other persons",
      `Comply with any reasonable instruction from ${clientName}`,
      `Cooperate with any reasonable policy or procedure from ${clientName}`,
      "Wear all Personal Protective Equipment provided",
      "Report any incidents, hazards or risks",
      `Participate in Health and Safety within ${clientName}`,
    ] },
  ];
}

function getPolicyIntro(clientName) {
  return `${clientName} is committed to ensuring so far as is reasonably practicable the obligations under the Health and Safety at Work Act (2015), applicable Regulations, Approved Codes of Practice, Guidelines, and other relevant standards are met. ${clientName} will also ensure as far as is reasonably practicable the health, safety and wellness of workers and any other person(s) that may be affected from the risks created by the operations of ${clientName}. ${clientName} is dedicated to providing a work environment where health, safety and wellness is of equal importance to all other business operations and the culture within ${clientName} reflects this by making a commitment to:`;
}

function drawCenteredText(page, text, centerX, y, size, font, color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, size, font, color });
}

// Draws the 4-box Health & Safety Policy grid (PCBU / Officers / Supervisors / Workers).
// Each ROW is sized to its own tallest box (not one global height across all 4), so a
// shorter list doesn't leave a big gap of empty space at the bottom of its box. Returns
// the bottom y.
function drawPolicyGrid({ page, x, y0, maxWidth, font, boldFont, rgb, clientName }) {
  const quadrants = getPolicyQuadrants(clientName);
  const colGap = 14, rowGap = 8;
  const colW = (maxWidth - colGap) / 2;
  const headerH = 20, cellPad = 8;
  const bulletSize = 9, lineHeight = 11;

  const cellContentHeight = (items) => {
    let h = 0;
    items.forEach((item) => {
      h += wrapTextLines("•  " + item, font, bulletSize, colW - 2 * cellPad).length * lineHeight + 3;
    });
    return h;
  };

  const drawCell = (cx, yTop, item, cellH) => {
    page.drawRectangle({ x: cx, y: yTop - headerH, width: colW, height: headerH, color: rgb(item.color[0], item.color[1], item.color[2]) });
    page.drawText(item.label, { x: cx + cellPad, y: yTop - headerH + 6, size: 9.5, font: boldFont, color: rgb(1, 1, 1) });
    let cy = yTop - headerH - cellPad - 7;
    item.items.forEach((line) => {
      wrapTextLines("•  " + line, font, bulletSize, colW - 2 * cellPad).forEach((wl) => {
        page.drawText(wl, { x: cx + cellPad, y: cy, size: bulletSize, font, color: rgb(0.2, 0.25, 0.25) });
        cy -= lineHeight;
      });
      cy -= 3;
    });
    page.drawRectangle({ x: cx, y: yTop - cellH, width: colW, height: cellH, borderColor: rgb(0.75, 0.8, 0.8), borderWidth: 1 });
  };

  const row1H = headerH + Math.max(cellContentHeight(quadrants[0].items), cellContentHeight(quadrants[1].items)) + cellPad * 2;
  const row2H = headerH + Math.max(cellContentHeight(quadrants[2].items), cellContentHeight(quadrants[3].items)) + cellPad * 2;

  drawCell(x, y0, quadrants[0], row1H);
  drawCell(x + colW + colGap, y0, quadrants[1], row1H);
  const row2Y = y0 - row1H - rowGap;
  drawCell(x, row2Y, quadrants[2], row2H);
  drawCell(x + colW + colGap, row2Y, quadrants[3], row2H);

  return row2Y - row2H;
}



function wrapTextLines(text, font, size, maxWidth) {
  const lines = [];
  const paragraphs = text.split("\n");
  paragraphs.forEach((para) => {
    if (para.trim() === "") { lines.push(""); return; }
    const words = para.split(" ");
    let line = "";
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
  });
  return lines;
}

/* ---------- Hardcoded document visuals ---------- */
// These are built once, per section/procedure, matching the real reference diagrams from
// OSHE's documents. Each takes the current page/position and returns where drawing left off.

// Downloads a real PDF of what's currently ticked. Manual sections flow continuously (a
// section only forces a new page if there genuinely isn't room left); Procedures and
// Policies each start on their own fresh page, since they're separate standalone documents
// just bundled together for convenience, not one flowing manual.
async function downloadBuildPdf({ client, category, categoryKey, included, documentTemplates }) {
  const { PDFDocument, StandardFonts, rgb } = await importWithReloadOnStaleChunk(() => import("pdf-lib"));
  const isFlowing = categoryKey === "sections";
  const ink = rgb(0.08, 0.14, 0.13);
  const slate = rgb(0.36, 0.45, 0.45);
  const teal = rgb(0.04, 0.68, 0.63);
  const charcoal = rgb(0.06, 0.20, 0.16);
  const pageWidth = 595, pageHeight = 842, margin = 50;
  const maxWidth = pageWidth - margin * 2;

  if (isFlowing) {
    // Manual: one flowing document, sections stack continuously.
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoImage = await loadClientLogoImage(client, pdfDoc);

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    const bandHeight = 170;
    page.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: charcoal });
    page.drawText("HEALTH AND SAFETY MANUAL", { x: margin, y: pageHeight - 58, size: 13, font: boldFont, color: teal });
    const nameMaxWidth = pageWidth - margin * 2;
    let nameSize = 32;
    while (nameSize > 18 && boldFont.widthOfTextAtSize(client.name, nameSize) > nameMaxWidth) nameSize -= 1;
    page.drawText(client.name, { x: margin, y: pageHeight - 100, size: nameSize, font: boldFont, color: rgb(1, 1, 1) });

    // Large standalone logo, top-left, just under the header band.
    if (logoImage) {
      const bigMaxH = 160, bigMaxW = 260;
      const scale = Math.min(bigMaxH / logoImage.height, bigMaxW / logoImage.width, 1);
      const w = logoImage.width * scale, h = logoImage.height * scale;
      const logoTop = pageHeight - bandHeight - 30;
      page.drawImage(logoImage, { x: margin, y: logoTop - h, width: w, height: h });
    }

    // Prepared for / Date / Review Date / Signature — bottom-left of the cover page.
    // Review Date is always exactly 1 year after the issue Date shown right above it.
    const issueDate = today();
    let coverY = 160;
    page.drawText(`Prepared for: ${client.name}`, { x: margin, y: coverY, size: 11, font: boldFont, color: ink });
    coverY -= 22;
    page.drawText(`Date: ${fmtDate(issueDate)}`, { x: margin, y: coverY, size: 10, font, color: slate });
    coverY -= 18;
    page.drawText(`Review Date: ${fmtDate(addDays(issueDate, 365))}`, { x: margin, y: coverY, size: 10, font, color: slate });
    coverY -= 30;
    page.drawText("Signature: ___________________________________", { x: margin, y: coverY, size: 10, font, color: slate });

    // Small header repeated on every content page (not the cover, which has its own big
    // branded header): a thin rule, the manual name on the left, client name on the right.
    const headerHeight = 34, topGap = headerHeight + 20;
    const drawContentHeader = (pg, w, h, m) => {
      pg.drawLine({ start: { x: m, y: h - headerHeight + 8 }, end: { x: w - m, y: h - headerHeight + 8 }, thickness: 0.75, color: rgb(0.85, 0.85, 0.85) });
      pg.drawText("HEALTH AND SAFETY MANUAL", { x: m, y: h - 22, size: 8, font: boldFont, color: teal });
      const nw = boldFont.widthOfTextAtSize(client.name, 8);
      pg.drawText(client.name, { x: w - m - nw, y: h - 22, size: 8, font: boldFont, color: slate });
    };

    page = pdfDoc.addPage([pageWidth, pageHeight]);
    drawContentHeader(page, pageWidth, pageHeight, margin);
    let y = pageHeight - topGap;
    const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); drawContentHeader(page, pageWidth, pageHeight, margin); y = pageHeight - topGap; };
    const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };

    const displayLabels = renumberSections(included);

    // Map of section label -> diagram image (filename + max render height). Measuring the
    // image's scaled height up front lets us reserve space for heading + body + diagram as one
    // unit, so a section never gets split with its heading on one page and diagram on the next.
    const SECTION_DIAGRAMS = {
      "5.1 Organisational Roles, Responsibilities, Accountabilities & Authorities": { file: "org-hierarchy.png", maxHeight: 220, center: true },
      "6.1 Objectives": { file: "planning-pdca.png", maxHeight: 120, center: true },
      "7. Hazard Identification and Assessment of OHS Risks": { file: "hazard-categories.png", maxHeight: 220, center: true },
      "7.1 Legal and Other Requirements": { file: "legislation-flow.png", maxHeight: 140, gapBefore: 6, center: true },
      "8.1 Hierarchy of Controls": { file: "hierarchy-of-controls.png", maxHeight: 145, center: true },
      "9. Incidents and Corrective Actions": { file: "incident-corrective-cycle.png", maxHeight: 110, center: true },
    };
    function scaledImageHeight(image, forWidth, maxHeight) {
      const scale = Math.min(forWidth / image.width, maxHeight / image.height, 1);
      return image.height * scale;
    }

    for (let idx = 0; idx < included.length; idx++) {
      const label = included[idx];

      if (label === "4. Health & Safety Policy") {
        const raw = documentTemplates[templateKey(categoryKey, label)] || "";
        const content = raw.replaceAll("The Company", client.name) || `No template text written yet for "${label}".`;
        const landscapeWidth = pageHeight, landscapeHeight = pageWidth, lMargin = 40;
        const landscapePage = pdfDoc.addPage([landscapeWidth, landscapeHeight]);
        drawContentHeader(landscapePage, landscapeWidth, landscapeHeight, lMargin);
        let ly = landscapeHeight - topGap;
        landscapePage.drawText(displayLabels[idx], { x: lMargin, y: ly, size: 13, font: boldFont, color: teal });
        ly -= 18;
        wrapTextLines(content, font, 9, landscapeWidth - lMargin * 2).forEach((line) => {
          landscapePage.drawText(line, { x: lMargin, y: ly, size: 9, font, color: ink });
          ly -= 12;
        });
        ly -= 14;
        drawPolicyGrid({ page: landscapePage, x: lMargin, y0: ly, maxWidth: landscapeWidth - lMargin * 2, font, boldFont, rgb, clientName: client.name });
        newPage(); // force fresh portrait page so section 5+ don't land back on the pre-section-4 page
        continue;
      }

      const raw = documentTemplates[templateKey(categoryKey, label)] || "";
      const content = raw.replaceAll("The Company", client.name) || `No template text written yet for "${label}".`;
      const bodyLines = wrapTextLines(content, font, 10, maxWidth);

      // Pre-load this section's diagram (if any) so we can measure it before committing to a page.
      const diagramSpec = SECTION_DIAGRAMS[label];
      let diagramImage = null, diagramHeight = 0;
      if (diagramSpec) {
        diagramImage = await loadStaticDiagramImage(pdfDoc, diagramSpec.file);
        if (diagramImage) diagramHeight = scaledImageHeight(diagramImage, maxWidth, diagramSpec.maxHeight) + 14;
      }

      const headingHeight = 20;
      const bodyHeight = bodyLines.length * 13;
      const gapBefore = diagramSpec?.gapBefore ?? 16;
      const totalNeeded = headingHeight + bodyHeight + gapBefore + diagramHeight;
      ensureSpace(Math.min(totalNeeded, pageHeight - topGap - margin)); // cap so oversized sections don't loop forever

      page.drawText(displayLabels[idx], { x: margin, y, size: 12, font: boldFont, color: teal });
      y -= headingHeight;
      bodyLines.forEach((line) => { ensureSpace(13); page.drawText(line, { x: margin, y, size: 10, font, color: ink }); y -= 13; });
      y -= gapBefore;

      if (diagramImage) {
        if (diagramSpec.center) {
          const scale = Math.min(maxWidth / diagramImage.width, diagramSpec.maxHeight / diagramImage.height, 1);
          const drawnW = diagramImage.width * scale;
          y = drawDiagramImage({ page, image: diagramImage, x: margin + (maxWidth - drawnW) / 2, y0: y, maxWidth: drawnW, maxHeight: diagramSpec.maxHeight });
        } else {
          y = drawDiagramImage({ page, image: diagramImage, x: margin, y0: y, maxWidth, maxHeight: diagramSpec.maxHeight });
        }
      }
    }

    // Document Review History — always appended at the very end of the Manual, regardless of
    // what's ticked. Combines the global template revision log (shared across every client) with
    // this specific client's issue date, sorted chronologically. Dates shown as Month YYYY.
    const GLOBAL_DOCUMENT_LOG = [
      { date: "2026-07", details: "Manual created and issued by H.A.R.M Limited" },
    ];
    function fmtMonthYear(dateStr) {
      const d = new Date(dateStr.length === 7 ? `${dateStr}-01` : dateStr);
      return d.toLocaleDateString("en-NZ", { month: "short", year: "numeric" });
    }
    const logEntries = [
      ...GLOBAL_DOCUMENT_LOG,
      { date: today(), details: `Manual issued for ${client.name}` },
    ].sort((a, b) => a.date.localeCompare(b.date));

    ensureSpace(40 + logEntries.length * 22);
    page.drawText("Document Review History", { x: margin, y, size: 12, font: boldFont, color: teal });
    y -= 24;

    const dateColW = 90, rowH = 22;
    const tableTop = y;
    page.drawRectangle({ x: margin, y: tableTop - rowH, width: dateColW, height: rowH, color: rgb(0.93, 0.95, 0.94) });
    page.drawRectangle({ x: margin + dateColW, y: tableTop - rowH, width: maxWidth - dateColW, height: rowH, color: rgb(0.93, 0.95, 0.94) });
    page.drawText("Date", { x: margin + 8, y: tableTop - rowH + 7, size: 9, font: boldFont, color: ink });
    page.drawText("Details", { x: margin + dateColW + 8, y: tableTop - rowH + 7, size: 9, font: boldFont, color: ink });
    y -= rowH;

    logEntries.forEach((entry) => {
      ensureSpace(rowH);
      page.drawRectangle({ x: margin, y: y - rowH, width: maxWidth, height: rowH, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
      page.drawLine({ start: { x: margin + dateColW, y: y }, end: { x: margin + dateColW, y: y - rowH }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
      page.drawText(fmtMonthYear(entry.date), { x: margin + 8, y: y - rowH + 7, size: 9, font, color: ink });
      page.drawText(entry.details, { x: margin + dateColW + 8, y: y - rowH + 7, size: 9, font, color: ink });
      y -= rowH;
    });

    const pageCount = pdfDoc.getPageCount();
    for (let p = 0; p < pageCount; p++) {
      const pg = pdfDoc.getPage(p);
      const footerText = p === 0
        ? `Prepared for ${client.name}  ·  ${fmtDate(today())}`
        : `Prepared for ${client.name}  ·  ${fmtDate(today())}  ·  Page ${p} of ${pageCount - 1}`;
      pg.drawText(footerText, { x: margin, y: 24, size: 8, font, color: slate });
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, "_")}-${category.label.replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Procedures / Policies: each ticked item is a genuinely separate standalone document —
  // download each one as its own real PDF file, not bundled into anything.
  for (let idx = 0; idx < included.length; idx++) {
    const label = included[idx];

    if (label === "Health & Safety Policy") {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const logoImage = await loadClientLogoImage(client, pdfDoc);
      const lw = pageHeight, lh = pageWidth, lMargin = 40; // landscape: swap portrait dims
      const page = pdfDoc.addPage([lw, lh]);
      const lMaxWidth = lw - lMargin * 2;

      const bandHeight = 55;
      page.drawRectangle({ x: 0, y: lh - bandHeight, width: lw, height: bandHeight, color: charcoal });
      const titleSize = 17;
      drawCenteredText(page, "Health & Safety Policy", lw / 2, lh - bandHeight / 2 - titleSize / 3, titleSize, boldFont, rgb(1, 1, 1));
      if (logoImage) {
        const maxLogoH = 30, maxLogoW = 90;
        const scale = Math.min(maxLogoH / logoImage.height, maxLogoW / logoImage.width, 1);
        const w = logoImage.width * scale, h = logoImage.height * scale;
        page.drawImage(logoImage, { x: lw - lMargin - w, y: lh - bandHeight / 2 - h / 2, width: w, height: h });
      }

      let y = lh - bandHeight - 16;
      const introSize = 10;
      const introLines = wrapTextLines(getPolicyIntro(client.name), font, introSize, lMaxWidth * 0.85);
      introLines.forEach((line) => { drawCenteredText(page, line, lw / 2, y, introSize, font, ink); y -= introSize + 3; });
      y -= 6;

      const bottomY = drawPolicyGrid({ page, x: lMargin, y0: y, maxWidth: lMaxWidth, font, boldFont, rgb, clientName: client.name });

      let sy = bottomY - 20;
      const rightColX = lw - lMargin - 200;
      page.drawText("Director Name: _______________________________", { x: lMargin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Date: ${fmtDate(today())}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      sy -= 24;
      page.drawText("Signed: _______________________________", { x: lMargin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Review Date: ${fmtDate(addDays(today(), 365))}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${client.name.replace(/\s+/g, "_")}-Health_Safety_Policy.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      continue;
    }

    const POLICIES_WITH_SIGNOFF = ["Wellbeing Policy", "Driver Statement Policy", "Environmental Policy", "Fatigue & Stress Management Policy"];
    if (POLICIES_WITH_SIGNOFF.includes(label)) {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const logoImage = await loadClientLogoImage(client, pdfDoc);

      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      const bandHeight = 100;
      const drawHeader = (pg) => {
        pg.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: charcoal });
        if (logoImage) {
          const maxLogoH = 36, maxLogoW = 110;
          const scale = Math.min(maxLogoH / logoImage.height, maxLogoW / logoImage.width, 1);
          const w = logoImage.width * scale, h = logoImage.height * scale;
          pg.drawImage(logoImage, { x: pageWidth - margin - w, y: pageHeight - bandHeight / 2 - h / 2, width: w, height: h });
        }
        pg.drawText(category.label.toUpperCase(), { x: margin, y: pageHeight - 38, size: 9, font: boldFont, color: teal });
        pg.drawText(label, { x: margin, y: pageHeight - 62, size: 15, font: boldFont, color: rgb(1, 1, 1) });
      };
      drawHeader(page);
      let y = pageHeight - bandHeight - 30;
      const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); drawHeader(page); y = pageHeight - bandHeight - 30; };
      const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };

      const raw = documentTemplates[templateKey(categoryKey, label)] || "";
      const content = raw.replaceAll("The Company", client.name) || `No template text written yet for "${label}".`;
      wrapTextLines(content, font, 10, maxWidth).forEach((line) => {
        ensureSpace(13);
        page.drawText(line, { x: margin, y, size: 10, font, color: ink });
        y -= 13;
      });

      // Sign-off block always sits at a fixed spot near the bottom of whichever page the
      // text ends on, rather than floating directly under wherever the text happens to end.
      // If the body text ran too close to that fixed spot, push the sign-off to a fresh page.
      if (y < margin + 100) newPage();
      let sy = margin + 30;
      const rightColX = pageWidth - margin - 200;
      page.drawText("Director Name: _______________________________", { x: margin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Date: ${fmtDate(today())}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      sy -= 28;
      page.drawText("Signed: _______________________________", { x: margin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Review Date: ${fmtDate(addDays(today(), 365))}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${client.name.replace(/\s+/g, "_")}-${label.replace(/\s+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      continue;
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoImage = await loadClientLogoImage(client, pdfDoc);

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    const bandHeight = 100;
    const drawProcHeader = (pg) => {
      pg.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: charcoal });
      if (logoImage) {
        const maxLogoH = 36, maxLogoW = 110;
        const scale = Math.min(maxLogoH / logoImage.height, maxLogoW / logoImage.width, 1);
        const w = logoImage.width * scale, h = logoImage.height * scale;
        pg.drawImage(logoImage, { x: pageWidth - margin - w, y: pageHeight - bandHeight / 2 - h / 2, width: w, height: h });
      }
      const titleSize = 17;
      pg.drawText(label, { x: margin, y: pageHeight - 55, size: titleSize, font: boldFont, color: rgb(1, 1, 1) });
      pg.drawText(client.name, { x: margin, y: pageHeight - 75, size: 10, font, color: rgb(0.72, 0.78, 0.78) });
    };
    drawProcHeader(page);

    let y = pageHeight - bandHeight - 30;
    const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); drawProcHeader(page); y = pageHeight - bandHeight - 30; };
    const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };

    // Reference diagrams (matrices, cycles, symbol charts) are drawn inline, right after the
    // paragraph they relate to — matching how they sit in the real source documents. Genuine
    // step-by-step flowcharts are kept as appendix pages at the end (see drawAppendix below).
    const INLINE_DIAGRAMS = {
      "Hazard & Risk Management Procedure": {
        5: [{ file: "risk-matrix.png", maxHeight: 160 }],
        6: [{ file: "managing-risks-hazards-cycle.png", maxHeight: 250 }],
        7: [{ file: "hierarchy-of-controls.png", maxHeight: 170 }],
      },
      "Hazardous Substances Procedure": {
        2: [{ file: "hazard-symbols-1.png", maxHeight: 320 }, { file: "hazard-symbols-2.png", maxHeight: 320 }],
      },
    };
    const drawInlineDiagram = async (filename, maxHeight) => {
      const img = await loadStaticDiagramImage(pdfDoc, filename);
      if (!img) return;
      y -= 8;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      ensureSpace(h + 16);
      page.drawImage(img, { x: margin + (maxWidth - w) / 2, y: y - h, width: w, height: h });
      y -= h + 16;
    };

    const raw = documentTemplates[templateKey(categoryKey, label)] || "";
    const content = raw.replaceAll("The Company", client.name) || `No template text written yet for "${label}".`;
    const inlineMap = INLINE_DIAGRAMS[label] || {};
    const paragraphs = content.split("\n\n");

    // Most paragraphs in these procedures follow a "Heading: body text" or "Heading? body
    // text" pattern — split that off and draw the heading bold + teal on its own line.
    const splitHeading = (text) => {
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0 && colonIdx < 60) return { heading: text.slice(0, colonIdx + 1), body: text.slice(colonIdx + 1).trim() };
      const qIdx = text.indexOf("? ");
      if (qIdx > 0 && qIdx < 40) return { heading: text.slice(0, qIdx + 1), body: text.slice(qIdx + 1).trim() };
      return { heading: null, body: text };
    };

    // Measure the whole document first: if it would comfortably fit on one page at the
    // minimum gap, spread the leftover space evenly between paragraphs (up to a sensible
    // cap) so short procedures fill the page nicely instead of leaving a big empty gap at
    // the bottom. Longer documents that need multiple pages anyway just use the minimum.
    const MIN_GAP = 10, MAX_GAP = 26;
    const measured = paragraphs.map((p) => {
      const { heading, body } = splitHeading(p);
      const bodyLines = wrapTextLines(body, font, 10, maxWidth);
      return { heading, body, bodyLines, fixedHeight: (heading ? 15 : 0) + bodyLines.length * 13 };
    });
    const totalFixedHeight = measured.reduce((sum, m) => sum + m.fixedHeight, 0);
    const fullPageHeight = pageHeight - bandHeight - 30 - margin;
    const hasInlineDiagrams = Object.keys(inlineMap).length > 0;
    let paraGap = MIN_GAP;
    if (!hasInlineDiagrams && totalFixedHeight + paragraphs.length * MIN_GAP <= fullPageHeight) {
      paraGap = Math.min(MAX_GAP, (fullPageHeight - totalFixedHeight) / paragraphs.length);
    }

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const { heading, bodyLines } = measured[pIdx];
      const paraHeight = measured[pIdx].fixedHeight + paraGap;
      // Orphan control: if the whole paragraph doesn't fit but a fresh page would fit at
      // least its heading + a couple of lines, jump to a fresh page now rather than
      // stranding a single line at the bottom of this one.
      if (y - paraHeight < margin && paraHeight <= fullPageHeight) newPage();

      if (heading) {
        ensureSpace(15);
        page.drawText(heading, { x: margin, y, size: 10, font: boldFont, color: teal });
        y -= 15;
      }
      bodyLines.forEach((line) => {
        ensureSpace(13);
        page.drawText(line, { x: margin, y, size: 10, font, color: ink });
        y -= 13;
      });
      y -= paraGap;
      if (inlineMap[pIdx]) {
        for (const d of inlineMap[pIdx]) {
          await drawInlineDiagram(d.file, d.maxHeight);
        }
      }
    }

    // Genuine step-by-step process flowcharts are appended at the end of each procedure as
    // their own labelled appendix pages.
    const drawAppendix = async (title, filename) => {
      newPage();
      page.drawText(`Appendix: ${title}`, { x: margin, y, size: 13, font: boldFont, color: teal });
      y -= 24;
      const img = await loadStaticDiagramImage(pdfDoc, filename);
      if (img) {
        const availW = maxWidth, availH = y - margin;
        const scale = Math.min(availW / img.width, availH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: margin + (maxWidth - w) / 2, y: y - h, width: w, height: h });
        y -= h + 14;
      }
    };

    if (label === "Hazard & Risk Management Procedure") {
      await drawAppendix("Hazard Identification Process", "hazard-identification-process.png");
      await drawAppendix("Risk Management Process", "risk-management-process.png");
      await drawAppendix("Notifiable Hazardous Work Process", "notifiable-hazardous-work-process.png");
    }
    if (label === "Incident Reporting & Investigation Procedure") {
      await drawAppendix("Incident Reporting Process", "incident-investigation-process.png");
      await drawAppendix("Notifiable Event Process", "notifiable-event-process.png");
    }
    if (label === "Contractor Management Procedure") {
      await drawAppendix("Contractor Management Process", "contractor-management-process.png");
    }
    if (label === "Plant & Equipment Procedure") {
      await drawAppendix("Plant & Equipment Process", "plant-equipment-process.png");
    }
    if (label === "Induction & Training Procedure") {
      await drawAppendix("Induction & Training Process", "induction-training-process.png");
    }

    const pageCount = pdfDoc.getPageCount();
    const monthYear = new Date().toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
    for (let p = 0; p < pageCount; p++) {
      const pg = pdfDoc.getPage(p);
      pg.drawText(`Developed by OSHE for ${client.name}`, { x: margin, y: 24, size: 8, font, color: slate });
      const rightText = pageCount > 1 ? `${monthYear}  ·  Page ${p + 1} of ${pageCount}` : monthYear;
      const rightW = font.widthOfTextAtSize(rightText, 8);
      pg.drawText(rightText, { x: pageWidth - margin - rightW, y: 24, size: 8, font, color: slate });
    }

    const bytes = await pdfDoc.save();
    const safeName = label.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, "_")}-${safeName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    // A small gap between each download — most browsers will block or warn on a burst of
    // simultaneous downloads triggered from one click, so this keeps it reliable.
    if (idx < included.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
}


function SystemsView({ clients, selectedId, setSelectedId, documentTemplates, saveDocumentTemplate, systemReviewLog, addSystemReviewLogEntry }) {
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [mode, setMode] = useState("build");
  const [categoryKey, setCategoryKey] = useState("sections");
  const category = DOCUMENT_CATEGORIES.find((c) => c.key === categoryKey);
  const [checked, setChecked] = useState(() => defaultChecked(client, category));
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [newLogEntry, setNewLogEntry] = useState({ type: "Review", person: TEAM[0], notes: "" });

  useEffect(() => {
    setChecked(defaultChecked(client, category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, categoryKey]);

  useEffect(() => {
    let cancelled = false;
    if (!client.logo) { setLogoPreviewUrl(null); return; }
    getDownloadURL(storageRef(storage, client.logo))
      .then((url) => { if (!cancelled) setLogoPreviewUrl(url); })
      .catch((err) => { console.error("Couldn't load client logo:", err); if (!cancelled) setLogoPreviewUrl(null); });
    return () => { cancelled = true; };
  }, [client.logo]);

  const uploadClientLogo = async (file) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const path = `logos/${client.id}/logo.${ext}`;
      await uploadBytes(storageRef(storage, path), file);
      await updateDoc(doc(db, "clients", client.id), { logo: path });
    } catch (err) {
      console.error("Logo upload failed:", err);
      alert(`Couldn't upload the logo: ${err.message || err}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const items = categoryItems(category);
  const included = items.filter((label) => checked[label]);
  const hasRealAnswers = Boolean(client?.intake?.ohsmsPack);

  const contentFor = (label) => {
    const raw = documentTemplates[templateKey(categoryKey, label)];
    if (!raw) return `No template written yet for "${label}" — add it on the Templates tab.`;
    return raw.replaceAll("The Company", client.name);
  };

  const addLogEntry = () => {
    if (!newLogEntry.notes.trim()) return;
    addSystemReviewLogEntry({ date: today(), type: newLogEntry.type, person: newLogEntry.person, notes: newLogEntry.notes });
    setNewLogEntry({ type: "Review", person: TEAM[0], notes: "" });
  };

  const [newReissueMonth, setNewReissueMonth] = useState("");
  const addReissueEntry = () => {
    if (!newReissueMonth) return;
    const entry = { id: Date.now(), monthYear: newReissueMonth };
    updateDoc(doc(db, "clients", client.id), { reissueLog: [...(client.reissueLog || []), entry] });
    setNewReissueMonth("");
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex rounded-lg p-1 w-fit" style={{ background: T.paperAlt }}>
        {[{ key: "build", label: "Build" }, { key: "templates", label: "Templates" }, { key: "reviewlog", label: "Review Log" }].map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)} className="text-xs font-semibold px-4 py-1.5 rounded-md"
            style={{ background: mode === m.key ? T.card : "transparent", color: mode === m.key ? T.tealDark : T.slate }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "build" && (
        <div className="flex flex-1 gap-6 min-h-0">
          <div className="w-64 shrink-0 flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Client</div>
              <select value={client.id} onChange={(e) => setSelectedId(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {hasRealAnswers ? (
                <div className="text-[11px] mt-1.5" style={{ color: T.tealDark }}>Pre-filled from their sign-up form answers</div>
              ) : (
                <div className="text-[11px] mt-1.5" style={{ color: T.slateLight }}>No sign-up answers on file — defaults only, tick manually</div>
              )}
            </div>
            <div className="flex flex-col gap-1 rounded-lg p-1" style={{ background: T.paperAlt }}>
              {DOCUMENT_CATEGORIES.map((cat) => (
                <button key={cat.key} onClick={() => setCategoryKey(cat.key)} className="text-xs font-semibold py-1.5 rounded-md text-left px-2"
                  style={{ background: categoryKey === cat.key ? T.card : "transparent", color: categoryKey === cat.key ? T.tealDark : T.slate }}>
                  {cat.label}
                </button>
              ))}
            </div>
            <Card style={{ padding: 16 }}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Client logo</div>
              <label className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-lg text-xs cursor-pointer"
                style={{ border: `1.5px dashed ${T.slateLight}`, color: T.slate, background: T.paperAlt }}>
                {uploadingLogo ? (
                  "Uploading…"
                ) : logoPreviewUrl ? (
                  <>
                    <img src={logoPreviewUrl} alt="" style={{ height: 32, width: "auto", maxWidth: "80%", objectFit: "contain" }} />
                    <span>Click to replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Upload logo
                  </>
                )}
                <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo} onChange={(e) => uploadClientLogo(e.target.files?.[0])} />
              </label>
              <div className="text-[11px] mt-2" style={{ color: T.slateLight }}>Same spot on every document — the cover header below.</div>
            </Card>
            <Card style={{ padding: 16 }}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Redo reminder</div>
              <div className="text-sm font-medium" style={{ color: T.ink }}>{fmtDate(client.ohsmsDue)}</div>
              <div className="text-xs mt-1" style={{ color: T.slate }}>Auto-reminder fires 1 month prior</div>
            </Card>
          </div>

          <div className="w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>{category.label} {included.length}/{items.length} selected</div>
            {items.map((label) => {
              const isAlways = category.alwaysLabels.includes(label);
              const isComplianceExtra = category.complianceExtraLabels.includes(label);
              const hasContent = Boolean(documentTemplates[templateKey(categoryKey, label)]);
              return (
                <button key={label} onClick={() => setChecked((c) => ({ ...c, [label]: !c[label] }))} className="flex items-start gap-3 p-3 rounded-lg text-left transition-colors"
                  style={{ background: checked[label] ? T.paperAlt : T.card, border: `1px solid ${checked[label] ? T.tealDark : T.border}` }}>
                  {checked[label] ? <CheckCircle2 size={17} color={T.tealDark} className="shrink-0 mt-0.5" /> : <Circle size={17} color={T.slateLight} className="shrink-0 mt-0.5" />}
                  <div>
                    <div className="text-sm font-medium" style={{ color: T.ink }}>{label}</div>
                    {isAlways && <div className="text-[10px]" style={{ color: T.slateLight }}>Always included</div>}
                    {isComplianceExtra && <div className="text-[10px]" style={{ color: T.amber }}>SiteWise / Totika add-on</div>}
                    {!hasContent && <div className="text-[10px]" style={{ color: T.coral }}>No template text yet</div>}
                  </div>
                </button>
              );
            })}
            {items.length === 0 && <div className="text-xs text-center py-6" style={{ color: T.slateLight }}>No items in this category.</div>}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Live preview — {category.label}</div>
              <button
                disabled={included.length === 0 || downloading}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    await downloadBuildPdf({ client, category, categoryKey, included, documentTemplates });
                  } catch (err) {
                    console.error("PDF download failed:", err);
                    alert(`Couldn't generate the PDF: ${err.message || err}`);
                  } finally {
                    setDownloading(false);
                  }
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: included.length === 0 ? T.paperAlt : T.tealDark, color: included.length === 0 ? T.slateLight : "#fff", cursor: included.length === 0 ? "not-allowed" : "pointer" }}
              >
                {downloading ? "Generating…" : categoryKey === "sections" ? "Download as PDF" : "Download as individual PDFs"}
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}`, background: "#fff", maxHeight: "calc(100% - 28px)", overflowY: "auto" }}>
              <div className="flex items-center justify-between" style={{ background: T.charcoal, padding: "22px 32px", color: "#fff" }}>
                <div>
                  <div className="text-xs tracking-widest uppercase" style={{ color: T.teal }}>{category.label}</div>
                  <div className="text-xl font-bold mt-1">{client.name}</div>
                  <div className="text-xs mt-1" style={{ color: "#9FB4B3" }}>Prepared by OSHE Limited</div>
                </div>
                {logoPreviewUrl && (
                  <div className="w-16 h-10 rounded flex items-center justify-center overflow-hidden shrink-0 ml-4" style={{ background: "#fff" }}>
                    <img src={logoPreviewUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  </div>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                {included.length === 0 && <div className="text-sm text-center py-10" style={{ color: T.slateLight }}>Nothing selected — tick items on the left to build this document.</div>}
                {categoryKey !== "sections" && included.length > 0 && (
                  <div className="text-[11px] -mt-2 mb-1" style={{ color: T.slateLight }}>Each of these downloads as its own separate PDF, not one combined document.</div>
                )}
                {(() => {
                  const displayLabels = categoryKey === "sections" ? renumberSections(included) : included;
                  return included.map((label, i) => (
                    <div key={label} className={categoryKey === "sections" ? "" : "pb-4"} style={categoryKey === "sections" ? {} : { borderBottom: i < included.length - 1 ? `1px dashed ${T.border}` : "none" }}>
                      <div className="text-sm font-bold" style={{ color: T.tealDark }}>{categoryKey === "sections" ? displayLabels[i] : `${i + 1}. ${label}`}</div>
                      <div className="text-xs mt-1 leading-relaxed whitespace-pre-wrap" style={{ color: T.slate }}>{contentFor(label)}</div>
                    </div>
                  ));
                })()}
              </div>
              {included.length > 0 && (
                <div className="px-6 py-3 text-[11px]" style={{ borderTop: `1px solid ${T.border}`, color: T.slateLight }}>
                  Prepared for {client.name} &middot; {fmtDate(today())}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === "templates" && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="text-sm" style={{ color: T.slate }}>
            Write the master text once here — every client's document pulls from this. Type <b>The Company</b> anywhere you'd refer to the client, and it's swapped for their real name automatically when built.
          </div>
          <div className="flex gap-2">
            {DOCUMENT_CATEGORIES.map((cat) => (
              <button key={cat.key} onClick={() => setCategoryKey(cat.key)} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: categoryKey === cat.key ? T.tealDark : T.paperAlt, color: categoryKey === cat.key ? "#fff" : T.slate }}>
                {cat.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-3">
            {categoryItems(category).map((label) => {
              const key = templateKey(categoryKey, label);
              return (
                <Card key={key} style={{ padding: 16 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-sm font-semibold" style={{ color: T.ink }}>{label}</div>
                  </div>
                  <textarea
                    defaultValue={documentTemplates[key] || ""}
                    onBlur={(e) => saveDocumentTemplate(key, e.target.value)}
                    placeholder="e.g. The Company is committed to ensuring the health and safety of all workers..."
                    rows={3}
                    className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y"
                    style={{ border: `1px solid ${T.border}`, color: T.ink }}
                  />
                  <div className="text-[11px] mt-1" style={{ color: T.slateLight }}>Saves automatically when you click away.</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {mode === "reviewlog" && (
        <div className="flex-1 min-h-0 flex flex-col gap-6 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-bold" style={{ color: T.ink }}>System Review Log</div>
              <button onClick={() => exportReviewLogPdf(systemReviewLog)} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                Download log as PDF
              </button>
            </div>
            <div className="text-xs mb-3" style={{ color: T.slateLight }}>
              Shared across every client — when the templates or system itself change, that's one entry here, not something logged per client. This never appears on the manual/policy/procedure documents themselves, only here and in the downloadable log.
            </div>
            <Card style={{ padding: 16 }} className="flex items-center gap-2 flex-wrap">
              <select value={newLogEntry.type} onChange={(e) => setNewLogEntry({ ...newLogEntry, type: e.target.value })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                <option>Review</option>
                <option>Update</option>
              </select>
              <select value={newLogEntry.person} onChange={(e) => setNewLogEntry({ ...newLogEntry, person: e.target.value })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input placeholder="What was reviewed or changed?" value={newLogEntry.notes} onChange={(e) => setNewLogEntry({ ...newLogEntry, notes: e.target.value })}
                className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 200 }} />
              <button onClick={addLogEntry} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log entry</button>
            </Card>
            <div className="flex flex-col gap-2 mt-2">
              {[...systemReviewLog].reverse().map((entry) => (
                <Card key={entry.id} style={{ padding: 14 }}>
                  <div className="flex items-center justify-between">
                    <Pill color={entry.type === "Update" ? T.amber : T.tealDark} bg={T.paperAlt}>{entry.type}</Pill>
                    <div className="text-xs" style={{ color: T.slate }}>{fmtDate(entry.date)} &middot; {entry.person}</div>
                  </div>
                  <div className="text-sm mt-2" style={{ color: T.ink }}>{entry.notes}</div>
                </Card>
              ))}
              {systemReviewLog.length === 0 && <div className="text-xs text-center py-6" style={{ color: T.slateLight }}>No entries logged yet.</div>}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 20 }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-bold" style={{ color: T.ink }}>Reissue History</div>
              <select value={client.id} onChange={(e) => setSelectedId(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="text-xs mb-3" style={{ color: T.slateLight }}>
              The one thing that genuinely is specific to {client.name} — when their documents were last reissued. Month and year only.
            </div>
            <Card style={{ padding: 16 }} className="flex items-center gap-2">
              <input type="month" value={newReissueMonth} onChange={(e) => setNewReissueMonth(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              <button onClick={addReissueEntry} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log reissue</button>
            </Card>
            <div className="flex flex-wrap gap-2 mt-2">
              {[...(client.reissueLog || [])].reverse().map((entry) => (
                <Pill key={entry.id} color={T.ink} bg={T.paperAlt}>
                  {new Date(entry.monthYear + "-02").toLocaleDateString("en-NZ", { month: "long", year: "numeric" })}
                </Pill>
              ))}
              {(!client.reissueLog || client.reissueLog.length === 0) && <div className="text-xs py-2" style={{ color: T.slateLight }}>No reissues logged yet for {client.name}.</div>}
            </div>
          </div>
        </div>
      )}
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
                          <input readOnly value={`https://signup.oshe.co.nz/${l.id}`}
                            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.slate, background: T.paperAlt }} />
                          <button onClick={() => navigator.clipboard.writeText(`https://signup.oshe.co.nz/${l.id}`)}
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

  // Document templates — the master content library. One doc per item (e.g. "sections::Introduction"),
  // shared across every client. Written once by Sophie/Vanessa, substituted per client at generation time.
  const [documentTemplates, setDocumentTemplates] = useState({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "documentTemplates"), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data().content || ""; });
      setDocumentTemplates(map);
    }, (err) => console.error("Document templates subscription failed:", err));
    return unsub;
  }, []);
  const saveDocumentTemplate = (key, content) => setDoc(doc(db, "documentTemplates", key), { content });

  // System Review Log — global, not per-client. When the shared templates/system change,
  // that's one entry that applies to every client, not something logged separately for each.
  const [systemReviewLog, setSystemReviewLog] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "systemReviewLog"), (snap) => setSystemReviewLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("System review log subscription failed:", err));
    return unsub;
  }, []);
  const addSystemReviewLogEntry = (entry) => setDoc(doc(db, "systemReviewLog", "log" + Date.now()), entry);

  // One-time seed of real procedure content, condensed from OSHE's actual reference documents.
  // Never overwrites anything already written — only fills in a key if it's genuinely empty,
  // so any edits Sophie/Vanessa have already made are always safe.
  useEffect(() => {
    const realProcedureContent = {
      "Plant & Equipment Procedure": "Purpose: this procedure defines the requirements for managing plant and equipment, including the application of the risk management process to identify hazards associated with plant and equipment use, legislative and manufacturer's compliance requirements regarding testing, maintenance, installation, commissioning, use, repair, alteration, dismantling, storage and disposal, and the requirements to provide relevant information, training, and licensing to safely operate plant.\n\nScope: this procedure applies to all plant and equipment used in The Company.\n\nHazard Identification and Risk Assessment: The Company identifies and completes a risk assessment of all plant and equipment in the workplace, in consultation with workers, recording this information in The Company's Hazard Register and Plant and Equipment Register in the HARM App. Examples of plant and equipment include excavators, table saws, and powered hand tools. Hazard identification takes place when new plant and equipment are introduced, for all existing plant and equipment, before any changes are made to the system of work, before plant is used in a manner other than what it was designed for, and when new safety information becomes available.\n\nRisk Management: The Company applies the hierarchy of controls to plant risks — eliminating hazards or hazardous work practices where possible; substituting the plant, or hazardous parts of it, with lower-risk alternatives; isolating workers from hazardous plant by distance or barriers; incorporating engineering controls including modifications to tools or equipment; applying administrative controls such as safe operating procedures; using PPE as the last line of defence where higher-order controls aren't practicable, or to supplement other controls; monitoring and evaluating controls for effectiveness; recommencing the risk assessment process if new hazards are identified; and communicating the outcomes of the risk assessment process.\n\nIntroducing new Plant & Equipment: a risk assessment is completed prior to release for operation and the item added to The Company's hazard register, following a pre-purchase review with relevant stakeholders including Health and Safety Representatives and the workers who will use the new plant; a supplier demonstration where relevant and practicable; a review of the supplier's risk assessment and the manufacturer's operating instructions; a review of legislative and relevant New Zealand Standard requirements including registration, certification and licensing; identification and control of specific plant hazards such as moving parts, manual tasks, pressure, electricity, noise, or extreme temperatures; identification of requirements for installation, maintenance, inspection and storage; and identification of any requirements for decommissioning or disposal of replaced plant.\n\nSafe Operating Procedures: upon release of plant or equipment, an SOP is developed and workers signed off during the competency assessment period within the induction panel of the HARM App. SOP documentation is reviewed annually, or when a new process, business change, or plant/equipment change arises — The Company informs H.A.R.M Limited whenever this happens, with the annual update considering legislative changes, industry learnings, incidents, or additional WorkSafeNZ guidance.\n\nCompetence: plant and equipment is only used by trained, licensed (where applicable) and competent workers. The Company determines and takes action to ensure competency based on education, induction, training and experience, retaining documentation as evidence, and ensures workers maintain competence through ongoing review and annual training plans. All equipment has manufacturer's instructions on safe operation and maintenance, and a documented SOP where required. Refer: Induction & Training Process.\n\nMaintenance & Calibration: a record of inspections, calibration, and maintenance is kept for each item of plant and equipment, including scheduled maintenance, breakdown maintenance, and replacement of parts outside the scheduled program, determined in line with supplier or manufacturer recommendations. Records include the plant/equipment name, location, serial or identification number, description of work performed, completion date, and who performed the work. This register is maintained by The Company's administrative team, with service dates entered into the HARM App so alerts are sent when plant or equipment is due for service.\n\nReviewing Controls: The Company is responsible for reviewing the effectiveness of risk controls in consultation with the HSR and employees, reviewing the completed risk assessment, hazard register, and other relevant sources such as operating manuals to determine whether current controls remain appropriate. Any changes to risk controls are documented on the relevant risk assessment and the Hazard Register. Plant and equipment controls are reviewed and revised whenever the system of work changes, the plant is used in a manner other than designed, an incident occurs involving the item, or new safety information becomes available.",
      "Wellbeing Procedure": "Purpose: to promote and maintain the mental and emotional wellbeing of all employees, address stress, and prevent and manage bullying and psychosocial hazards in the workplace.\n\nScope: this procedure applies to all employees, contractors, and visitors.\n\nDefinitions: Wellbeing is a state of mental and emotional health where individuals feel supported and valued. Bullying is repeated and unreasonable behaviour directed towards an employee or group that creates a risk to health and safety. Psychosocial Hazards are risks arising from the interaction between work and the work environment that may affect mental health. Stress is a state of mental or emotional strain resulting from challenging or adverse circumstances.\n\nResponsibilities: Employers ensure a safe work environment, implement wellbeing initiatives, and address stress and bullying promptly. Managers/Supervisors support staff wellbeing, manage stress, model respectful behaviour, and act on reports of bullying. Employees contribute to a positive workplace culture, manage personal stress, report concerns, and seek support when needed.\n\nPsychosocial Wellbeing: support systems provide access to mental health resources such as Mates in Construction, tailored to the construction industry; workload management monitors and manages workloads to prevent excessive stress, encouraging reasonable deadlines and break times; and work-life balance is promoted through practices supporting a healthy balance between work and personal life.\n\nStress Management: employees are educated about stress, its signs, and management techniques; support resources are made available such as Lifeline (0800 543 354), the Suicide Crisis Helpline (0508 828 865), and the Mental Health Foundation of New Zealand; flexible working options are provided where possible to help manage stress; and a supportive work environment is created that minimises stressors such as excessive workloads or unclear expectations.\n\nBullying Prevention: The Company adopts and enforces a zero-tolerance policy towards bullying; provides training on recognising, preventing, and addressing bullying; implements clear reporting procedures including confidential options; investigates all reports promptly and fairly; and offers support to those affected, including access to counselling services.\n\nReporting and Addressing Bullying: employees initially report bullying concerns to their direct supervisor or manager. If the supervisor is involved in the issue, or the employee feels uncomfortable reporting to them, the matter is escalated directly to the Director. Reporting to the Director involves: submitting a formal written report detailing the date and time of incidents, a description of the behaviour, names of individuals involved, and any evidence or documentation; the Director handling the report with strict confidentiality, sharing information only with relevant parties as necessary; acknowledging receipt within 2 working days and outlining next steps; initiating a thorough and impartial investigation, which may involve interviewing involved parties and witnesses and reviewing documentation; determining appropriate actions based on findings, which may include disciplinary measures, mediation, or other corrective actions; and providing feedback to the reporting employee about the outcome and any steps taken.\n\nReview and Improvement: the effectiveness of wellbeing initiatives, stress management, and anti-bullying measures is regularly reviewed; employee feedback is sought to improve wellbeing practices and address emerging issues; and this procedure is revised as needed to reflect changes in legislation, workplace conditions, and best practices.",
      "Workplace Inspection Procedure": "Objective: this procedure aims to conduct regular workplace inspections to identify and address potential health and safety hazards, ensuring a safe and healthy environment for all employees.\n\nScope: this procedure applies to all areas within The Company where work is performed, involving designated personnel responsible for conducting physical inspections and ensuring compliance with health and safety regulations.\n\nAssignment of Responsibilities: the Health and Safety Officer and/or designated personnel oversee the inspection process, with designated individuals appointed to conduct inspections within their respective areas.\n\nFrequency of Inspections: regular inspections are scheduled at intervals suitable for the nature of work and risk levels, with high-risk areas requiring more frequent inspections for thorough monitoring.\n\nConducting the Inspection: inspectors systematically assess the workplace, focusing on machinery, equipment, work processes, and environmental conditions, documenting observed hazards and gathering feedback from employees.\n\nRisk Assessment: identified hazards are assessed to determine their level of risk, considering factors such as likelihood and severity.\n\nCorrective Actions: hazards are prioritised based on risk level, with appropriate corrective actions implemented — which may include controls, training, or procedural changes.\n\nDocumentation: records of inspection findings are maintained, including identified hazards, risk assessments, and corrective actions, with reports documented for future reference.\n\nFollow-Up and Monitoring: implemented corrective actions are followed up to ensure effectiveness, with inspection records regularly monitored to track trends and identify recurring issues.\n\nContinuous Improvement: feedback from inspections is used to improve the process, with the procedure reviewed periodically to ensure alignment with regulations and best practices. By following this procedure, The Company ensures a proactive approach to maintaining a safe and healthy workplace environment while fostering a culture of safety among its employees.",
      "Continual Improvement Procedure": "Scope: This procedure applies to all departments, facilities, and activities within The Company and encompasses all aspects related to health and safety management.\n\nIdentification of Improvement Opportunities: The Company continuously evaluates its health and safety performance through regular audits, inspections, incident investigations, and feedback mechanisms from employees across the business.\n\nSetting Objectives and Targets: Based on the identified improvement opportunities, The Company establishes specific health and safety objectives and targets that are SMART (Specific, Measurable, Achievable, Relevant, Time-bound) and applicable to all areas of operation.\n\nAction Planning: Action plans are developed to address the identified improvement areas. These plans outline clear steps, assign responsibilities, allocate resources, and set timelines for implementation.\n\nImplementation of Action Plans: The Company executes the action plans according to the established timelines and responsibilities, ensuring that improvements are implemented uniformly across all areas of operation.\n\nMonitoring and Measurement: Progress towards achieving the objectives and targets is regularly monitored and measured using relevant indicators and performance metrics.\n\nReview and Evaluation: Periodic reviews are conducted to evaluate the effectiveness of implemented actions in achieving the desired improvements. This involves analysing collected data, assessing outcomes against set objectives, and identifying lessons learned.\n\nManagement Review: Senior management at The Company conducts regular reviews of the health and safety continual improvement process, providing oversight, guidance, and support to ensure the effectiveness of improvement efforts and alignment with company goals.\n\nCommunication and Engagement: Transparent communication channels are maintained to keep employees informed about improvement initiatives, progress, and outcomes. Employee engagement and participation are encouraged to foster a culture of continuous improvement at all levels of the company.\n\nDocumentation and Record-Keeping: Comprehensive documentation of the continual improvement process is maintained internally, including records of objectives, action plans, monitoring results, reviews, management decisions, and any relevant communication.\n\nFeedback and Adaptation: Feedback from employees, stakeholders, and external sources is actively sought and considered to refine improvement efforts. The Company remains adaptable to changing circumstances, emerging risks, and evolving best practices.",
      "Fatigue Management Procedure": "Purpose: The Company recognises that workers who are impaired by stress and fatigue are a risk to themselves and those around them. This procedure aims to improve overall safety and wellbeing, to achieve a safe working environment, in support of the Fatigue & Stress Management Policy.\n\nScope: This procedure applies to all workers who carry out work in any capacity for The Company.\n\nWhat is fatigue? Fatigue is a state of mental and/or physical exhaustion which reduces a person's ability to perform work safely and effectively. It can occur because of prolonged mental or physical activity, sleep loss, and/or disruption of the internal body clock, and can be caused by factors which may be work related, non-work related, or a combination of both, accumulating over time. Fatigue reduces alertness, which may lead to errors and an increase in workplace incidents and injuries.\n\nCommon causes of fatigue include general causes such as inadequate restorative sleep (less than 7-8 hours), long periods of being awake (more than 17 hours), sustained mental or physical effort, disruption to the internal biological clock, and health or emotional issues; work-related causes such as poor roster design, extended hours of work, call-out requirements, second jobs, heavy workload within a standard shift, inadequate rest breaks, and a difficult work environment (noise, temperature extremes, conflict); and non-work-related causes such as family responsibilities, social or community obligations, inappropriate use of alcohol, medication or illicit drugs, financial or relationship stress, and physiological factors such as age, medical or mental health conditions and sleeping disorders.\n\nPCBU responsibilities: so far as is reasonably practicable, ensure the health and safety of workers and that others are not put at risk from their work; eliminate risks that arise from work, or minimise them where elimination isn't reasonably practicable; ensure workers take regular, quality rest breaks in their working day; ensure working days are not too long, and where longer days are required ensure adequate rest breaks and downtime; ensure facilities are provided to workers, with the nearest reasonable option factored into planning when not available onsite; ensure fit-for-purpose plant, machinery and equipment is provided; ensure adequate training to complete tasks; engage with workers on health and safety matters and seek their input; and create a positive working environment where good relationships exist and workers are encouraged and supported.\n\nWorker responsibilities: The Company doesn't have sole responsibility for managing fatigue at work — workers must take reasonable care for their own health and safety and that of others. Workers are expected to: turn up in a state fit for work, having done everything possible to get a good sleep and rest; inform their manager or supervisor if a task is beyond their capabilities; recognise the signs and symptoms of fatigue, including feeling constantly tired, having little energy, feeling sluggish, excessive yawning or falling asleep at work, reduced vigilance, bad moods, forgetfulness, inability to concentrate, poor communication, poor decision-making, reduced hand-eye coordination and slower reaction times, as well as less obvious symptoms such as drowsiness, headaches, dizziness, blurred vision or impaired visual perception and a need for extended sleep on days off; communicate with their manager or supervisor if they start showing signs and symptoms of fatigue, and make managers and supervisors aware of other workers who may be fatigued; report fatigue-related incidents; comply with reasonable instructions of their employer; co-operate with any health and safety policy notified to them; and ensure they are adequately trained to complete tasks and identify associated risks, including the signs and symptoms of fatigue.\n\nManagement of fatigue follows five steps: Step 1, hazard identification — identify the factors which may cause fatigue in the workplace. Step 2, risk assessment — assess the risks of injury from fatigue. Step 3, control risks — implement the most effective risk control measures reasonably practicable. Step 4, risk assessment with control measures — re-assess whether the risks of injury from fatigue are adequately controlled. Step 5, monitor and review control measures — review risk control measures to ensure they are working as planned. Workers are consulted at each step of this process, to help identify fatigue risk factors, implement effective controls, and raise awareness of the risks associated with fatigue.\n\nIdentifying factors that may cause fatigue: common contributing factors include work schedules which limit recovery time (such as shift work, night work, extended hours, or limited breaks), job demands involving extended periods of physically or mentally demanding work, the length and quality of sleep, environmental conditions such as heat, cold, vibration or noise, and non-work-related factors such as lifestyle, family responsibilities or health. Managers identify these factors by consulting with workers, reviewing timesheets and overtime data, and reviewing incident data and investigation findings.\n\nAssessing the risk: once a fatigue-related risk is identified, an assessment considers where, which and how many workers are likely to be at risk, how often fatigue is likely to occur, the degree of harm which may result, whether existing controls are effective, what action should be taken, and how urgently. Contributors to fatigue are not considered in isolation, since job demands, hours of work and environmental conditions often combine to increase risk.\n\nControlling the risk: the best way to control the health and safety risks arising from fatigue is to eliminate the causal factors at the source. Where elimination isn't reasonably practicable, the risks are minimised, with the most effective controls always identified in consultation with workers where possible.\n\nA fatigue risk checklist is used to help identify risk factors across mental and physical demands, work scheduling and planning, work time, workplace and environmental conditions, and non-work factors — if the answer to any checklist question points to a risk factor being present, fatigue risks are assessed and strategies put in place to manage it. Minimum rest break requirements follow the Employment Relations Amendment Act 2018 and Employment New Zealand's rest and meal break guidance.",
      "Health & Safety Budget Management Procedure": "Purpose: to establish a clear process for setting, approving, and managing the Health and Safety (H&S) budget, ensuring that all safety-related expenses are adequately covered and controlled.\n\nScope: this procedure applies to all activities related to managing The Company's Health and Safety budget.\n\nRoles and Responsibilities: the Health and Safety Officer/Manager is responsible for proposing the annual H&S budget based on The Company's safety needs. The Business Owner/Director reviews the proposed budget, provides final approval, and oversees any significant expenditure.\n\nBudget Setting Process: the H&S Officer/Manager reviews the previous year's budget as a baseline for the current year; a percentage increase is applied to account for inflation or increased safety needs (for example, a 5% increase); an amount is allocated per employee to cover essential safety needs such as Personal Protective Equipment and training; and additional funds are allocated for upcoming projects with specific H&S requirements, to ensure comprehensive coverage.\n\nBudget Approval Process: routine expenditures within the approved budget for routine safety items are authorised directly by the H&S Officer/Manager. Any expenditure beyond the approved budget is submitted to the Business Owner/Director for review and approval.\n\nBudget Coverage: the budget covers the purchase and maintenance of PPE for all employees; costs associated with safety training programs and certifications; funding for regular safety inspections, compliance audits, and corrective actions; the purchase and upkeep of safety-related equipment such as fire extinguishers and first aid kits; and funding for ongoing H&S programs, awareness campaigns, and safety improvements. All budgets include the necessary time element associated with each item.\n\nRecord & Review: an Annual Health & Safety Budget Approval Form is completed each year, and the budget and objectives are reviewed at monthly management meetings.",
      "Health & Safety Issue Resolution Procedure": "Scope: this process covers the formal resolution of health and safety issues that cannot be resolved through informal channels, involving relevant stakeholders, documentation of the entire process, compliance with legal requirements, and continuous improvement within The Company.\n\nFormal Escalation: where an issue cannot be resolved through informal channels such as consultation and discussion, either party involved may formally escalate the matter to higher management or designated representatives.\n\nNotification: the party initiating the formal escalation notifies their immediate supervisor or manager in writing, outlining the nature of the health and safety issue, previous attempts at resolution, and reasons for escalation.\n\nReview by Management: the supervisor or manager receiving the escalation requests a meeting with relevant stakeholders, including representatives from both sides of the issue, and conducts a thorough review of the matter.\n\nMediation or Facilitation: where deemed necessary, an impartial mediator or facilitator may be appointed to assist in resolving the dispute, helping facilitate constructive dialogue, identify common ground, and explore potential solutions.\n\nConflict Resolution Meeting: a formal meeting is scheduled where all parties involved present their perspectives, concerns, and proposed solutions, aiming to foster open communication, mutual understanding, and agreement on a resolution.\n\nDecision Making: following the conflict resolution meeting, management carefully considers all information presented and works collaboratively with the involved parties to reach a decision that prioritises the health and safety of employees while addressing the concerns raised.\n\nImplementation of Resolutions: once a resolution is agreed, management ensures appropriate actions are taken to implement it effectively and promptly, which may involve updating policies, procedures, or practices, or providing necessary resources or support.\n\nFollow-Up and Monitoring: management conducts regular follow-up and monitoring to ensure agreed resolutions are being implemented effectively and that any remaining concerns are addressed in a timely manner.\n\nDocumentation: comprehensive documentation of the formal escalation process, including meeting minutes, decisions made, and actions taken, is maintained for record-keeping and future reference.\n\nClosure and Feedback: once resolved, all parties are provided with closure and an opportunity to give feedback on the resolution process, helping identify areas for improvement and strengthening future conflict resolution efforts. Following this structured process, The Company ensures disputes are addressed in a fair, transparent, and equitable manner, promoting a safe and healthy work environment for all employees.",
      "Health Monitoring Procedure": "Introduction: this procedure outlines the health monitoring process followed by The Company in compliance with New Zealand legislation, including the Health and Safety at Work Act 2015, the Privacy Act 2020, and related regulations. The goal is to protect the health and wellbeing of employees by identifying and mitigating risks associated with workplace hazards.\n\nScope: this process applies to all employees and contractors working under The Company's control, covering health monitoring activities related to exposure to hazardous substances, noise, and other workplace risks.\n\nEmployer responsibilities: ensure health monitoring is carried out where there is a risk to employee health, in compliance with the Health and Safety at Work Act 2015; provide employees with information about the health monitoring process and their rights under the Privacy Act 2020; select and engage competent health monitoring providers, including occupational nurses and other qualified health professionals; and maintain health monitoring records securely and confidentially.\n\nEmployee responsibilities: participate in health monitoring programs as required; report any health concerns to their supervisor or designated health and safety representative; follow safety procedures and use PPE as instructed; and understand their right to refuse participation in health monitoring and the implications of refusal, which are documented and managed under the Health and Safety at Work Act 2015.\n\nHazard identification: regular risk assessments are conducted to identify potential health hazards in the workplace, with identified hazards documented and their level of risk assessed.\n\nHealth monitoring requirements are determined based on identified hazards and the level of risk, referring to WorkSafe New Zealand guidelines and relevant regulations, and may include lung function tests, hearing tests, and vision tests based on risk assessments specific to each job role.\n\nSelection of providers: qualified and accredited health monitoring providers, including occupational nurses, are engaged, with expertise in the specific types of monitoring required such as audiometry, lung function tests, and vision tests.\n\nHealth monitoring procedures: regular assessments are scheduled for employees exposed to identified hazards; employees are informed of the purpose, process, and confidentiality of health monitoring in line with the Privacy Act 2020; written consent is obtained before monitoring; the employee's GP is involved in managing any suboptimal results; post-critical event testing follows any incident that could impact employee health; and exit testing is conducted for employees leaving The Company to document their health status at departure.\n\nRecord keeping and confidentiality: health monitoring records are maintained securely and confidentially in compliance with the Privacy Act 2020, kept for at least 30 years as required by legislation, with health monitoring companies maintaining their own records securely for the same duration. Employees are given access to their own records upon request.\n\nReview and follow-up: health monitoring results are reviewed to identify trends or emerging health issues; corrective actions are implemented to mitigate identified risks; follow-up monitoring is conducted where required to assess the effectiveness of controls; and the employee's GP is involved in managing any suboptimal results and providing appropriate medical advice.\n\nTraining and communication: employees are trained on the importance of health monitoring and their role in the process, and results are communicated in aggregate form to relevant stakeholders.\n\nLegal compliance: the health monitoring process is regularly reviewed and updated to ensure compliance with New Zealand legislation, staying informed of regulatory changes that may impact requirements.\n\nContinuous improvement: feedback is sought from employees and health monitoring providers to improve the process, with improvements implemented based on feedback and new best practices in health and safety.",
      "Return to Work Procedure": "Purpose: to provide a structured process for employees returning to work after an injury, in alignment with ACC (Accident Compensation Corporation) guidelines, and to ensure employees are supported during their recovery and reintegration into the workplace.\n\nScope: this procedure applies to all employees of The Company who have suffered a workplace injury, or an injury outside of work that is covered by ACC.\n\nReporting the Injury: employees immediately report any injury sustained at work, or outside of work but covered by ACC, to their direct supervisor or the designated health and safety representative. Timely reporting ensures ACC claims are processed promptly and appropriate support can be provided.\n\nEngagement with ACC: upon receiving an injury report, The Company works closely with ACC to ensure the claim is submitted and processed effectively. Where required, ACC may offer rehabilitation or assistance for the injured employee's recovery, and The Company ensures ACC guidelines are followed for returning to work.\n\nIndividual Return to Work Plan: an individual RTW plan is developed for each employee based on the nature of the injury and the recommendations of health professionals, in conjunction with ACC. An assessment meeting is arranged with the employee, their supervisor, and relevant medical practitioners (such as a GP or physiotherapist) to assess the injury and determine the employee's capabilities and restrictions. The RTW plan includes the employee's capabilities and work restrictions, a gradual return-to-work schedule covering hours and duties, reasonable accommodations if needed, regular monitoring of progress, and coordination with ACC for any additional support or changes to the plan.\n\nSupporting the Return to Work Process: The Company is committed to supporting employees throughout the return-to-work process through modified duties, where temporary adjustments are made to tasks to align with the employee's abilities while they recover; gradual reintroduction, supporting an increase in working hours or tasks as the employee's condition allows; and ongoing communication, with regular check-ins between the employee, supervisor, and HR to ensure the plan remains effective and is adjusted as needed.\n\nMonitoring and Adjusting the Plan: the RTW plan is reviewed regularly and adjusted based on the employee's recovery and feedback. Where further medical treatment or rehabilitation is required, The Company cooperates with ACC to modify the plan accordingly.\n\nConfidentiality: all information regarding the employee's injury, recovery, and RTW plan is kept confidential and only shared with relevant personnel involved in the process, in line with all applicable privacy laws and policies.\n\nEmployee responsibilities: follow medical advice and attend all required medical appointments; actively engage with the RTW plan and communicate any concerns or issues; and notify their supervisor promptly of any changes in their condition.\n\nEmployer responsibilities: cooperate with ACC in developing the RTW plan; ensure a safe working environment during the employee's return to work; provide reasonable accommodations to support recovery; and regularly review the RTW plan, making adjustments as necessary.\n\nEnd of Process: once the employee has fully recovered, or reached their maximum medical improvement and is capable of performing their full duties, the RTW process is considered complete — though ongoing monitoring or light duties may still be available if required.",
      "Contractor Management Procedure": "The purpose of this procedure is to define how contractors at The Company are selected and managed with respect to the health and safety of workers, and the risks associated with their work. It applies to all staff who engage contractors on a contract-for-services basis, across all sites and operations of The Company.\n\nDefinitions: A Contractor is any individual or organisation providing services under a contract for services (this excludes suppliers who only supply goods or materials). A Contract Manager is The Company staff member responsible for ensuring contract obligations are met. A Job Safety Analysis (JSA) — also called a Safe Work Method Statement (SWMS) in construction — describes the steps within a task, the hazards or risks arising from each step, and the controls required. A Subcontractor provides services directly to one of The Company's contractors. Worker has the same meaning as under the Health and Safety at Work Act 2015, covering employees, contractors, subcontractors, labour hire, apprentices/trainees, and volunteers.\n\nPrequalification: Prequalifying contractors confirms they have the skills, experience, resources, and systems to work safely, for themselves, our staff, and anyone else exposed to that work. The Contract Manager is responsible for prequalification where expertise is needed to assess systems or evidence. Once prequalified, contractors are asked every 2 years for updates on any changes to their management systems, resources, or type of work — sooner if a serious safety issue or significant change occurs. Contractors who don't meet The Company's minimum requirements are given feedback on what's needed before they can be engaged.\n\nDocumentation: Effective contractor management depends on consultation, communication, and collaboration between businesses. The Company provides contractors with all health and safety requirements and information as part of prequalification, so appropriate planning can occur. Contracts clearly define expected performance standards, whether the site will be handed over to the contractor, and health and safety roles and responsibilities.\n\nOnboarding: All contractors receive a health and safety induction before starting work, covering at minimum: roles and responsibilities, an overview of the work, hazards and controls for the work/site, emergency procedures, incident and hazard reporting, available facilities, and site requirements. The Contract Manager is responsible for ensuring every contractor is inducted.\n\nPlan Works: The Company consults, cooperates, and coordinates activities with contractors and subcontractors — finding out who is doing what and working together so risks are managed. Beyond being an HSWA requirement, it means work is better planned with fewer incidents, delays, or cancellations. Before works commence, the contractor must provide a safe work method statement (or similar), used throughout the works for monitoring and review; any changes to the original plan must be provided to The Company.\n\nMonitoring: The Contract Manager ensures appropriate monitoring is in place — that work meets an appropriate standard, risks are managed appropriately, and any issues are identified — with the frequency based on the degree of risk involved. Actions and improvements are agreed with the contractor, made SMART (specific, measurable, achievable, relevant, time-bound), documented, and monitored through regular meetings and site inspections.\n\nReview: All contractors are subject to a regular review process arranged by the Contract Manager, at minimum covering: safety performance (with a focus on serious incidents and learnings), what worked well, what didn't work well, and opportunities for improvement. Reviews happen every 2 years or at contract completion (whichever is first), unless triggered sooner by serious safety concerns, and are documented and kept on file.\n\nRelevant Legislation: Health and Safety at Work Act 2015; Health and Safety at Work (Worker Engagement, Participation, and Representation) Regulations 2016.",
      "Hazard & Risk Management Procedure": "The purpose of this procedure is to define how hazards and risks are identified and managed with respect to the health and safety of workers, and the risks associated with their work. It applies to all staff and contractors and covers hazard and risk management throughout The Company.\n\nWhat is a hazard? A hazard is any source of potential damage, harm, or adverse health effects on something or someone under certain conditions. This includes a person's behaviour where that behaviour has the potential to cause death, injury, or illness (whether resulting from physical or mental fatigue, drugs, alcohol, traumatic shock, or another temporary condition affecting behaviour).\n\nWhat is harm? Harm can be physical damage, material damage, or actual or potential ill effects or danger. Harm can be acute, where effects are felt immediately (e.g. cutting a hand on a blade), or chronic, where effects gradually develop or worsen over time (e.g. lung disease from breathing in fine dust over many years).\n\nWhat is a risk? Risks arise from people being exposed to a hazard.\n\nIdentifying and Reporting Risks and Hazards: The Company identifies any potential hazard or risk that may cause harm — this isn't always obvious, so consideration is given to activities (routine and non-routine), emergency situations, people, other issues, and company changes. After identifying hazards and who might be affected, The Company evaluates the severity the risk may present and establishes suitable, effective controls to reduce the risk so far as is reasonably practicable.\n\nRisk Assessment: Hazards are risk-rated using the Risk Matrix. First, decide the likelihood of being harmed in day-to-day work (Rare to Almost Certain). Second, decide the worst-case consequence (Insignificant to Catastrophic). Following both lines to where they meet gives the initial risk score; this is repeated once controls are decided to give the residual risk score. Risk levels range from Very Low (manage by routine procedures) through Low, Moderate, and High, to Critical (stop work immediately). Assessing severity requires considering the duration and frequency of exposure, the number of people affected, the competence of those exposed, the type and condition of equipment, and the availability of first aid or emergency support. Reference: Risk Assessment Form.\n\nManaging Risks and Hazards: The HSWA focuses on the management of work-related risks and hazards, and requires The Company to follow the Plan-Do-Check-Act cycle of continuous improvement.\n\nControlling Risks and Hazards: The Company will try to eliminate a risk where reasonably practicable (e.g. removing a trip hazard or faulty equipment). Where a risk cannot be eliminated, The Company works through the hierarchy of controls, minimising risk so far as is reasonably practicable by first substituting with a lower-risk activity or substance, isolating people from the hazard, or applying engineering control measures. If a risk then remains, administrative control measures are put in place. Finally, if a risk still remains, suitable personal protective equipment (PPE) is used — PPE is only used when other control measures alone cannot adequately manage the risk, and is never the first or only control considered. Refer: Risk Management Process & Hazard & Risk Process Training.\n\nWorker Participation: Worker involvement is a key part of hazard and risk management — workers who do the work are usually best placed to identify risks and hazards and have ideas for controlling them. Workers are also responsible for ensuring their own work doesn't become a risk or hazard to themselves or anyone else.\n\nHealth Risks/Hazards: Where minimisation is used to manage a risk, The Company monitors affected workers' health in relation to their exposure, with their consent — the principles of privacy, human rights, and discrimination apply. If it's unclear whether exposure levels are being exceeded, exposure monitoring is undertaken, engaging a suitable Occupational Health Service (e.g. hearing and lung function testing).\n\nMonitoring: The Company periodically reviews risk assessments and re-assesses controls after any significant change to the workplace or process, after an accident or ill-health incident has occurred, or after near-misses have been reported.",
      "Hazardous Substances Procedure": "This procedure outlines the requirements for the safe storage, handling, use, transportation, and disposal of hazardous substances at the workplace, ensuring compliance with the Hazardous Substances and New Organisms (HSNO) Act 1996, relevant EPA and WorkSafe NZ guidelines, and minimising risk to worker health, property, and the environment. It applies to all workers, contractors, and visitors at all company-controlled sites where hazardous substances are present, covering identification, inventory, storage, segregation, spill response, decanting, transport, and emergency preparedness.\n\nResponsibilities: Management ensures resources for effective hazardous substance management, maintains an accurate inventory, implements controls identified by the Calculator, SDS, or HSNO approval, and ensures staff are trained and competent. Workers follow safe work procedures, use PPE as directed, participate in training, report unsafe conditions or incidents, and don't handle hazardous substances unless trained and authorised. Supervisors conduct regular inspections and audits of storage, review SDS accessibility, and monitor PPE use and emergency readiness.\n\nPotential Hazards and Risks: Workers are made aware of spills, skin reactions, chemical burns, environmental damage, toxic fumes or gases, manual handling injuries from container weight or awkward handling, acute or chronic exposure effects, eye injuries, and explosion or fire from chemical reactions or vapours.\n\nPersonal Protective Equipment: The Company provides all workers with appropriate PPE and ensures training in its correct selection, use, maintenance, and storage, meeting the minimum requirements on the SDS for each substance — gloves, respiratory protection, eye protection, protective clothing, and hearing protection as required, with footwear worn at all times.\n\nHazardous Substance Inventory and Calculator: The Company maintains an up-to-date inventory of all hazardous substances in accordance with the HSNO Act 1996, entering each substance into the Hazardous Substances Calculator with product name, HSNO approval number or CAS number, UN class and packing group, storage type, and maximum quantity. The inventory includes the product/chemical name and UN number, maximum quantity at the workplace, physical state, container size/type, location and storage/segregation requirements, current SDS, and waste disposal requirements.\n\nIncompatible Substances: Not all hazardous substances can be stored together safely — incompatible substances (e.g. flammables like petrol and oxidisers like pool chemicals) must be stored separately to prevent mixing in a leak or spill, referring to the SDS for specific incompatibilities.\n\nStorage: The Company stores only what it needs, to reduce compliance costs and risk, with signage warning of hazards, precautions, and emergency actions where required. Spill kits and, for larger quantities, secondary containment (bunding) are in place. Containers are kept lidded to reduce vapour release and spill risk. Flammable substances are stored in approved cabinets complying with AS1940-2004, with adequate ventilation and ignition sources removed.\n\nDecanting: Hazardous substances are kept in their original containers where possible. Where decanting is required, workers read the SDS, wear recommended PPE, ventilate the area, use only compatible containers, ensure containers are clean, and clearly label the new container with product name and hazard pictogram/statement. Hazardous substances are never stored in food or drink containers.\n\nGas Cylinders: Cylinders (including empty ones) are stored, handled, and used upright unless designed for horizontal use, and tested at gas cylinder test stations to ensure they remain safe. Storage locations are suitable, secure, well ventilated, and — for flammable gases — fire resistant and separated from ignition sources, with fire extinguishers available.\n\nHazardous Areas and Compliance: Hazardous areas (where flammable vapours may be present) require ignition sources to be controlled, with electrical equipment kept safe or at a safe distance. A Location Compliance Certificate may be required for flammable, oxidising, toxic, or corrosive substances — the Calculator determines whether one is needed.This procedure outlines the requirements for the safe storage, handling, use, transportation, and disposal of hazardous substances at the workplace, ensuring compliance with the Hazardous Substances and New Organisms (HSNO) Act 1996, relevant EPA and WorkSafe NZ guidelines, and minimising risk to worker health, property, and the environment. It applies to all workers, contractors, and visitors at all company-controlled sites where hazardous substances are present, covering identification, inventory, storage, segregation, spill response, decanting, transport, and emergency preparedness.\n\nStorage & Inventory: Potential hazards and risks associated with hazardous substances include spills, chemical burns, fumes, exposure and health effects, and explosion or fire, as well as skin reactions, environmental damage, manual handling injuries, and eye injuries.\n\nHazardous Substance Inventory and Calculator: hazardous substances are entered into WorkSafe's online Hazardous Substances Calculator (hazardoussubstances.govt.nz/calculator), generally by product name, though the HSNO approval number or CAS number can also be used. The inventory must include the product or chemical name and UN number of each hazardous substance, the maximum amount likely to be at the workplace, its location, specific storage and segregation requirements, the current SDS (or a condensed version of its key information), and waste and waste disposal requirements. The Calculator lists the key controls that apply, including signage, segregation and area requirements, and the inventory can be printed and updated at any time using the pin provided.\n\nIncompatibles: not all hazardous substances can be stored together safely — different substances can cause a fire or explosion if they come into contact, so incompatible substances are stored separately to prevent mixing in a leak or spill. Flammables (such as petrol, turps, solvent paints and thinners) are kept away from oxidisers (such as hydrogen peroxide or pool chemicals); the SDS for each substance specifies what it must be kept away from.\n\nStore only what's needed, and store it safely: hazardous substances are kept to a minimum to make them easier to manage and reduce compliance needs and costs. Appropriate signage is used depending on the type and amount of substances present. Labelling and packaging are kept clear, up to date and correctly classified; detailed, up-to-date SDS documentation is maintained for each substance; incompatible substances are never stored together; storage requirements from each SDS are implemented and maintained; storage areas are regularly inspected; emergency response plans are established for hazardous substance storage; correct spill kits are provided for the substances being stored; adequate security measures prevent unauthorised access; and accurate records of storage activities, quantities and conditions are maintained.\n\nBe prepared for a spill: measures are in place to control any hazardous substance spill or leak — a spill kit for small spills, and secondary containment (bunding) for larger amounts. Lids are kept on hazardous substance containers at all times to reduce vapour release and the chance of spills.\n\nFlammable substances are stored in smaller amounts in an approved metal cabinet complying with AS1940-2004, with up to 250 L able to be stored in an approved cabinet provided each container is under 20 L; very large amounts require a dangerous goods store or separate building. Adequate ventilation is provided wherever flammable gases or liquids are used or stored, to prevent build-up of flammable vapours, and ignition sources are removed from these areas.\n\nTransportation of hazardous substances requires: identifying and classifying the substances; accurate labelling on approved packaging aligned with HSNO regulations; SDS sheets available for all transported goods; a D endorsement on the driver's licence where substances are classified as dangerous goods; known emergency response plans, with all workers trained where dangerous goods are transported; appropriate spill kits available based on the substance type and amount; and detailed record-keeping of transportation activities.\n\nDecanting or transferring substances: hazardous substances are kept in their original containers wherever possible. Where decanting is necessary, the SDS is read first to note the substance's hazards; recommended PPE (eye protection, breathing protection, gloves, overalls) is worn and properly fitted, with eye wash stations or safety showers available where needed; work areas are ventilated; only containers able to safely store the substance are used, checking the SDS for material incompatibilities; new containers are clean and free of residue; new containers are clearly labelled with the product name and correct hazard pictogram and statement; ignition sources are avoided when transferring flammable liquids; containers are correctly earthed or bonded to prevent static discharge; and a spill kit is kept ready during transfer. Hazardous substances are never stored in food or drink containers.\n\nGas cylinders (including empty ones) are stored and handled carefully, upright unless designed for horizontal use — most general-purpose LPG cylinders are upright-use, vehicle and forklift cylinders are designed for horizontal use, and acetylene cylinders must be used upright (or stood upright for at least an hour before use if transported horizontally) due to their acetone gas solvent. Gas cylinders are tested at gas cylinder test stations to ensure they remain safe to use, since poorly maintained cylinders may leak or cause an explosion. Cylinders are stored in a location suitable for the type and quantity stored, that is secure, well ventilated, and has an emergency response plan and signage in place if required; for flammable gases, the location is also fire resistant and suitably separated from ignition sources, with fire extinguishers available.\n\nHazardous areas — where flammable vapours may be present — require special precautions to prevent ignition; their dimensions depend on the substances present and ventilation in place. Electrical equipment is kept suitable or away from these areas, generally extending 3 m from a dangerous goods cabinet or store and 1 m above, with advice sought from a registered electrical inspector where needed.\n\nA location compliance certificate may be required where flammable, oxidising, toxic or corrosive substances are present — the Calculator is used to determine whether one is needed, and if so a compliance certifier arranges a visit to the workplace. All workers handling hazardous substances complete training, recorded with their name, date trained, and signature confirming they understand the procedure.",
      "Incident Reporting & Investigation Procedure": "This procedure defines how incidents are reported and investigated within The Company, applying to all staff and contractors.\n\nReporting: All incidents or non-conformities must be notified to a supervisor as soon as safely possible, and documented via a formal report within 24 hours — including date, time, location, people involved, and a full description for investigation and corrective actions.\n\nInvestigation: Management determines appropriate corrective actions with worker input, to be recorded, assigned, and closed out. Investigations determine whether procedures need review, and outcomes are communicated to relevant workers and PCBUs. For notifiable or extreme-risk incidents, The Company engages H.A.R.M to conduct a full ICAM investigation, with results discussed with management.\n\nNotifiable Events: The incident scene is preserved until the supervisor has been notified, to determine whether it's a notifiable event. If notifiable, the scene is frozen, the notifiable event process followed, and WorkSafe NZ notified.",
      "Induction & Training Procedure": "Purpose: The Company is committed to ensuring all workers are inducted and trained to perform their duties safely, protecting them from injury and health risks while at work. Induction provides essential information and training to workers, contractors, labour-hire workers, volunteers, and visitors before they undertake any work and/or face any health, safety, or welfare risks.\n\nScope: this procedure outlines the induction and training process for new or transferred workers, contractors, labour hire workers, volunteers, and visitors authorised to work on sites owned or operated by The Company, implemented prior to the commencement of any work.\n\nRoles & Responsibilities: Managers/Supervisors conduct inductions for new or transferred employees, contractors, labour hire workers, volunteers, and visitors, and maintain and update induction records according to this procedure. Workers, contractors, labour hire workers, volunteers, and visitors ensure their actions do not endanger themselves or others, actively participate in the induction process, and comply with The Company's policies and procedures.\n\nProcedure: all workers, contractors, labour hire workers, volunteers, and visitors complete an induction led by the relevant manager/supervisor before beginning work, adapted to consider the specific risks associated with the role and work environment.\n\nOnboarding Process — Day One: employment contract signed and returned; licenses and training certificates collected; bank and next-of-kin details obtained; absence and other employment policies reviewed; site security, entry and exit procedures, and attendance recording explained; and any special medical needs (such as asthma or diabetes) documented and passed to the first aider.\n\nInduction & Orientation Program covers: incident and accident reporting, including notifiable events and the importance of near-miss reporting; health and safety responsibilities, ensuring a clear understanding of personal and company obligations; hazard identification and risk management training, with competency confirmed before sign-off; and general health and safety information including the Health & Safety Manual and Policies, worker participation and leave requirements, the buddy program, PPE issuance and training, emergency procedures, mobile phone use while driving, reporting forms and documentation, and health and safety assistance.\n\nExisting Training: upon employment, each worker's existing qualifications and experience are assessed, matched to the training register, and any additional required training is organised.\n\nCompetence: The Company determines and ensures competency based on education, induction, and training, retaining documentation as evidence. Annual training plans support ongoing development, and workers are competency-assessed before unsupervised equipment use.\n\nSpecial Needs: The Company considers the special needs of new workers, contractors, labour hire workers, volunteers, and visitors — written materials may be translated or presented in simplified language, with further assistance provided if needed.\n\nManagement of Young and Vulnerable Workers: The Company provides additional guidance and supervision through a tailored induction with extra focus on workplace hazards, emergency procedures, and safety policies; a buddy program assigning experienced workers to mentor young or vulnerable workers; ongoing supervision with regular manager check-ins to monitor understanding of safety practices; and clear reporting mechanisms encouraging young and vulnerable workers to report concerns without hesitation.\n\nTransferring Workers: when transferring workers to new tasks or departments, they receive a specific induction covering risks associated with the new role and environment.\n\nRefresher and Planned Training: all training records are logged in the Training & Competency Register. The Company administrator monitors certification expiry dates, arranging refresher training as needed and scheduling additional training based on role requirements.\n\nRecord Maintenance: induction records for workers, contractors, labour hire workers, volunteers, and visitors are maintained for five years.",
      "PPE Procedure": "Purpose: this procedure defines the requirements, responsibilities and practices for the use of Personal Protective Equipment (PPE) whenever it has been identified as a risk control measure.\n\nScope: this procedure applies to all PPE items used in The Company.\n\nHazard Identification and Risk Assessment: The Company completes a risk assessment of all work within the workplace in consultation with workers and records this information in The Company Hazard Register. Hazard identification takes place when new plant, equipment or tasks are introduced into the workplace, for all existing plant and equipment, before any changes are made to the system of work for tasks, before plant or equipment is used in a manner other than what it was designed for, and when new information regarding task safety becomes available.\n\nRisk Management: The Company applies the hierarchy of controls to the management of risks under its control — risk from operational activities must be eliminated or, where that is not reasonably practicable, minimised using the hierarchy of controls. PPE is only used when there are no other practical control measures available (as a last resort), as an interim measure until a more effective control can be used, or to supplement higher-level control measures.\n\nSelection of PPE: PPE must be appropriate to the task and level of risk; used in every situation where the need has been identified through a risk assessment, safe work procedure, or other relevant safety information; selected, used and maintained in accordance with relevant legislation, AS/NZS standards, codes of practice and manufacturer's instructions; and selected and, where necessary, fitted to suit the individual user. Proof of compliance with the relevant AS/NZS standard is a prerequisite for the purchase of any PPE.\n\nUse of PPE: correct fit is essential and must be checked by the user before use — where RPE is issued, a quantitative fit test by a qualified external provider is arranged annually. Workers and visitors are instructed in the correct use of PPE, including the need for it, its basic design principles, application and limitations, with PPE requirements incorporated into inductions.\n\nMaintenance of PPE: all PPE is maintained, tested and stored according to manufacturer's requirements, kept in a clean, hygienic and effective condition, with damaged PPE repaired or replaced.\n\nIssuing of PPE: PPE is made available to all workers, volunteers and visitors when required — independent contractors and sub-contractors are required to provide their own PPE.\n\nReview and Evaluation: users inspect PPE for signs of deterioration, missing or damaged parts, and expiry date. PPE must not be used in a sub-standard condition; faulty, damaged or excessively worn PPE is withdrawn from use immediately and replaced; and the adequacy of PPE is assessed regularly to ensure personal injuries are not occurring.\n\nResponsibilities: the PCBU (The Company) ensures this procedure is implemented into its activities and provides sufficient resources for all PPE. Managers & Supervisors implement this procedure in their area of responsibility, including appropriate PPE selection compliant with the relevant AS/NZS, ensuring PPE is used properly through information, training, instruction and supervision, ensuring reusable PPE is kept clean, maintained and stored appropriately, scheduling and carrying out inspections and maintenance, ensuring worn, expired or faulty PPE is replaced, and leading by example. Workers avoid placing themselves or others at risk, wear protective clothing as required, use PPE that is provided (or in the case of contractors, provide and use their own), participate in PPE selection and required training, and raise concerns without fear of reprisal. Visitors and others avoid placing themselves or others at risk, wear protective clothing as required, and use and look after PPE provided.\n\nReplacement, Monitoring and Issuing of PPE: PPE requirements are reviewed annually, or sooner if an incident investigation identifies additional PPE is required, or if there is a change to work tasks or processes. All required PPE is issued to workers upon induction and recorded in the PPE register. Workers needing replacement PPE before expiry use the Request PPE form in the HARM App, with The Company Administrator arranging purchase and issue. Workers are asked weekly at toolbox meetings whether they require additional PPE, recorded on the templates or HARM App for action.\n\nHard Hats: worn by workers whenever an overhead risk exists. This is mandatory PPE for workers on site when operating plant or working around machinery.\n\nEye & Face Protection: safety glasses are available to all workers and worn when there is potential for eye injury. This is required PPE whenever workers are around objects that can cause eye or face damage, such as machinery or grinders.\n\nHearing Protection: ear muffs or plugs are available and worn where there is potential for noise-induced hearing loss. This is required PPE for any task with noise above 85 decibels.\n\nRespiratory Protection: masks or respirators are available and worn where there is potential exposure to respiratory damage. Disposable masks are available for tasks that may generate high levels of dust, or where dust is present on adjacent sites.\n\nHi-Vis Vest: worn by workers whenever working around plant and machinery or where traffic risks exist. This is mandatory PPE for all workers at all times on site.\n\nGloves: worn by workers whenever there is a risk of hand injury. This is required PPE for any task with a risk of hand injury.\n\nSafety Footwear: worn by workers whenever there is a potential foot injury. This is mandatory PPE for all workers at all times on site.",
    };

    const realSectionContent = {
      "1. Introduction": "This manual provides The Company's workers, contractors, and visitors with a clear framework for how health and safety is managed across the business, and forms the foundation of The Company's Health and Safety Management System (OHSMS).",
      "2. Purpose": "The purpose of this manual is to provide a framework to meet The Company's responsibilities under the Health and Safety at Work Act 2015 (HSWA) and all associated regulations, guidelines, codes of practice and standards in New Zealand. This framework provides a management system to manage health and safety risks, opportunities, and performance.",
      "3. Scope": "The Company has adapted this Health and Safety Management System (OHSMS) with the assistance of H.A.R.M Limited to provide all workers with clear and defined processes and procedures. H.A.R.M Limited provides The Company with ongoing support and advice, as well as additional forms and templates to work alongside this system.",
      "4. Health & Safety Policy": "The Company has outlined all levels of authority and responsibility within the health and safety policy to ensure all workers are enabled and supported to fulfil their individual health and safety responsibilities.",
      "5. Leadership, Commitment, and Worker Participation": "The Officers of The Company and any person in a position of influence demonstrate their commitment to this OHSMS by following the Health and Safety Policy, which states the support, culture, leadership, responsibilities, and accountabilities within The Company. The Company takes overall responsibility to provide a safe, healthy workplace, free from risk so far as is reasonably practicable. Management ensures all policies, procedures, and objectives are in place and compatible with The Company's direction, work practices, goals, and targets. Workers at each level are responsible for the aspects of this OHSMS over which they have control, as outlined in the Health and Safety Policy.",
      "5.1 Organisational Roles, Responsibilities, Accountabilities & Authorities": "The Company's level of authority by position is outlined in its organisational structure. Position responsibilities are set out in The Company's Health and Safety Policy as commitments.",
      "5.2 Participation and Consultation": "The Company provides time, training, and resources to enable participation by workers at all levels, and communicates OHSMS information clearly and understandably. Barriers to participation — including language barriers, fear of retaliation, or discouraging practices — are minimised. Workers are actively involved in regular meetings covering risk management, competency and training, incident investigation, objectives and planning, contractor management, audit programs, continual improvement, and relevant hazards and risks. All meetings are documented in minutes and kept on record.",
      "5.3 Health & Safety Issue Resolution": "Health and safety issues may arise when a worker's concerns remain unresolved following discussion with the worker and the PCBU, often stemming from differing opinions on risk or the acceptability of controls. In this event, The Company follows the Health & Safety Issue Resolution Procedure to ensure a resolution is found.",
      "5.4 Health & Safety Representatives": "The Company ensures a Health & Safety Representative (HSR) is selected when a worker or group of workers requests one. The HSR is made known to all workers including contractors, given appropriate training to fulfil their duties, and given the opportunity to actively participate in regular health and safety meetings.",
      "6. Planning": "This OHSMS prevents or reduces risk within The Company and ensures continual improvement through planning and worker participation. The Company considers the hazards and risks associated with its work on an ongoing basis, ensures legal requirements are met, and gives ample opportunity to identify and manage any temporary or significant changes.",
      "6.1 Objectives": "To achieve continuous improvement in health and safety, The Company plans objectives individually or collectively, documenting and assigning responsibility at management level, with consideration given to diversity aspects such as cultural or language barriers.",
      "7. Hazard Identification and Assessment of OHS Risks": "The Company, with worker input, actively establishes, implements, and maintains a proactive process for identifying hazards.",
      "7.1 Legal and Other Requirements": "The Company considers legal requirements to ensure compliance, utilising the WorkSafe NZ website for guidance and information relating to OHS.",
      "8. Risk Management": "The Company's approach to managing risk once hazards have been identified, working through appropriate controls to reduce risk so far as is reasonably practicable.",
      "8.1 Hierarchy of Controls": "The Company will try to eliminate a risk where reasonably practicable. Where a risk cannot be eliminated, The Company works through the hierarchy of controls: substituting with a lower-risk activity or substance, isolating people from the hazard, or applying engineering controls. If a risk remains, administrative controls are put in place. Finally, if a risk still remains, suitable personal protective equipment (PPE) is used — PPE is never the first or only control considered.",
      "9. Incidents and Corrective Actions": "In the event of an incident or non-conformity, all workers must notify The Company of the occurrence, and an investigation is completed to identify the root cause and evaluate current risk management. Incidents must be notified to a supervisor as soon as safe to do so, and documented via a formal report within 24 hours. Corrective actions are determined by management with worker input, recorded, assigned, and closed out. All incidents are preserved until notification has occurred, to determine whether the incident is a notifiable event — if so, the scene is frozen, the notifiable event process followed, and WorkSafe NZ notified.",
      "9.1 Incident Reporting": "The Company ensures all incidents relating to health and safety are promptly reported and documented, including date, time, location, individuals involved, and a thorough description of the event, for investigation and corrective actions to be assigned.",
      "10. Plant & Equipment": "The Company ensures all plant and equipment is fit for purpose, meets standard, and is in good working order with all safety mechanisms and guards fitted. Equipment is used only by trained, licensed (if applicable), and competent workers. New plant and equipment is assessed on introduction and added to an equipment and maintenance register, with regular checks undertaken. Unsafe plant or equipment is removed from operation until repaired by a competent person.",
      "11. Contractors": "The Company follows a Contractor Pre-Qualification Process to ensure engaged contractors and sub-contractors have adequate processes and controls in place, identifying health and safety performance and systems, insurance, training and competencies, operating and emergency procedures, incident management reporting, and plant and equipment. Contractors are periodically monitored through SSSP and Contractor Evaluations, with pre-qualification completed bi-annually.",
      "12. Emergency Preparedness and Response": "The Company maintains a documented emergency response plan, including rescue plans for high-risk work where applicable, made available to all workers and visitors. The plan is tested at least every 6 months, with an evaluation completed after any emergency or test to review and make necessary changes. Adequate first aid supplies are available at all times, with an appropriate number of workers trained in first aid.",
      "13. Personal Protective Equipment (PPE)": "The Company ensures workers are supplied with fit-for-purpose PPE, purchased by The Company, fitted to each worker, and replaced when no longer in good condition. Workers must notify their supervisor of any damage or defect and not use PPE until it's replaced. Training on correct use and storage is provided, with issue and replacement dates recorded on each worker's individual PPE register.",
      "14. Exposure and Health Monitoring": "The Company's risk management process determines whether workers are likely to be exposed to a health hazard or hazardous substance. Where a risk is present, exposure assessment and health monitoring are undertaken at The Company's cost, with results provided to workers and records kept in accordance with the Privacy Act. Health monitoring is only undertaken by an experienced occupational health practitioner.",
      "15. Hazardous Substances": "The Company identifies any substances classed as hazardous by substance classification codes. These are controlled with adequate resources, training, handling, storage, and equipment. All hazardous substances have Safety Data Sheets (SDS) available, and incompatible substances are segregated when stored.",
      "16. Training": "The Company ensures all workers are appropriately inducted and trained before undertaking work, with ongoing competence maintained throughout their employment.",
      "16.1 Induction": "The Company ensures all workers are inducted prior to commencing work, covering: The Company's induction, incident and accident reporting, health and safety responsibilities, the health and safety manual, policies and procedures, hazard ID and risk management processes, a buddy program, PPE issue and training, and emergency procedures. Competency is assessed, and workers must be deemed competent to identify and control a hazard or risk before being signed off.",
      "16.2 Competence": "The Company determines and takes action to ensure workers are competent based on education, induction, training, and experience, retaining documentation as evidence and reviewing competencies on an ongoing basis, including annual training plans.",
      "17. Reporting": "The Company reports within the app or on the templates provided. All workers are given training in reporting requirements during induction, with adequate time provided to complete this.",
      "18. Monitoring & Review": "The Company monitors and reviews its OHSMS on an ongoing basis to ensure it remains effective and continues to improve.",
      "18.1 Monitoring, Measurement, KPIs, Analysis and Evaluation": "On an annual basis, The Company reviews and evaluates current OHSMS processes and procedures, making applicable changes using the Annual Health & Safety Review form. KPIs are measured from the Annual Objectives Form, with objectives set annually to ensure continuous improvement.",
      "18.2 Corrective Actions": "The Company ensures all corrective actions are assigned and managed through to close-out, with open actions reviewed regularly and progress tracked.",
      "18.3 Document, SOP and H.A.R.M Register Review": "The Company is provided updated or additional templates upon annual review, considering legislative changes, industry learnings, incidents, or additional WorkSafe NZ guidance. SOP documentation is reviewed annually or when a new process, business change, or plant/equipment change arises. The Hazard/Risk Register is updated from toolbox talks, meetings, or learnings from incidents and reviews.",
      "18.4 Assessment of OHS Risks to the OHS Management System": "Annually, The Company assesses OHS risks and risks to the OHSMS itself, considering outdated information, system requirements, insufficient resources, review programmes, management responsibilities, failure to achieve expectations, planning, and OHS performance.",
      "18.5 Identification of OHS Opportunities and Other Opportunities": "The Company provides opportunities to improve OHS by eliminating hazards early, discussing OHS during planned changes, improving monotonous work, utilising new technologies, and encouraging worker participation — and improves the OHSMS itself by enhancing visibility, the incident investigation process, worker participation, benchmarks, and industry collaboration.",
      "18.6 Management of Change": "The Company completes a risk assessment to ensure changes to the business don't compromise health and safety performance, identifying potential OHS opportunities. Examples of change include organisation structure, technology, new equipment, new information, products, processes, services, and legal requirements.",
      "18.7 Management Review": "Management holds regular meetings to review actions from previous meetings, legislative or organisational changes, incidents and corrective actions, objectives, non-compliances, worker participation, audit or review findings, communication with other companies, and resource adequacy. Outcomes are communicated to workers and worker representatives as necessary.",
      "19. Support": "The Company ensures the resources and external advice needed to maintain and continually improve the OHSMS are available.",
      "19.1 Resources": "The Company determines and provides the resources needed to establish, implement, and maintain continual improvement of the OHSMS.",
      "19.2 External Advice": "The Company may seek external advice when information or knowledge is limited, ensuring advice is sourced from a competent provider with evidence to support this on request.",
      "20. Document Control": "This OHSMS has been developed for The Company by H.A.R.M Limited and is reviewed annually to ensure the document and related templates remain accurate. Any changes required before the annual review are discussed with H.A.R.M Limited. All documentation is retained for a minimum of five years, with health monitoring records kept for 30 years (or 40 years if asbestos-related) after the record is made.",
    };

    const realPolicyContent = {
      "Health & Safety Policy": "The Company is committed to ensuring, so far as is reasonably practicable, that its obligations under the Health and Safety at Work Act 2015, applicable Regulations, Approved Codes of Practice, Guidelines, and other relevant standards are met — and to the health, safety and wellness of workers and anyone else affected by The Company's operations. The Company is dedicated to a work environment where health, safety and wellness is of equal importance to all other business operations, and commits to:\n\nEnsuring legislative requirements are met; gaining and maintaining knowledge of work health and safety matters; understanding the business, its operations, and associated hazards and risks; ensuring resources are used to eliminate or minimise risk; having processes for receiving, communicating and considering information on incidents, hazards, and risks; responding in a timely manner to health and safety information; implementing processes and complying with duties; providing a safe and healthy work environment; preventing work-related injury, ill health, and adverse effects to mental wellbeing; providing PPE and training on its use; meeting and exceeding legislative obligations; providing information, supervision, training and instruction; continually improving the Health and Safety Management System; managing contractors so they don't pose a risk to workers or themselves; monitoring exposure to hazardous substances; identifying hazards, controlling risks, and reviewing controls; providing workplace facilities and first aid; maintaining an emergency plan; providing safe plant, structures and systems of work; and supporting early return to work.\n\nWorkers are expected to take reasonable care for their own health and safety and that of others, comply with reasonable instructions and cooperate with policies and procedures, wear PPE provided, report incidents, hazards or risks, and participate in health and safety within The Company.\n\nManagement leads health and safety by example, promotes a positive health and safety culture, enables and encourages worker communication and participation, ensures processes are communicated and followed, ensures workers are competent for their work, and ensures policies, procedures and objectives remain compatible with The Company's direction, work practices, goals and targets.",
      "Wellbeing Policy": "Purpose: The purpose of this policy is to affirm The Company's commitment to providing a safe, positive, and mentally healthy workplace. This policy outlines our expectations, responsibilities, and principles for supporting mental wellbeing.\n\nScope: This policy applies to all employees, contractors, and any other persons who enter or work within The Company's workplaces.\n\nPolicy Statement: The Company recognises that mental wellbeing is a fundamental component of workplace health and safety. We acknowledge that anyone can experience mental distress or challenges at any stage of their lives. We are committed to building a work culture that promotes wellbeing, prevents harm, and provides appropriate support when needed.\n\nPrinciples: The Company's approach to mental wellbeing is based on the following principles — Respect and Dignity: all workers will be treated fairly, respectfully, and without discrimination. Openness and Support: we encourage open conversations about mental wellbeing, free from stigma. Confidentiality: personal health information will be respected and shared only with consent, or when necessary for safety. Early Support: workers will be encouraged to access support early, through internal processes or external providers such as Mates in Construction, 1737, Lifeline or a GP. Shared Responsibility: both the employer and employees contribute to creating and sustaining a mentally healthy workplace. Continuous Improvement: The Company will review and support wellbeing initiatives, such as Mental Health Awareness Week, and integrate learnings into our workplace practices.\n\nEmployer Commitments: The Company will provide a work environment that supports positive mental wellbeing; ensure managers and supervisors have the knowledge to identify and respond appropriately to mental health concerns; not tolerate bullying, harassment, or discrimination in any form; promote access to wellbeing resources and support services, including Mates in Construction; consider flexible work arrangements where reasonably practicable and appropriate; and integrate mental wellbeing considerations into health and safety planning, leadership, and decision-making.\n\nEmployee Responsibilities: Employees are expected to treat colleagues with respect and civility; contribute to a supportive, inclusive, and safe workplace culture; speak up if they experience or observe behaviour that undermines wellbeing; take reasonable steps to manage their own wellbeing at work and seek support when required; and support workmates to access help when they are struggling.",
      "Driver Statement Policy": "The Company promotes a safe driving culture by encouraging sensible and safe use of vehicles. This policy aims to outline clear responsibilities of all workers, to achieve a safer working environment.\n\nIt is the driver's responsibility to: always leave the vehicle clean and tidy; always wear their seatbelt; complete a vehicle checklist prior to using the vehicle each day; ensure the fuel gauge is above half at the end of shift, fuelling up on the way back to the yard if under half; ensure work procedures are followed while loading and unloading trucks; report any damage caused to a company vehicle immediately to their manager, followed by an incident report completed prior to the end of shift; never use a cellular phone while driving unless using a handsfree device; never exceed the legal speed limit; never admit responsibility or fault in the event of an accident — always speak to a manager first; never drive while under the influence of drugs or alcohol, including prescription drugs that may impair judgement or cause drowsiness; never smoke or use a vaping device while in any company vehicle; never drive a vehicle they are not legally qualified to drive; notify their manager of speeding tickets, crashes and breaches of traffic regulations; notify management within half an hour of any damage or incident occurring; and complete a full incident report for plant damage or incidents by the end of the shift.\n\nThe Company will: keep training and maintenance records on file; ensure regular breaks are scheduled and log-book requirements are followed; maintain all company vehicles in a safe, clean and roadworthy condition to ensure the maximum safety of drivers, occupants and other road users; and ensure WOFs and COFs are current.",
      "Environmental Policy": "The Company is committed to achieving the principles of environmental sustainability. We recognise our moral and legal responsibility to ensure our operations do not place the local community or environment at risk of harm.\n\nThe Company achieves this by: complying with, and exceeding where practicable, all applicable legislation, regulations and codes of practice; integrating sustainability considerations into all business decisions; minimising toxic emissions through the selection and use of our fleet; promoting environmental awareness among our workers and encouraging them to work in an environmentally responsible manner; reducing waste through innovative work practices and recycling; minimising waste by evaluating operations and ensuring they are as efficient as possible; and reviewing and continually improving our environmental sustainability performance.\n\nTo ensure the success of this policy, senior management will: ensure the environmental policy is implemented; comply with all relevant environmental legislation and adhere to regulatory standards; establish measurable objectives and targets aimed at eliminating waste, pollution and environmental harm; act in a socially responsible manner in regard to the management of our people, communities and resources; encourage consultation and co-operation between management, workers and stakeholders on matters affecting the environment; and provide adequate resources to meet these environmental commitments.\n\nAll workers are required to: follow all environmental policies and procedures; recognise and report hazards which may affect the environment; and act in a socially responsible manner at all times while encouraging an environmentally friendly workplace.",
      "Fatigue & Stress Management Policy": "The Company recognises that workers who are impaired by stress and fatigue are a risk to themselves and those around them. This policy aims to improve overall safety and wellbeing, to achieve a safe working environment.\n\nThe Company achieves this by: shifts not exceeding 14 hours including travel (home to home); workers not exceeding an average of 60 working hours per week; no work period exceeding 4.5 hours without a rest break; ensuring rest breaks are in accordance with the Employment Relations Amendment Act 2018; ensuring rest breaks are set and agreed prior to works commencing; considering an additional 10-minute break between work periods when extreme conditions present; investigating incidents where fatigue may have been involved; providing adequate facilities and drinking water; and limiting periods of excessive mental or physical demands by managing workloads.\n\nAll workers are required to: turn up in a state fit for work, having done everything possible to get a good sleep and rest; inform their manager or supervisor if a task is beyond their capabilities; recognise the signs and symptoms of fatigue — including feeling constantly tired, having little energy, feeling sluggish, excessive yawning or falling asleep at work, reduced vigilance, bad moods, forgetfulness, inability to concentrate, poor communication, poor decision-making, reduced hand-eye coordination and slower reaction times, as well as less obvious symptoms such as drowsiness, headaches, dizziness, blurred vision or impaired visual perception and a need for extended sleep on days off; communicate with their manager or supervisor if they start showing signs and symptoms of fatigue, and make managers and supervisors aware of other workers who may be fatigued; and report fatigue-related incidents.\n\nNon-compliance with this policy may result in disciplinary action. This policy applies to all workers, including contractors and subcontractors under The Company's operational control. The Company's Officer(s) are accountable for ensuring this policy is implemented. The policy shall be reviewed annually and updated as required.",
    };
    (async () => {
      try {
        // Sections and Policies: only fill in if genuinely empty, so any edits already made
        // are never touched.
        const conditionalContent = [
          ...Object.entries(realSectionContent).map(([label, content]) => ["sections", label, content]),
          ...Object.entries(realPolicyContent).map(([label, content]) => ["policies", label, content]),
        ];
        await Promise.all(
          conditionalContent.map(async ([catKey, label, content]) => {
            const key = templateKey(catKey, label);
            const existing = await getDoc(doc(db, "documentTemplates", key));
            if (!existing.exists() || !existing.data()?.content) {
              await setDoc(doc(db, "documentTemplates", key), { content });
            }
          })
        );
        // Procedures: force-overwrite this one time — the first version of this seed was
        // badly truncated (a lot of real content got condensed away), so the conditional
        // "only if empty" write above would never have corrected it once it was already
        // sitting in Firestore. This replaces it outright with the complete version.
        await Promise.all(
          Object.entries(realProcedureContent).map(([label, content]) => {
            const key = templateKey("procedures", label);
            return setDoc(doc(db, "documentTemplates", key), { content });
          })
        );
      } catch (err) {
        console.error("Content seed failed (likely a Firestore permissions issue):", err);
      }
    })();
  }, []);

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
          {module === "systems" && <SystemsView clients={clients} selectedId={selectedClient} setSelectedId={setSelectedClient} documentTemplates={documentTemplates} saveDocumentTemplate={saveDocumentTemplate} systemReviewLog={systemReviewLog} addSystemReviewLogEntry={addSystemReviewLogEntry} />}
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
