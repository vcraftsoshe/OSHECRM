import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Users, TrendingUp, Bell, Building2, CreditCard, StickyNote,
  ChevronRight, ChevronLeft, Plus, Check, Upload, Calendar, X, Search, Clock, PieChart,
  ClipboardList, Layers, Circle, CheckCircle2, Image as ImageIcon,
  Repeat, Trash2, ListChecks, ListTodo, Mail, ArrowUpRight, Store, LayoutDashboard, ChevronDown, Smartphone, FileText, CalendarClock, MessageCircle, Archive
} from "lucide-react";
import { collection, doc, onSnapshot, updateDoc, setDoc, getDocs, getDoc, deleteDoc, arrayUnion } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { ref as storageRef, getDownloadURL, uploadBytes } from "firebase/storage";
import { db, auth, storage } from "./firebase";
import { SECTION_ITEMS, ALWAYS_PROCEDURES, CONDITIONAL_PROCEDURES, COMPLIANCE_EXTRA_PROCEDURES, ALWAYS_POLICIES, CONDITIONAL_POLICIES, ERP_ITEMS, ERP_CONTACT_ITEMS, ERP_ALWAYS_TICKED_EMERGENCIES } from "./ohsmsLogic";

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

const stageOrder = ["New Lead", "Contacted", "Follow Up", "Proposal Sent", "Nurture", "Won", "Lost"];
const stageMeta = {
  "New Lead": { color: T.slateLight, bg: "#EEF2F2" },
  "Contacted": { color: T.blue, bg: "#EAF1F4" },
  "Follow Up": { color: "#C99A3D", bg: "#FBF1DE" },
  "Proposal Sent": { color: T.amber, bg: "#FBF1E3" },
  "Nurture": { color: "#8B6BA8", bg: "#F2ECF7" },
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

// Regions for the ERP's "Emergency Contact Numbers" page. National numbers (Police/Fire/
// Ambulance, WorkSafe, Poison Centre) stay the same everywhere, but regional council
// pollution hotlines, hospital numbers and lines like Civil Defence vary by region, so the
// numbers page is set per-client by region rather than being one shared national list.
const NZ_REGIONS = [
  "Northland", "Auckland", "Waikato", "Bay of Plenty", "Gisborne", "Hawke's Bay",
  "Taranaki", "Manawatu-Whanganui", "Wellington", "Tasman-Nelson", "Marlborough",
  "West Coast", "Canterbury", "Otago", "Southland",
];

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

// Real pipeline data from the 2026-07-26 OSHE Sales Leads export (ClickUp), added directly
// rather than through any upload UI. Deterministic ids ("lead-import-N") so the seeding
// effect further down can add any missing ones without ever duplicating on a repeat load —
// separate from initialLeads above, which is just placeholder demo data for a brand new,
// never-used install.
const importedLeads = [
  {
    "id": "lead-import-1",
    "company": "MJ Excavators",
    "contact": "",
    "value": "",
    "stage": "Won",
    "formEmail": null,
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000000000,
        "type": "Note",
        "text": "System is issued",
        "date": "2026-07-27"
      },
      {
        "id": 1780000000002,
        "type": "Note",
        "text": "Lead source: Referral",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-2",
    "company": "P3 Earthworks Limited",
    "contact": "Nicole",
    "value": "",
    "stage": "Won",
    "formEmail": "nicole@p3earthworks.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000001000,
        "type": "Note",
        "text": "Emails back & froth with vanessa",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-3",
    "company": "The Hunters Club",
    "contact": "Amber Shaw",
    "value": "",
    "stage": "Won",
    "formEmail": "amber@parachute.nz",
    "formStatus": "none",
    "notes": []
  },
  {
    "id": "lead-import-4",
    "company": "Buildwells Builders",
    "contact": "Nick",
    "value": "",
    "stage": "Won",
    "formEmail": null,
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000003000,
        "type": "Note",
        "text": "OSHE Details.msg",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-5",
    "company": "Effective Electrical",
    "contact": "Connor",
    "value": "",
    "stage": "Won",
    "formEmail": "connor@effectiveelectrical.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000004000,
        "type": "Note",
        "text": "connor filling in the form today 29..6.26 - Responded to the email",
        "date": "2026-07-27"
      },
      {
        "id": 1780000004002,
        "type": "Note",
        "text": "Lead source: Referral",
        "date": "2026-07-27"
      },
      {
        "id": 1780000004003,
        "type": "Reminder",
        "text": "Follow up with Connor",
        "date": "2026-07-27",
        "dueDate": "2026-06-09",
        "assignee": "Jo"
      }
    ]
  },
  {
    "id": "lead-import-6",
    "company": "SurfPrep",
    "contact": "Ben Blair",
    "value": "",
    "stage": "Nurture",
    "formEmail": "ben.blair@surfprep.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000005000,
        "type": "Note",
        "text": "on hold - follow up in October",
        "date": "2026-07-27"
      },
      {
        "id": 1780000005002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-7",
    "company": "Constructors",
    "contact": "Etienne Buitendach",
    "value": "",
    "stage": "Nurture",
    "formEmail": "Etienne.Buitendach@constructors.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000006000,
        "type": "Note",
        "text": "have they booked in  @Vanessa Crafts ?",
        "date": "2026-07-27"
      },
      {
        "id": 1780000006002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-8",
    "company": "Metro",
    "contact": "Nick Hardy-Jones",
    "value": "",
    "stage": "Nurture",
    "formEmail": "Nick.Hardy-Jones@metroglass.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000007000,
        "type": "Note",
        "text": "can you call him to reschedule our meeting to discussed proposal we were supposed to catch up a few times now but keeps being missed by both of us  @Cearah Mulder   Metro Proposal.pdf",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-9",
    "company": "Iconiq Construction Group",
    "contact": "Brooke Chambers",
    "value": "",
    "stage": "Nurture",
    "formEmail": "admin@iconiqgroup.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000008000,
        "type": "Note",
        "text": "Hi Vanessa,     Thanks for getting in touch.   We\u2019d be interested in exploring the software once our project workload increases. It has been a slower start to the year for us, so we will reconnect with you when the timing is better on our end.     Appreciate you reaching out.     Regards,",
        "date": "2026-07-27"
      },
      {
        "id": 1780000008002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-10",
    "company": "Signature",
    "contact": "Ivone Sass",
    "value": "",
    "stage": "Nurture",
    "formEmail": "ivone@signature.net.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000009000,
        "type": "Note",
        "text": "Hi Vanessa,   Thanks for reaching out\ud83d\ude0a.     The timing is not great currently; however, I do have your email address and will reach out when I am ready.       Kindest regards   Ivone Sass   Director   022 0710036",
        "date": "2026-07-27"
      },
      {
        "id": 1780000009002,
        "type": "Note",
        "text": "Lead source: Cold Outreach",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-11",
    "company": "Altus",
    "contact": "Rangi Solomon",
    "value": "",
    "stage": "Nurture",
    "formEmail": "rangi.solomon@altus.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000010000,
        "type": "Note",
        "text": "Have you had time to draft a response for me for his email reply? @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000010002,
        "type": "Note",
        "text": "Lead source: Cold Outreach",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-12",
    "company": "Pollock & Crane",
    "contact": "TBC",
    "value": "",
    "stage": "Nurture",
    "formEmail": "TBC",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000011000,
        "type": "Note",
        "text": "have reached out to   Thomas Slater   e.  thomas@pollockcranes.co.nz   m. +64 21 843 088     waiting to hear back",
        "date": "2026-07-27"
      },
      {
        "id": 1780000011002,
        "type": "Note",
        "text": "Lead source: Referral",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-13",
    "company": "ContainerCo",
    "contact": "Phil Rutland",
    "value": "",
    "stage": "Nurture",
    "formEmail": "Phil.Rutland@containerco.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000012000,
        "type": "Note",
        "text": "Phil called but he no longer works there,   Need a different contact",
        "date": "2026-07-27"
      },
      {
        "id": 1780000012002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-14",
    "company": "Beejays",
    "contact": "Katrina Robertson",
    "value": "$9000",
    "stage": "Nurture",
    "formEmail": "katrina@beejays.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000013000,
        "type": "Note",
        "text": "Rung Katrina  - she is going on maternity leave in 3 months time - (September) for 12 months - a new lady is starting so we need to ring her in October - they do want to change as they have 4 systems they use atm - Enable for HR, Safety Culture for daily pre starts & 2 she forgot - she wants to have one system & keep her HR one separate. @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000013002,
        "type": "Note",
        "text": "Lead source: Tradeshow",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-15",
    "company": "NZ Windows",
    "contact": "Chloe Morgan",
    "value": "",
    "stage": "Nurture",
    "formEmail": "chloem@nzwindows.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000014000,
        "type": "Note",
        "text": "updated Vanessa, i have put a date on it & tagged us both in, i also have this in my outlook to follow up then. @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000014002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-16",
    "company": "Christchurch Attractions",
    "contact": "Marty Byrne",
    "value": "",
    "stage": "Nurture",
    "formEmail": "Marty@christchurchattractions.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000015000,
        "type": "Note",
        "text": "Last coms - With the recent resignation of our Tram Ops Manager we are about to recruit for a replacement so I really need them on board before we have a good look at where we are in the H & S space.   At this stage I expect that to be some time in late June.",
        "date": "2026-07-27"
      },
      {
        "id": 1780000015002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-17",
    "company": "Port of Tauranga",
    "contact": "Karl Trask",
    "value": "",
    "stage": "Nurture",
    "formEmail": "Karl.Trask@port-tauranga.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000016000,
        "type": "Note",
        "text": "phoned Karl - he put me onto Karen (carin) 027 252 9094 as she is the decision maker if they change - she advised that they are not looking for a new software for POT - but speak with Pat as he may beg to differ - phone Pat Kirk, he was in a meeting and asked if i could call him back Monday afternoon. @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000016002,
        "type": "Note",
        "text": "Lead source: Cold Outreach",
        "date": "2026-07-27"
      },
      {
        "id": 1780000016003,
        "type": "Reminder",
        "text": "Follow up with Karl Trask",
        "date": "2026-07-27",
        "dueDate": "2026-06-15",
        "assignee": "Vanessa"
      }
    ]
  },
  {
    "id": "lead-import-18",
    "company": "Livingstone",
    "contact": "",
    "value": "",
    "stage": "Nurture",
    "formEmail": null,
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000017000,
        "type": "Note",
        "text": "Kim Wihare is the GM - People, Culture & Safety - 029-264-1056   image.png   phoned Kim left a message to call me bacl - I will follow this up if she hasn't phoned me by Monday arvo. @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000017002,
        "type": "Note",
        "text": "Lead source: Cold Outreach",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-19",
    "company": "Universal Cranes",
    "contact": "Shane",
    "value": "",
    "stage": "Nurture",
    "formEmail": "shane.fraser@universalcranes.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000018002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-20",
    "company": "Stabicraft",
    "contact": "",
    "value": "",
    "stage": "Nurture",
    "formEmail": null,
    "formStatus": "none",
    "notes": []
  },
  {
    "id": "lead-import-21",
    "company": "The Civil Collective",
    "contact": "Tracy Davis (its a Dude)",
    "value": "",
    "stage": "Nurture",
    "formEmail": "tracy@thecivilcollective.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000020000,
        "type": "Note",
        "text": "Called Tracey he said still having cashflow problems so call back in 2 months @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000020003,
        "type": "Reminder",
        "text": "Follow up with Tracy Davis (its a Dude)",
        "date": "2026-07-27",
        "dueDate": "2026-08-10",
        "assignee": "Vanessa"
      }
    ]
  },
  {
    "id": "lead-import-22",
    "company": "Rapid Slabs",
    "contact": "Trang Jones",
    "value": "",
    "stage": "Nurture",
    "formEmail": "contactus@rapidslabs.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000021000,
        "type": "Note",
        "text": "spoke with Trang she said they are not ready to move yet - but i will touch base with her in about 5 months time to see how they are going  @Vanessa Crafts @Judith Page",
        "date": "2026-07-27"
      },
      {
        "id": 1780000021002,
        "type": "Note",
        "text": "Lead source: Social Media",
        "date": "2026-07-27"
      },
      {
        "id": 1780000021003,
        "type": "Reminder",
        "text": "Follow up with Trang Jones",
        "date": "2026-07-27",
        "dueDate": "2026-06-18",
        "assignee": "Jo"
      }
    ]
  },
  {
    "id": "lead-import-23",
    "company": "Halter",
    "contact": "Kirby",
    "value": "",
    "stage": "Nurture",
    "formEmail": "kirby.wotherspoon@halter.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000022000,
        "type": "Note",
        "text": "Vanessa had contact to do external reviews but did not pitch the software - email will be sent from vanessa to chat to Kirby about this",
        "date": "2026-07-27"
      },
      {
        "id": 1780000022003,
        "type": "Reminder",
        "text": "Follow up with Kirby",
        "date": "2026-07-27",
        "dueDate": "2026-05-25",
        "assignee": "Vanessa"
      }
    ]
  },
  {
    "id": "lead-import-24",
    "company": "Aqua Vent Mechanics",
    "contact": "027 496 9313",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "steven@aquavent.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000023000,
        "type": "Note",
        "text": "have phoned left a text message for Steven to call me",
        "date": "2026-07-27"
      },
      {
        "id": 1780000023002,
        "type": "Note",
        "text": "Lead source: Social Media",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-25",
    "company": "Northwest Electrical",
    "contact": "",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": null,
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000024000,
        "type": "Note",
        "text": "12/7 demo had with owner another had with Bronywn 16/7 - follow up next week  @jo",
        "date": "2026-07-27"
      },
      {
        "id": 1780000024002,
        "type": "Note",
        "text": "Lead source: Linkdn",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-26",
    "company": "Shawn Williamson Building",
    "contact": "Rebecca",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "safety@shawnwilliamson.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000025000,
        "type": "Note",
        "text": "tired to ring rebecca she is not in today - so have moved the FU date to Monday",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-27",
    "company": "Holtz Construction",
    "contact": "Jurie (pronouced URY)",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "jurie@holtzconstruction.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000026000,
        "type": "Note",
        "text": "FU Monday 27.7.26 with vanessa",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-28",
    "company": "Free Flow Drains",
    "contact": "Roger Rao",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "roger@freeflowdrains.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000027000,
        "type": "Note",
        "text": "have contacted rodger - he is going to find out a little more on what we talked about with extension for their systems, he still said lets talk in 1 month - he said thank you for caring about the exp date & binding into a contract that he dosen't want anymore - @Vanessa Crafts",
        "date": "2026-07-27"
      },
      {
        "id": 1780000027002,
        "type": "Note",
        "text": "Lead source: Tradeshow",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-29",
    "company": "Pro Construction",
    "contact": "Paul",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "info@proconstruction.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000028000,
        "type": "Note",
        "text": "spoke with Paul on 17.6.26 he said he would like to wait until the end of his job at Rita - have put a date on to ring him at the end of august a she needs H & S in place prior to his next big job -",
        "date": "2026-07-27"
      },
      {
        "id": 1780000028003,
        "type": "Reminder",
        "text": "Follow up with Paul",
        "date": "2026-07-27",
        "dueDate": "2026-06-09",
        "assignee": "Jo"
      }
    ]
  },
  {
    "id": "lead-import-30",
    "company": "Diamond Scaffolding",
    "contact": "Lance",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "Lance@diamondscaffolding.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000029000,
        "type": "Note",
        "text": "spoke to lance, he wants to come on board but his site app pro doesn't expire until September, but Vanessa has offered Lance to join now & bill in september - have phoned lance to inform him hasn't returned my call as yet",
        "date": "2026-07-27"
      },
      {
        "id": 1780000029003,
        "type": "Reminder",
        "text": "Follow up with Lance",
        "date": "2026-07-27",
        "dueDate": "2026-05-29",
        "assignee": "Vanessa"
      }
    ]
  },
  {
    "id": "lead-import-31",
    "company": "Condor Civil",
    "contact": "Mark Suckling",
    "value": "",
    "stage": "Proposal Sent",
    "formEmail": "mark.s@condorcivil.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000030000,
        "type": "Note",
        "text": "Hi Mark,   My apologies, I thought I'd already sent this through. As promised, here's some further info.   OSHE is a user-centric app that creates seamless workflows across the business, keeping your management of health and safety consistent. It can be set up as a DIY solution, with us on call for any support or questions along the way. We also have highly qualified consultants on hand if you need further support, such as SOP development, site reviews, or pre-quals.   Our pricing for 25 users starts at $249+GST. This includes a complete OHSM, with policies and procedures to ensure your documentation aligns with the online system.   We also offer a complimentary one-hour onboarding session to get you up to speed and talk through setup. Further support after that is $130+GST per hour.   If you're keen to move ahead, you can complete your sign-up\u00a0 here \u00a0and we'll get the team started on setup ASAP.   Any further questions, feel free to give me a call or reply to this email.   Vanessa   SENT 20/7/26",
        "date": "2026-07-27"
      },
      {
        "id": 1780000030003,
        "type": "Reminder",
        "text": "Follow up with Mark Suckling",
        "date": "2026-07-27",
        "dueDate": "2026-05-28",
        "assignee": "Jo"
      }
    ]
  },
  {
    "id": "lead-import-32",
    "company": "Seamless Builders",
    "contact": "Amy or Jordon",
    "value": "",
    "stage": "New Lead",
    "formEmail": "amy@seamlessbuilders.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000031000,
        "type": "Note",
        "text": "rung didn't answer so will call back monday",
        "date": "2026-07-27"
      },
      {
        "id": 1780000031002,
        "type": "Note",
        "text": "Lead source: Cold Outreach",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-33",
    "company": "Rachael Stanton",
    "contact": "",
    "value": "",
    "stage": "New Lead",
    "formEmail": "info@haurakitress.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000032000,
        "type": "Note",
        "text": "Emailed Rachael to FU - we had spoke a while back but she never got back to me with any feedback with an appointment",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-34",
    "company": "CES Electrical",
    "contact": "Duane",
    "value": "",
    "stage": "New Lead",
    "formEmail": "duane@ceselectrical.co.nz",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000033000,
        "type": "Note",
        "text": "emailed duane about a FU for a chat or demo",
        "date": "2026-07-27"
      },
      {
        "id": 1780000033003,
        "type": "Reminder",
        "text": "Follow up with Duane",
        "date": "2026-07-27",
        "dueDate": "2026-05-22",
        "assignee": "Jo"
      }
    ]
  },
  {
    "id": "lead-import-35",
    "company": "Brendan Attewell",
    "contact": "",
    "value": "",
    "stage": "New Lead",
    "formEmail": "brendan@workingload.com",
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000034000,
        "type": "Note",
        "text": "Have emailed Natalie to FU",
        "date": "2026-07-27"
      }
    ]
  },
  {
    "id": "lead-import-36",
    "company": "XERO Reconcille Invoices",
    "contact": "",
    "value": "",
    "stage": "New Lead",
    "formEmail": null,
    "formStatus": "none",
    "notes": [
      {
        "id": 1780000035000,
        "type": "Note",
        "text": "@Vanessa Crafts",
        "date": "2026-07-27"
      }
    ]
  }
];

// Real client list from the 2026-07-28 CRM_Client_Migration_All_Data export (the "Clients"
// sheet only — Needs Review / Confirmed Aliases were intentionally skipped). Ids are
// slugified from each client's Name column (e.g. "BMC" -> "bmc"), so if any of these happen
// to collide with a client that already exists live (most likely candidates: "bmc" and
// "manaaki-ora-trust", both of which were in early demo/seed data at one point), the
// reconciliation effect further down skips it rather than overwriting real data — it never
// touches a client id that's already present.
const importedClientsMigration = [
  {
    "id": "alpha-waikato-ltd",
    "name": "Alpha Waikato Ltd",
    "legalName": "Alpha Interiors Waikato",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts.waikato@alphainteriors.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 30 users",
        "tags": []
      }
    ],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "black-and-white-plumbing-ltd",
    "name": "Black and White Plumbing Ltd",
    "legalName": "Black And White Plumbing Ltd",
    "logo": null,
    "contract": {
      "start": "2026-02-01",
      "renewal": "2027-02-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "chris@blackandwhiteplumbing.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      },
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 11/24 Halyard Place, Te Atat\u016b Peninsula, Auckland 0610, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "chris@blackandwhiteplumbing.co.nz",
        "phone": "+64 22 615 0234"
      }
    ],
    "ohsmsLastIssued": "2026-02-01",
    "ohsmsDue": "2027-02-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "blackhouse-group",
    "name": "Blackhouse Group",
    "legalName": "Allan Winter C/O William Orrick Blackhouse Group",
    "logo": null,
    "contract": {
      "start": "2021-06-14",
      "renewal": null,
      "value": "",
      "plan": "Per project engagement"
    },
    "billing": {
      "contact": "",
      "email": "will@blackhousegroup.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "will@blackhousegroup.co.nz",
        "phone": ""
      }
    ],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "blackrock-drilling-limited",
    "name": "Blackrock Drilling Limited",
    "legalName": "Blackrock Drilling Limited",
    "logo": null,
    "contract": {
      "start": "2026-02-01",
      "renewal": "2027-02-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@blackrockdrilling.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      },
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 63 Beachwater Drive, Papamoa Beach, Papamoa 3118, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "joe@blackrockdrilling.co.nz",
        "phone": "+64 274 903 431"
      }
    ],
    "ohsmsLastIssued": "2026-02-01",
    "ohsmsDue": "2027-02-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "bmc",
    "name": "BMC",
    "legalName": "Brendan Murray Construction",
    "logo": null,
    "contract": {
      "start": "2025-09-03",
      "renewal": null,
      "value": "",
      "plan": "Full support "
    },
    "billing": {
      "contact": "",
      "email": "accounts@bmc.net.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Enterprise Client",
    "notes": [],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 80,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "bowen-plumbing-gas-fitting",
    "name": "Bowen Plumbing & Gas Fitting",
    "legalName": "Bowen Plumbing & Gas Laying",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "office@bowenplumbing.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "bower",
    "name": "Bower",
    "legalName": "Tremain",
    "logo": null,
    "contract": {
      "start": "2025-08-01",
      "renewal": "2026-08-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@bower.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-07-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-08-01",
    "ohsmsDue": "2026-08-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "buildwizer",
    "name": "Buildwizer",
    "legalName": "Build Wizer NZ Limited",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Sole trader"
    },
    "billing": {
      "contact": "",
      "email": "buildwizer4@gmail.com",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Sole trader",
        "tags": []
      }
    ],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "civil-agri-development",
    "name": "Civil & Agri Development",
    "legalName": "Civil & Agri Developments Group Ltd",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "Sean Cuff",
      "email": "civil.agridevelopment@gmail.com",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "Sean Cuff",
        "role": "Primary Contact",
        "email": "civil.agridevelopment@gmail.com",
        "phone": ""
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "colin-amrein-contracting",
    "name": "Colin Amrein Contracting",
    "legalName": "Colin Amerin Contracting Limited",
    "logo": null,
    "contract": {
      "start": "2025-09-01",
      "renewal": "2026-09-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "info@excavatorsbop.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-08-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "info@excavatorsbop.co.nz",
        "phone": ""
      }
    ],
    "ohsmsLastIssued": "2025-09-01",
    "ohsmsDue": "2026-09-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "d-b-construction-2025-ltd",
    "name": "D&B Construction (2025) Ltd",
    "legalName": "DandB Construction (2025) Ltd",
    "logo": null,
    "contract": {
      "start": "2026-03-01",
      "renewal": "2027-03-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "taryn@dandb.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users, OHSMS",
        "tags": []
      },
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 16 Tyne Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-30",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "taryn@dandb.co.nz",
        "phone": "+64 21 188 1595"
      }
    ],
    "ohsmsLastIssued": "2026-03-01",
    "ohsmsDue": "2027-03-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "ddl-gcl",
    "name": "DDL/GCL",
    "legalName": "Good Rick Contracting and Duyvestyn Trenching & Drainage Ltd",
    "logo": null,
    "contract": {
      "start": "2024-02-01",
      "renewal": "2027-02-01",
      "value": "",
      "plan": "Houred Client, full support "
    },
    "billing": {
      "contact": "",
      "email": "admin@ddl.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 37 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-02-01",
    "ohsmsDue": "2027-02-01",
    "extras": [],
    "hours": {
      "included": 20,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "dent-builders-limited",
    "name": "Dent Builders Limited",
    "legalName": "Dent Builders",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "martin@dentbuilders.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users, OHSMS",
        "tags": []
      }
    ],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "dynamic-plumbing-works",
    "name": "Dynamic Plumbing Works",
    "legalName": "Dynamic Plumbing Works",
    "logo": null,
    "contract": {
      "start": "2025-08-01",
      "renewal": "2026-08-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@dpw.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users plus 10 additional",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-07-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-08-01",
    "ohsmsDue": "2026-08-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "east-coast-civil",
    "name": "East Coast Civil",
    "legalName": "East Coast Civil",
    "logo": null,
    "contract": {
      "start": "2025-10-01",
      "renewal": "2026-10-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "mike@eastcoastcivil.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-09-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-10-01",
    "ohsmsDue": "2026-10-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "geo-data-solutions",
    "name": "Geo Data Solutions",
    "legalName": "Geo Data Solutions",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "Accounts@gdsnz.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "gh-roofing",
    "name": "GH Roofing",
    "legalName": "GH Roofing",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@ghroofing.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 plus 24 additional app users",
        "tags": []
      }
    ],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "homes-for-living-construction-limited",
    "name": "Homes for Living Construction Limited",
    "legalName": "Homes for Living Construction Limited",
    "logo": null,
    "contract": {
      "start": "2025-08-01",
      "renewal": "2026-08-01",
      "value": "",
      "plan": "Hour Client, full support"
    },
    "billing": {
      "contact": "",
      "email": "hflaccounts@hflcl.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Hourly",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-07-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-08-01",
    "ohsmsDue": "2026-08-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "jam-group",
    "name": "JAM Group",
    "legalName": "JAM Group",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@jamltd.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "just-cabins",
    "name": "Just Cabins",
    "legalName": "Just Cabins",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Hour Client, full support"
    },
    "billing": {
      "contact": "",
      "email": "accounts@justcabins.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 73 additional users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "kaiaka-electrical",
    "name": "Kaiaka Electrical",
    "legalName": "Kaiaka Electrical Services Limited",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "kaiakaelectrical@gmail.com",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "kiwi-kerb",
    "name": "Kiwi Kerb",
    "legalName": "HighMac Civil",
    "logo": null,
    "contract": {
      "start": "2026-01-01",
      "renewal": "2027-01-01",
      "value": "",
      "plan": "Hour Client, full support"
    },
    "billing": {
      "contact": "",
      "email": "admin@highmaccivil.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Under 20 users, in system as HighMac",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-12-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-01-01",
    "ohsmsDue": "2027-01-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "kohanga-rakau-housing",
    "name": "Kohanga Rakau Housing",
    "legalName": "Owhata KR Housing LP",
    "logo": null,
    "contract": {
      "start": "2024-06-01",
      "renewal": "2025-06-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@owhata2b7trust.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2025-05-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2024-06-01",
    "ohsmsDue": "2025-06-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "ks-construction-services-limited",
    "name": "KS Construction Services Limited",
    "legalName": "K S Construction Services",
    "logo": null,
    "contract": {
      "start": "2026-07-01",
      "renewal": "2027-07-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "kscon.ltd@gmail.com",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 10 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-06-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-07-01",
    "ohsmsDue": "2027-07-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "landscape-developments",
    "name": "Landscape Developments",
    "legalName": "Landscape Developments",
    "logo": null,
    "contract": {
      "start": "2024-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "info@landevnz.com",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: System and app",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "letts",
    "name": "Letts",
    "legalName": "Letts Construction",
    "logo": null,
    "contract": {
      "start": "2021-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Up to 20 users, hours may include additional users"
    },
    "billing": {
      "contact": "",
      "email": "karen@letts.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users, hours may include additional users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "sean@letts.co.nz",
        "phone": ""
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 20,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "maketu-r-nanga",
    "name": "Maketu R\u016bnanga",
    "legalName": "Te Runanga o Ngati Whakaue ki Maketu",
    "logo": null,
    "contract": {
      "start": "2024-04-01",
      "renewal": "2027-04-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "kaitautoko@maketu-runanga.iwi.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-03-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-04-01",
    "ohsmsDue": "2027-04-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "manaaki-ora-trust",
    "name": "Manaaki Ora Trust",
    "legalName": "MANAAKI ORA TRUST - Te Rito o Manaaki Ora",
    "logo": null,
    "contract": {
      "start": "2025-09-01",
      "renewal": "2026-09-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "lwhiu@manaakiora.org.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 150 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-08-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-09-01",
    "ohsmsDue": "2026-09-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "mount-auto-electrical",
    "name": "Mount Auto Electrical",
    "legalName": "Mount Auto Electrical Ltd",
    "logo": null,
    "contract": {
      "start": "2026-03-01",
      "renewal": "2027-03-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@mael.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-30",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-03-01",
    "ohsmsDue": "2027-03-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "n-a-s-construction",
    "name": "N.A.S Construction",
    "legalName": "NAS Construction",
    "logo": null,
    "contract": {
      "start": "2026-02-01",
      "renewal": "2027-02-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "office@nasconstruction.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-02-01",
    "ohsmsDue": "2027-02-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "newline",
    "name": "Newline",
    "legalName": "Stein",
    "logo": null,
    "contract": {
      "start": "2020-06-01",
      "renewal": "2027-06-01",
      "value": "",
      "plan": "5 hours, full support"
    },
    "billing": {
      "contact": "",
      "email": "accounts@newline.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 10 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-05-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "ashley.clare@newline.co.nz",
        "phone": ""
      }
    ],
    "ohsmsLastIssued": "2026-06-01",
    "ohsmsDue": "2027-06-01",
    "extras": [],
    "hours": {
      "included": 5,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "owhata",
    "name": "Owhata",
    "legalName": "Owhata KR Housing LP",
    "logo": null,
    "contract": {
      "start": "2023-06-01",
      "renewal": "2025-06-01",
      "value": "",
      "plan": "Check in quaretly to see if any site reviews needed for projects"
    },
    "billing": {
      "contact": "",
      "email": "accounts@owhata2b7trust.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2025-05-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2024-06-01",
    "ohsmsDue": "2025-06-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "p3-earthworks",
    "name": "P3 Earthworks",
    "legalName": "Chad Empson",
    "logo": null,
    "contract": {
      "start": "2026-04-01",
      "renewal": "2027-04-01",
      "value": "",
      "plan": "Check this one - think company handoff, can be deleted?"
    },
    "billing": {
      "contact": "",
      "email": "accounts@p3earthworks.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: System and app",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-03-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-04-01",
    "ohsmsDue": "2027-04-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "pauanui-canals-management",
    "name": "Pauanui Canals Management",
    "legalName": "Pauanui Canals Management Limited",
    "logo": null,
    "contract": {
      "start": "2026-01-01",
      "renewal": "2027-01-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested - needs training "
    },
    "billing": {
      "contact": "Luana Reece",
      "email": "admin@pauanuicanals.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 3 Reweti Drive, Whitianga 3510, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-12-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "Luana Reece",
        "role": "Primary Contact",
        "email": "admin@pauanuicanals.co.nz",
        "phone": "+64 27 225 1144"
      }
    ],
    "ohsmsLastIssued": "2026-01-01",
    "ohsmsDue": "2027-01-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "perry-geotech",
    "name": "Perry Geotech",
    "legalName": "Perry Geotech Limited",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "office@perrygeotech.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "SubscriptionHours",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Not listed",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 20,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "pope-electrical",
    "name": "Pope Electrical",
    "legalName": "Pope Electrical",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@popes.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "porter-homes",
    "name": "Porter Homes",
    "legalName": "Porter Homes",
    "logo": null,
    "contract": {
      "start": "2026-01-01",
      "renewal": "2027-01-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "brett@porterhomes.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users and OHSMS",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-12-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-01-01",
    "ohsmsDue": "2027-01-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "pro-drill",
    "name": "Pro Drill",
    "legalName": "Pro-Drill (Auck) Ltd",
    "logo": null,
    "contract": {
      "start": "2025-09-23",
      "renewal": "2026-10-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "lyn@prodrill.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 30 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-09-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-10-01",
    "ohsmsDue": "2026-10-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "rescom",
    "name": "Rescom",
    "legalName": "Rescom Limited",
    "logo": null,
    "contract": {
      "start": null,
      "renewal": null,
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "reside-builders",
    "name": "Reside Builders",
    "legalName": "Reside Construction",
    "logo": null,
    "contract": {
      "start": "2019-05-01",
      "renewal": "2026-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@reside.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-05-01",
    "ohsmsDue": "2026-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "sabre-construction",
    "name": "Sabre Construction",
    "legalName": "Sabre Construction Limited",
    "logo": null,
    "contract": {
      "start": "2020-05-01",
      "renewal": "2026-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "acc@sabreconstruction.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 91 users across all Sabre entities",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-05-01",
    "ohsmsDue": "2026-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "santafe",
    "name": "SantaFe",
    "legalName": "Santa Fe Shutters Limited",
    "logo": null,
    "contract": {
      "start": "2025-09-01",
      "renewal": "2026-09-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "payables@santafe.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Under 20 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-08-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-09-01",
    "ohsmsDue": "2026-09-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "sayles-exterior-cleaning",
    "name": "Sayles Exterior Cleaning",
    "legalName": "Sayles Exterior Cleaning",
    "logo": null,
    "contract": {
      "start": "2026-03-01",
      "renewal": "2027-03-01",
      "value": "",
      "plan": "Sole trader"
    },
    "billing": {
      "contact": "",
      "email": "admin@exteriorclean.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Sole trader",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-30",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-03-01",
    "ohsmsDue": "2027-03-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "stroud-homes",
    "name": "Stroud Homes",
    "legalName": "stroud Homes",
    "logo": null,
    "contract": {
      "start": "2024-10-01",
      "renewal": "2026-10-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "lisa.mcmah@stroudhomes.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users, OHSMS",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-09-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-10-01",
    "ohsmsDue": "2026-10-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "tilyard-plumbing",
    "name": "Tilyard Plumbing",
    "legalName": "Tiyard Plumbing Limited",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@tilyards.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 23 users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "tirau-earthmovers-limited",
    "name": "Tirau Earthmovers Limited",
    "legalName": "Tirau Earthmovers Limited",
    "logo": null,
    "contract": {
      "start": "2020-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@tem.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 plus 12 additional users",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "topdrill",
    "name": "Topdrill",
    "legalName": "Topdrill Limited",
    "logo": null,
    "contract": {
      "start": "2025-12-01",
      "renewal": "2026-12-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "greg@topdrill.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: App and system",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2026-11-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2025-12-01",
    "ohsmsDue": "2026-12-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "wild-chix",
    "name": "Wild Chix",
    "legalName": "Wild Chix",
    "logo": null,
    "contract": {
      "start": "2026-03-01",
      "renewal": "2027-03-01",
      "value": "",
      "plan": "Sole Trader"
    },
    "billing": {
      "contact": "",
      "email": "info@wildchix.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: 1 user, OHSMS",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-30",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-03-01",
    "ohsmsDue": "2027-03-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "wolf-pack-construction",
    "name": "Wolf Pack Construction",
    "legalName": "Wolfpack Construction",
    "logo": null,
    "contract": {
      "start": "2026-04-01",
      "renewal": "2027-04-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@wpconstruction.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users, 1 hour",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-03-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-04-01",
    "ohsmsDue": "2027-04-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "the-hunters-club",
    "name": "The Hunters Club",
    "legalName": "The Hunters Club",
    "logo": null,
    "contract": {
      "start": "2026-03-01",
      "renewal": "2027-03-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@thehuntersclub.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 5 users",
        "tags": []
      },
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 88 Rangitane Loop Road, Kerikeri 0294, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-01-30",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "admin@thehuntersclub.co.nz",
        "phone": "+64 21 240 9969"
      }
    ],
    "ohsmsLastIssued": "2026-03-01",
    "ohsmsDue": "2027-03-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "readyset-concrete-waikato-ready-mix",
    "name": "ReadySet Concrete (Waikato Ready Mix)",
    "legalName": "ReadySet Concrete Limited",
    "logo": null,
    "contract": {
      "start": "2026-08-28",
      "renewal": "2027-08-28",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "office@wrmc.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 1,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Migration note: Up to 20 users",
        "tags": []
      }
    ],
    "reminders": [],
    "contacts": [],
    "ohsmsLastIssued": null,
    "ohsmsDue": null,
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "fresha-export-limited",
    "name": "Fresha Export Limited",
    "legalName": "Fresha Export Limited",
    "logo": null,
    "contract": {
      "start": "2020-07-01",
      "renewal": "2027-07-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "accounts@fresha.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-06-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-07-01",
    "ohsmsDue": "2027-07-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "jt-plumbing-drainage-gas",
    "name": "JT Plumbing Drainage & Gas",
    "legalName": "JT Plumbing",
    "logo": null,
    "contract": {
      "start": "2018-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@jtplumbing.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 25B Nature Place, Greerton, Tauranga 3112, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "admin@jtplumbing.co.nz",
        "phone": "+64 7 578 4479"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "wellington-continuous-spouting",
    "name": "Wellington Continuous Spouting",
    "legalName": "Wellington Continuous Spouting",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "Tim.jones@continuous.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 2/1 Prosser Street, Elsdon, Porirua 5022, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "Tim.jones@continuous.co.nz",
        "phone": "+64 21 385 600"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "buildwells-builders-limited",
    "name": "BuildWells Builders Limited",
    "legalName": "BuildWells Builders Limited",
    "logo": null,
    "contract": {
      "start": "2026-07-01",
      "renewal": "2027-07-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "nick@buildwells.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 2 Pump Lane, Whitby, Porirua 5024, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-06-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "nick@buildwells.co.nz",
        "phone": "+64 20 4166 7685"
      }
    ],
    "ohsmsLastIssued": "2026-07-01",
    "ohsmsDue": "2027-07-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "silvertree-biomass-solutions-ltd",
    "name": "Silvertree Biomass Solutions Ltd",
    "legalName": "Silvertree Biomass Solutions Ltd",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@silvertree.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 3 Coolgardie Close, Papamoa 3118, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "chad@silvertree.co.nz",
        "phone": "+64 27 800 7747"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "dt-air-ltd",
    "name": "DT Air Ltd",
    "legalName": "DT Air",
    "logo": null,
    "contract": {
      "start": "2026-06-01",
      "renewal": "2027-06-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@dtair.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 2 Bellbird Rise, Pyes Pa, Tauranga 3112, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-05-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "dave@dtair.co.nz",
        "phone": "+64 27 222 0330"
      }
    ],
    "ohsmsLastIssued": "2026-06-01",
    "ohsmsDue": "2027-06-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "air-control-systems-ltd",
    "name": "Air Control Systems Ltd",
    "legalName": "Air Control Systems Ltd",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "invoices@aircontrol.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: Unit 1/25 Maru Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "invoices@completeeletricalservices.co.nz",
        "phone": "+64 27 577 1226"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "asap-vac",
    "name": "ASAP Vac",
    "legalName": "ASAP Vac",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "admin@asapvac.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 9 Hallfield Drive, Ohoka 7692, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "chris@asapvac.com",
        "phone": "+64 21 650 609"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "goldtex-interiors-limited",
    "name": "Goldtex Interiors Limited",
    "legalName": "GOLDTEX INTERIORS LIMITED",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "invoices@completeelectricalservices.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: Unit 1/25 Maru Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "invoices@completeelectricalservices.co.nz",
        "phone": "+64 27 577 1226"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "coastal-hvac",
    "name": "Coastal HVAC",
    "legalName": "Coastal HVAC",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "office@coastalhvac.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: Unit 1/25 Maru Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "office@coastalhvac.co.nz",
        "phone": "+64 27 577 1226"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "complete-electrical-services",
    "name": "Complete Electrical Services",
    "legalName": "Complete Electrical Services",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "invoices@completeelectricalservices.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: Unit 1/25 Maru Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "invoices@completeelectricalservices.co.nz",
        "phone": "+64 27 577 1226"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "pv-solar-systems",
    "name": "PV Solar Systems",
    "legalName": "PV Solar Systems",
    "logo": null,
    "contract": {
      "start": "2026-05-01",
      "renewal": "2027-05-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "Invoices@pvsolarsystems.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: Unit 1/25 Maru Street, Mount Maunganui 3116, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "Invoices@pvsolarsystems.co.nz",
        "phone": "+64 27 577 1226"
      }
    ],
    "ohsmsLastIssued": "2026-05-01",
    "ohsmsDue": "2027-05-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "neo-build-limited",
    "name": "Neo Build Limited",
    "legalName": "Neo Build Limited",
    "logo": null,
    "contract": {
      "start": "2026-06-01",
      "renewal": "2027-06-01",
      "value": "",
      "plan": "10 hours included in set up"
    },
    "billing": {
      "contact": "",
      "email": "admin@neobuild.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 9C/8 Henry Rose Place, Albany, Auckland 0632, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-05-02",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "admin@neobuild.co.nz",
        "phone": "+64 21 907 443"
      }
    ],
    "ohsmsLastIssued": "2026-06-01",
    "ohsmsDue": "2027-06-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "effective-electrical-ltd",
    "name": "Effective Electrical Ltd",
    "legalName": "Effective Electrical Ltd",
    "logo": null,
    "contract": {
      "start": "2026-07-01",
      "renewal": "2027-07-01",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "connor@effectiveelectrical.co.nz",
      "terms": "20th of following month",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [
      {
        "id": 2,
        "author": "Import",
        "date": "2026-07-28",
        "text": "Address: 9 Duncan Street, Sumner, Christchurch 8081, New Zealand",
        "tags": []
      }
    ],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-06-01",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [
      {
        "id": 1,
        "name": "",
        "role": "Primary Contact",
        "email": "connor@effectiveelectrical.co.nz",
        "phone": "+1 201 555 2013"
      }
    ],
    "ohsmsLastIssued": "2026-07-01",
    "ohsmsDue": "2027-07-01",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "link-electrical",
    "name": "Link Electrical",
    "legalName": "Link Electrical ",
    "logo": null,
    "contract": {
      "start": "2018-06-17",
      "renewal": "2027-07-17",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "",
      "terms": "",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-05-18",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-06-17",
    "ohsmsDue": "2027-06-17",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  },
  {
    "id": "ace-drywall-tauranga",
    "name": "Ace Drywall Tauranga",
    "legalName": "Ace Drywall Tauranga ",
    "logo": null,
    "contract": {
      "start": "2026-05-26",
      "renewal": "2027-05-26",
      "value": "",
      "plan": "Flat fee client, support as needed/requested"
    },
    "billing": {
      "contact": "",
      "email": "",
      "terms": "",
      "status": "Current"
    },
    "billingType": "FlatFee",
    "billingSetupDone": true,
    "profile": "Standard Client",
    "notes": [],
    "reminders": [
      {
        "id": "ohsms-annual-review",
        "text": "OHSMS annual review due",
        "date": "2027-04-26",
        "recurring": "yearly",
        "done": false,
        "assignee": "Jo"
      }
    ],
    "contacts": [],
    "ohsmsLastIssued": "2026-05-26",
    "ohsmsDue": "2027-05-26",
    "extras": [],
    "hours": {
      "included": 0,
      "log": []
    },
    "users": {
      "log": []
    },
    "intake": null
  }
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

// Uses local date components, not toISOString() (which is always UTC) — NZ is 12-13 hours
// ahead of UTC, so for roughly the first half of every NZ day (midnight to early afternoon),
// the UTC calendar date is still "yesterday". toISOString() would silently return the wrong
// day for that whole window, which is what was causing due dates and similar to land a day
// early. This is the one place that matters — everything else in the app (addDays,
// currentMonth, etc.) is built from this, so fixing it here fixes it everywhere at once.
// Used for every generated PDF's filename — keeps real spaces (not underscores or hyphens)
// since spaces are perfectly valid in filenames on every OS this matters for, and only strips
// the handful of characters that genuinely break as a filename (/ \ : * ? " < > |), such as
// "Internal Auditing / Monitoring" containing a forward slash. Collapses any resulting double
// spaces and trims the ends.
function safeFilenamePart(str) {
  return String(str || "").replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A small "done!" chime for completing a task/reminder — synthesized with the Web Audio
// API rather than a bundled audio file, so there's nothing to host or fail to load. A
// quick two-note major-third rise (like a soft xylophone tap), low volume, self-cleans up
// after it plays. Wrapped in try/catch since some browsers block audio before any user
// gesture has happened on the page at all — better to silently skip than throw.
function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25]; // C5, E5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const startTime = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
    setTimeout(() => ctx.close(), 700);
  } catch (err) {
    // Audio is a nice-to-have here, never worth surfacing an error over.
  }
}

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
// Same local-date approach as today() above, for the same reason — parsing "YYYY-MM-DD" as
// dateStr alone is UTC midnight, and toISOString() serializes back to UTC, so the old
// version could drift a day depending on time of day and time of year (DST). Anchoring to
// local midnight ("T00:00:00", no Z) and reading local components back out avoids both.
// Shared by every date-expansion loop below — converts a Date object to a "YYYY-MM-DD"
// string using its LOCAL calendar date, never toISOString() (always UTC). Building a Date
// at local midnight and then reading it back via toISOString() silently shifts the date one
// day earlier for anyone in a timezone ahead of UTC (NZ included) — this was the same root
// cause as the today()/addDays() bug above, just showing up in several more places.
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function urgencyColor(dueDate) {
  const d = daysUntil(dueDate);
  return d < 0 ? T.coral : d <= 3 ? T.amber : T.slate;
}
function currentMonth() { return today().slice(0, 7); }

// Distinct months present in an hours log, newest first, always including the current
// month even if nothing's logged yet — so the month picker always has something to show.
function monthsWithActivity(log) {
  const set = new Set((log || []).map((h) => h.date.slice(0, 7)));
  set.add(currentMonth());
  return [...set].sort().reverse();
}

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

// A real in-app "are you sure" instead of window.confirm() — browsers silently suppress
// native confirm() after several fire in quick succession (Chrome shows a "prevent this
// page from creating additional dialogs" checkbox; once ticked, every future confirm()
// call just returns false instantly with zero dialog and zero error), which looks exactly
// like a broken delete button. This can't be suppressed the same way since it's just app UI.
// There's no error boundary anywhere else in this app, which means any uncaught render
// error — anywhere — unmounts the entire React tree and white-screens the whole thing,
// not just the piece that broke. Wrapping newer/more complex tabs (starting with
// Scheduling) means a bug there shows a small in-place message instead of taking
// everything down, and — just as usefully — the actual error message ends up visible in
// the UI instead of only in the browser console, which is a lot easier to report back.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Caught by ErrorBoundary:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <div className="text-sm font-semibold" style={{ color: T.coral }}>Something went wrong loading this.</div>
          <div className="text-xs max-w-md" style={{ color: T.slate }}>{String(this.state.error.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })} className="text-xs font-semibold px-3 py-1.5 rounded-lg mt-1" style={{ background: T.paperAlt, color: T.tealDark }}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ConfirmButton({ onConfirm, title, icon: Icon = Trash2, iconSize = 14, iconColor, confirmText = "Delete?" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button onClick={() => { setArmed(false); onConfirm(); }} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: T.coral, color: "#fff" }}>{confirmText}</button>
        <button onClick={() => setArmed(false)} className="text-[11px] font-semibold px-1.5" style={{ color: T.slateLight }}>Cancel</button>
      </span>
    );
  }
  return (
    <button onClick={() => setArmed(true)} title={title}>
      <Icon size={iconSize} color={iconColor || T.slateLight} />
    </button>
  );
}

/* ---------- Client Scheduling (Enterprise clients only) ----------
   A per-client monthly plan of who's doing what, when — site reviews, reporting, whatever
   needs to happen for that specific client's retainer. Anything here with hours syncs into
   two places automatically: the client's real Activity hours log (tagged "Schedule: ..."),
   and — for the 4 team members specifically, not External Consultant — that person's
   weekly workload on the Schedule tab, via gatherWorkloadItems reading client.scheduleEntries
   directly (see there). Both syncs are the same client-side, idempotent reconciliation
   pattern used elsewhere in this app (OHSMS reminders, touchpoint baselines): safe to run
   repeatedly, only ever adds what's missing. */
const SCHEDULE_ASSIGNEES = [...TEAM, "External Consultant"];

function monthOccurrenceDate(anchorDate, targetMonthYear) {
  const anchor = new Date(anchorDate + "T00:00:00");
  const day = anchor.getDate();
  const [y, m] = targetMonthYear.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const clampedDay = Math.min(day, daysInMonth);
  return `${targetMonthYear}-${String(clampedDay).padStart(2, "0")}`;
}
function addMonthsToMonthYear(monthYear, delta) {
  const [y, m] = monthYear.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// weekday: 0=Mon .. 6=Sun. nth: 1-4 for 1st..4th occurrence, or -1 for "last". Returns null
// if that occurrence doesn't exist in the month (e.g. a 5th Friday most months don't have).
function nthWeekdayOfMonth(monthYear, nth, weekday) {
  const [y, m] = monthYear.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  if (nth === -1) {
    for (let d = daysInMonth; d >= 1; d--) {
      if ((new Date(y, m - 1, d).getDay() + 6) % 7 === weekday) return `${monthYear}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if ((new Date(y, m - 1, d).getDay() + 6) % 7 === weekday) {
      count++;
      if (count === nth) return `${monthYear}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}
const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NTH_LABELS = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", "-1": "last" };
// Expands every repeat type into a flat list with a concrete occurrenceDate each, for
// whatever [start, end) range is being looked at (a week, a month, whatever):
// - "none": kept as-is if its own date falls inside the range.
// - "weekly": every matching weekday from the anchor date onward.
// - "monthly": same day-of-month as the anchor, clamped to however many days that month has.
// - "monthly-nth": a specific occurrence (e.g. "3rd Friday") every month — skips months
//   that genuinely don't have that occurrence (a 5th-of-something, most months).
function expandScheduleEntriesInRange(entries, start, end) {
  const out = [];
  (entries || []).forEach((e) => {
    if (e.repeat === "weekly") {
      const anchor = new Date(e.date + "T00:00:00");
      const weekday = anchor.getDay();
      const cursor = new Date(Math.max(new Date(start + "T00:00:00").getTime(), anchor.getTime()));
      while (cursor.getDay() !== weekday) cursor.setDate(cursor.getDate() + 1);
      while (toLocalDateStr(cursor) < end) {
        out.push({ ...e, occurrenceDate: toLocalDateStr(cursor) });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else if (e.repeat === "monthly") {
      let cursor = start.slice(0, 7);
      const endMonth = end.slice(0, 7);
      let guard = 0;
      while (cursor <= endMonth && guard < 36) {
        const occDate = monthOccurrenceDate(e.date, cursor);
        if (occDate >= start && occDate < end) out.push({ ...e, occurrenceDate: occDate });
        cursor = addMonthsToMonthYear(cursor, 1);
        guard++;
      }
    } else if (e.repeat === "monthly-nth") {
      let cursor = start.slice(0, 7);
      const endMonth = end.slice(0, 7);
      let guard = 0;
      while (cursor <= endMonth && guard < 36) {
        const occDate = nthWeekdayOfMonth(cursor, e.nth, e.weekday);
        if (occDate && occDate >= start && occDate < end) out.push({ ...e, occurrenceDate: occDate });
        cursor = addMonthsToMonthYear(cursor, 1);
        guard++;
      }
    } else if (e.date && e.date >= start && e.date < end) {
      out.push({ ...e, occurrenceDate: e.date });
    }
  });
  return out.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}

function ClientScheduling({ client, updateClient, toggleReminderDone }) {
  const [monthYear, setMonthYear] = useState(currentMonth());
  const [draft, setDraft] = useState({ title: "", assignee: TEAM[0], date: today(), hours: "", repeat: "none", targetId: "", nth: 1, weekday: 4 });
  const [targetDraft, setTargetDraft] = useState({ title: "", count: "", repeat: "monthly" });
  const [billableDraft, setBillableDraft] = useState({ description: "", member: TEAM[0], date: today(), type: "hours", hours: "", amount: "" });

  const entries = client.scheduleEntries || [];
  const targets = client.scheduleTargets || [];
  const monthStart = `${monthYear}-01`;
  const monthEnd = `${addMonthsToMonthYear(monthYear, 1)}-01`;
  const occurrences = expandScheduleEntriesInRange(entries, monthStart, monthEnd);

  // Each scheduled occurrence becomes a real task in this client's Tasks tab — same place
  // (and same completion flow, same "coming up due" visibility rules) as anything else
  // there — rather than a separate thing only visible on this tab. That's also what makes
  // it show up in the assigned person's My Tasks and on the Schedule tab: both already read
  // from client.reminders, so nothing extra was needed there once this exists.
  //
  // Deliberately does NOT touch the hours log here. These are pre-programmed in advance —
  // scheduled doesn't mean done — so billing only happens once the task is actually ticked
  // off (see toggleReminderDone), not just because the calendar date arrived. One reminder
  // per occurrence (id includes the date), so a recurring item's history stays separate
  // per occurrence rather than one shared task getting silently reused/stale.
  // Wrapped in try/catch since errors thrown inside an effect (unlike render) aren't caught
  // by ErrorBoundary — better to log it and skip the sync than let it interrupt anything.
  useEffect(() => {
    try {
      const thisMonth = currentMonth();
      const rangeStart = `${thisMonth}-01`;
      // Just the current month now, not +2 — creating 2 months of tasks at once for every
      // recurring item was the main thing making this feel cluttered.
      const rangeEnd = `${addMonthsToMonthYear(thisMonth, 1)}-01`;
      const upcoming = expandScheduleEntriesInRange(entries, rangeStart, rangeEnd);
      const existingIds = new Set((client.reminders || []).map((r) => r.id));
      const deletedIds = new Set(client.deletedScheduleTaskIds || []);
      const newReminders = [];
      upcoming.forEach((occ) => {
        const taskId = `sched-task-${occ.id}-${occ.occurrenceDate}`;
        if (!existingIds.has(taskId) && !deletedIds.has(taskId)) {
          newReminders.push({ id: taskId, text: occ.title, date: occ.occurrenceDate, assignee: occ.assignee, estHours: occ.hours || 0, done: false, recurring: "none", targetId: occ.targetId || null });
        }
      });

      // Cleanup pass, two related but distinct cases:
      // 1) The entry still exists but its computed date shifted (the timezone fix) — the OLD
      //    wrong-date task sits next to a newly-created correct one.
      // 2) The entry was deleted outright at some point before removeEntry's own cleanup
      //    existed, leaving its tasks orphaned with no parent entry left to check a date
      //    against at all — case 1's check alone doesn't catch this, since "does the date
      //    match a valid occurrence" only makes sense for an entry that's still there.
      // Either way, only NOT-DONE tasks are touched — done ones are real (possibly already
      // billed) history and are never removed just because their source entry is gone.
      const wideStart = `${addMonthsToMonthYear(thisMonth, -1)}-01`;
      const wideEnd = `${addMonthsToMonthYear(thisMonth, 3)}-01`;
      const currentEntryIds = new Set(entries.map((e) => e.id));
      const validDatesByEntry = {};
      entries.forEach((e) => {
        validDatesByEntry[e.id] = new Set(expandScheduleEntriesInRange([e], wideStart, wideEnd).map((occ) => occ.occurrenceDate));
      });
      const staleIds = new Set(
        (client.reminders || [])
          .filter((r) => String(r.id).startsWith("sched-task-") && !r.done)
          .filter((r) => {
            const match = String(r.id).match(/^sched-task-(.+)-(\d{4}-\d{2}-\d{2})$/);
            if (!match) return false;
            const [, entryId, dateStr] = match;
            if (!currentEntryIds.has(entryId)) return true; // case 2: orphaned, entry gone entirely
            const validDates = validDatesByEntry[entryId];
            return validDates && !validDates.has(dateStr); // case 1: entry exists, date no longer valid
          })
          .map((r) => r.id)
      );

      if (newReminders.length > 0 || staleIds.size > 0) {
        updateClient((c) => ({
          ...c,
          reminders: [...(c.reminders || []).filter((r) => !staleIds.has(r.id)), ...newReminders],
        }));
      }
    } catch (err) {
      console.error("Client Scheduling task sync failed:", err);
    }
  }, [client.id, JSON.stringify(entries)]);

  const addEntry = () => {
    if (!draft.title.trim() || !draft.date || !draft.hours) return;
    const entry = {
      id: "sched" + Date.now(), title: draft.title.trim(), assignee: draft.assignee, date: draft.date, hours: Number(draft.hours),
      repeat: draft.repeat, targetId: draft.targetId || null,
      ...(draft.repeat === "monthly-nth" ? { nth: Number(draft.nth), weekday: Number(draft.weekday) } : {}),
    };
    updateClient((c) => ({ ...c, scheduleEntries: [...(c.scheduleEntries || []), entry] }));
    setDraft({ title: "", assignee: TEAM[0], date: today(), hours: "", repeat: "none", targetId: "", nth: 1, weekday: 4 });
  };
  const removeEntry = (id) => {
    updateClient((c) => ({
      ...c,
      scheduleEntries: (c.scheduleEntries || []).filter((e) => e.id !== id),
      // Cleans up every task this entry created (one per occurrence, all sharing the
      // "sched-task-{id}-" prefix) — not just the current month's, since occurrences up to
      // 2 months out may have already been created.
      reminders: (c.reminders || []).filter((r) => !String(r.id).startsWith(`sched-task-${id}-`)),
      // And any of those tasks that were already ticked off already have a matching hours.log
      // entry (id "sched-hours-sched-task-{id}-...") — without this, deleting the schedule
      // entry after it was already billed left that hours entry sitting there orphaned,
      // permanently, with nothing left pointing back to it to ever clean it up.
      hours: { ...c.hours, log: (c.hours?.log || []).filter((h) => !String(h.id).startsWith(`sched-hours-sched-task-${id}-`)) },
    }));
  };

  // Monthly targets ("we need 8 site reviews this month") — a quota checked against actual
  // completed work, not just what's scheduled. Progress counts DONE tasks linked to this
  // target (matched by targetId, set when a scheduled item is explicitly linked to a target
  // in the add-entry form below) whose date falls in the month being viewed — a target with
  // 4 Fridays scheduled this month reads 0/4 until those Friday tasks actually get ticked
  // off, not 4/4 the moment they're on the calendar. "Repeats monthly" targets apply to
  // every month you look at; "This month only" targets are scoped to the specific month
  // they were created in and only show while viewing that month.
  const progressFor = (target) => (client.reminders || []).filter((r) => r.targetId === target.id && r.done && r.date.slice(0, 7) === monthYear).length;
  const visibleTargets = targets.filter((t) => t.repeat === "monthly" || t.monthYear === monthYear);
  const addTarget = () => {
    if (!targetDraft.title.trim() || !targetDraft.count) return;
    const target = { id: "target" + Date.now(), title: targetDraft.title.trim(), targetCount: Number(targetDraft.count), repeat: targetDraft.repeat, monthYear: targetDraft.repeat === "none" ? monthYear : null };
    updateClient((c) => ({ ...c, scheduleTargets: [...(c.scheduleTargets || []), target] }));
    setTargetDraft({ title: "", count: "", repeat: "monthly" });
  };
  const removeTarget = (id) => updateClient((c) => ({ ...c, scheduleTargets: (c.scheduleTargets || []).filter((t) => t.id !== id) }));

  // Billable time (travel, admin, anything that isn't a "scheduled" item) — either hours
  // (logs into the real hours log, like everything else here) or a flat dollar amount
  // (flights, gear, anything that isn't hourly work — kept in a separate billableExpenses
  // list since it has no hours value to add to a hours total). Neither ever touches
  // scheduleEntries, so neither shows on the calendar above or counts toward anyone's
  // Schedule tab workload — both are just for the client's billing, itemised on the real
  // Billing tab (Sophie/Vanessa) rather than collapsed into a single hours number.
  const billableHoursThisMonth = (client.hours?.log || [])
    .filter((h) => String(h.id).startsWith("billable-") && h.date && h.date.slice(0, 7) === monthYear)
    .map((h) => ({ ...h, kind: "hours" }));
  const billableExpensesThisMonth = (client.billableExpenses || [])
    .filter((x) => x.date && x.date.slice(0, 7) === monthYear)
    .map((x) => ({ ...x, kind: "amount" }));
  const billableThisMonth = [...billableHoursThisMonth, ...billableExpensesThisMonth].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const addBillableTime = () => {
    if (!billableDraft.description.trim() || !billableDraft.date) return;
    if (billableDraft.type === "hours") {
      if (!billableDraft.hours) return;
      const entry = { id: "billable-" + Date.now(), date: billableDraft.date, member: billableDraft.member, hours: Number(billableDraft.hours), description: `Billable: ${billableDraft.description.trim()}` };
      updateClient((c) => ({ ...c, hours: { ...c.hours, log: [...(c.hours?.log || []), entry] } }));
    } else {
      if (!billableDraft.amount) return;
      const entry = { id: "expense-" + Date.now(), date: billableDraft.date, member: billableDraft.member, amount: Number(billableDraft.amount), description: billableDraft.description.trim() };
      updateClient((c) => ({ ...c, billableExpenses: [...(c.billableExpenses || []), entry] }));
    }
    setBillableDraft({ description: "", member: TEAM[0], date: today(), type: billableDraft.type, hours: "", amount: "" });
  };
  const removeBillableTime = (item) => {
    if (item.kind === "hours") updateClient((c) => ({ ...c, hours: { ...c.hours, log: (c.hours?.log || []).filter((h) => h.id !== item.id) } }));
    else updateClient((c) => ({ ...c, billableExpenses: (c.billableExpenses || []).filter((x) => x.id !== item.id) }));
  };

  const [gy, gm] = monthYear.split("-").map(Number);
  const daysInMonth = new Date(gy, gm, 0).getDate();
  const startWeekday = (new Date(gy, gm - 1, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthYear}-${String(d).padStart(2, "0")}`);
  const assigneeColor = (a) => (a === "External Consultant" ? T.amber : T.tealDark);

  // "What's left to do this month" / "Coming up" — reads the real linked tasks (not just
  // the raw calendar entries), so this reflects what's actually still outstanding, not just
  // what's scheduled. A completed occurrence drops off "left to do" the moment it's ticked.
  const thisRealMonth = currentMonth();
  const nextRealMonth = addMonthsToMonthYear(thisRealMonth, 1);
  const leftToDoThisMonth = (client.reminders || [])
    .filter((r) => String(r.id).startsWith("sched-task-") && !r.done && r.date.slice(0, 7) === thisRealMonth)
    .sort((a, b) => a.date.localeCompare(b.date));
  const comingUpNextMonth = (client.reminders || [])
    .filter((r) => String(r.id).startsWith("sched-task-") && r.date.slice(0, 7) === nextRealMonth)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Card style={{ padding: 16 }}>
          <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>Left to do this month</div>
          <div className="text-[11px] mb-2" style={{ color: T.slateLight }}>Tick these off as they're actually done — that's what moves target progress and billing, not just being on the calendar.</div>
          <div className="flex flex-col gap-1.5">
            {leftToDoThisMonth.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: `1px solid ${T.border}` }}>
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => toggleReminderDone && toggleReminderDone(r.id)} title="Mark done">
                    <Circle size={14} color={T.slate} />
                  </button>
                  <span className="truncate" style={{ color: T.ink }}>{r.text}</span>
                </div>
                <span className="shrink-0 ml-2" style={{ color: T.slateLight }}>{r.assignee} · {fmtDate(r.date)}</span>
              </div>
            ))}
            {leftToDoThisMonth.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing outstanding for this month.</div>}
          </div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div className="text-sm font-semibold mb-2" style={{ color: T.ink }}>Coming up — {monthLabel(nextRealMonth)}</div>
          <div className="flex flex-col gap-1.5">
            {comingUpNextMonth.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: `1px solid ${T.border}` }}>
                <span style={{ color: T.ink }}>{r.text}</span>
                <span style={{ color: T.slateLight }}>{r.assignee} · {fmtDate(r.date)}</span>
              </div>
            ))}
            {comingUpNextMonth.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing scheduled yet for next month.</div>}
          </div>
        </Card>
      </div>

      <Card style={{ padding: "10px 16px" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setMonthYear(addMonthsToMonthYear(monthYear, -1))}><ChevronLeft size={16} color={T.slate} /></button>
          <span className="text-sm font-semibold" style={{ color: T.ink }}>{monthYear === currentMonth() ? "This month" : monthLabel(monthYear)}</span>
          <button onClick={() => setMonthYear(addMonthsToMonthYear(monthYear, 1))}><ChevronRight size={16} color={T.slate} /></button>
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="text-[10px] font-semibold text-center" style={{ color: T.slateLight }}>{d}</div>
          ))}
          {cells.map((date, i) => (
            <div key={i} style={{ minHeight: 74, background: date ? T.paperAlt : "transparent", borderRadius: 8, padding: 4 }}>
              {date && <div className="text-[10px]" style={{ color: T.slateLight }}>{Number(date.slice(8))}</div>}
              {date && occurrences.filter((o) => o.occurrenceDate === date).map((o) => (
                <div key={o.id + o.occurrenceDate} className="text-[9px] rounded px-1 py-0.5 mt-0.5 truncate" style={{ background: T.card, color: assigneeColor(o.assignee) }} title={`${o.title} — ${o.assignee} — ${o.hours}h`}>
                  {o.title} · {o.hours}h
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>Monthly targets</div>
        <div className="text-[11px] mb-3" style={{ color: T.slateLight }}>How many of each thing should happen this month, checked against the calendar above for {monthYear === currentMonth() ? "this month" : monthLabel(monthYear)}.</div>
        <div className="flex flex-col gap-2 mb-3">
          {visibleTargets.map((t) => {
            const done = progressFor(t);
            const complete = done >= t.targetCount;
            return (
              <div key={t.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                <div>
                  <span style={{ color: T.ink, fontWeight: 600 }}>{t.title}</span>
                  <span className="ml-2 text-[11px]" style={{ color: T.slateLight }}>{t.repeat === "monthly" ? "repeats monthly" : monthLabel(t.monthYear || monthYear) + " only"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ color: complete ? T.tealDark : T.amber, background: T.paperAlt }}>{done}/{t.targetCount}</span>
                  <ConfirmButton onConfirm={() => removeTarget(t.id)} title="Remove target" iconSize={13} />
                </div>
              </div>
            );
          })}
          {visibleTargets.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No targets set for {monthYear === currentMonth() ? "this month" : monthLabel(monthYear)}.</div>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="What (e.g. Site review)" value={targetDraft.title} onChange={(e) => setTargetDraft({ ...targetDraft, title: e.target.value })}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 120 }} />
          <input type="number" min="1" placeholder="How many" value={targetDraft.count} onChange={(e) => setTargetDraft({ ...targetDraft, count: e.target.value })}
            className="w-24 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          <select value={targetDraft.repeat} onChange={(e) => setTargetDraft({ ...targetDraft, repeat: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            <option value="monthly">Repeats monthly</option>
            <option value="none">This month only</option>
          </select>
          <button onClick={addTarget} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add target</button>
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>All scheduled items</div>
        <div className="flex flex-col gap-2 mb-3">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
              <div>
                <span style={{ color: T.ink, fontWeight: 600 }}>{e.title}</span>
                <span className="ml-2 text-xs" style={{ color: T.slate }}>
                  {e.assignee} · {fmtDate(e.date)}
                  {e.repeat === "weekly" ? " · weekly" : e.repeat === "monthly" ? " · monthly (same date)" : e.repeat === "monthly-nth" ? ` · ${NTH_LABELS[e.nth]} ${WEEKDAY_LABELS[e.weekday]} of each month` : ""}
                  {" · "}{e.hours}h{e.targetId ? " · counts toward target" : ""}
                </span>
              </div>
              <ConfirmButton onConfirm={() => removeEntry(e.id)} title="Remove" iconSize={13} />
            </div>
          ))}
          {entries.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing scheduled yet.</div>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={draft.targetId} onChange={(e) => {
              const targetId = e.target.value;
              const linked = targets.find((t) => t.id === targetId);
              setDraft({ ...draft, targetId, title: linked ? linked.title : draft.title });
            }}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Link this item to a monthly target so it counts toward its progress">
            <option value="">Not linked to a target</option>
            {targets.map((t) => <option key={t.id} value={t.id}>Counts toward: {t.title}</option>)}
          </select>
          <input placeholder="What (e.g. Site review)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            disabled={Boolean(draft.targetId)}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 140, opacity: draft.targetId ? 0.7 : 1 }} />
          <select value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            {SCHEDULE_ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          <input type="number" min="0" step="0.5" placeholder="hrs" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
            className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          <select value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            <option value="none">This month only</option>
            <option value="weekly">Repeats weekly</option>
            <option value="monthly">Repeats monthly (same date)</option>
            <option value="monthly-nth">Repeats monthly (specific day)</option>
          </select>
          {draft.repeat === "monthly-nth" && (
            <>
              <select value={draft.nth} onChange={(e) => setDraft({ ...draft, nth: e.target.value })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{NTH_LABELS[n]}</option>)}
                <option value="-1">Last</option>
              </select>
              <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: e.target.value })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                {WEEKDAY_LABELS.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </>
          )}
          <button onClick={addEntry} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>Billable time</div>
        <div className="text-[11px] mb-3" style={{ color: T.slateLight }}>Travel, admin, flights, anything billable that isn't a scheduled item — as hours or a flat dollar amount. Goes straight into Activity/Billing, itemised — never shows on the calendar above or on anyone's Schedule tab.</div>
        <div className="flex flex-col gap-2 mb-3">
          {billableThisMonth.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
              <div>
                <span style={{ color: T.ink, fontWeight: 600 }}>{item.description.replace(/^Billable: /, "")}</span>
                <span className="ml-2 text-xs" style={{ color: T.slate }}>{item.member} · {fmtDate(item.date)} · {item.kind === "hours" ? `${item.hours}h` : `$${item.amount}`}</span>
              </div>
              <ConfirmButton onConfirm={() => removeBillableTime(item)} title="Remove" iconSize={13} />
            </div>
          ))}
          {billableThisMonth.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing logged for {monthYear === currentMonth() ? "this month" : monthLabel(monthYear)} yet.</div>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="What (e.g. Travel to site, or Flight)" value={billableDraft.description} onChange={(e) => setBillableDraft({ ...billableDraft, description: e.target.value })}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 140 }} />
          <select value={billableDraft.member} onChange={(e) => setBillableDraft({ ...billableDraft, member: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            {SCHEDULE_ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={billableDraft.date} onChange={(e) => setBillableDraft({ ...billableDraft, date: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          <select value={billableDraft.type} onChange={(e) => setBillableDraft({ ...billableDraft, type: e.target.value })}
            className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            <option value="hours">Hours</option>
            <option value="amount">Dollar amount</option>
          </select>
          {billableDraft.type === "hours" ? (
            <input type="number" min="0" step="0.5" placeholder="hrs" value={billableDraft.hours} onChange={(e) => setBillableDraft({ ...billableDraft, hours: e.target.value })}
              className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          ) : (
            <input type="number" min="0" step="0.01" placeholder="$" value={billableDraft.amount} onChange={(e) => setBillableDraft({ ...billableDraft, amount: e.target.value })}
              className="w-20 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          )}
          <button onClick={addBillableTime} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log</button>
        </div>
      </Card>

      <div className="text-xs text-center" style={{ color: T.slateLight }}>
        Every scheduled item creates a real task in this client's Tasks tab, due on that date — which is also what makes it show up in the assigned person's My Tasks and on their Schedule tab. It only counts toward Activity/Billing hours once that task is actually ticked off, since these are pre-programmed in advance — being on the calendar isn't the same as being done. Billable time below is different: it's a direct log, so it lands in Activity hours (tagged "Billable: …") immediately, but never on the calendar or anyone's Schedule tab either way.
      </div>
    </div>
  );
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
      // Recurring steps complete like any other step here. They don't reopen themselves or
      // block the workflow from progressing. What "recurring" actually means only kicks in
      // once the whole workflow finishes (below): that's when it becomes an ongoing task
      // instead of a one-time onboarding step.
      const steps = inst.steps.map((s) => (s.id === stepId ? { ...s, done: true } : s));
      const nowComplete = steps.every((s) => s.done);
      if (nowComplete) {
        pushNotification({ forPerson: "Vanessa", clientId: client.id, clientName: client.name, message: `${client.name}: ${inst.workflowName} complete, add to billing` });
        // Every recurring step in this now-finished workflow becomes a real client task,
        // due on its actual next anniversary date, and genuinely recurring from there via
        // the normal reminder recurring mechanism (see toggleReminderDone), not the workflow
        // itself. Fixed id per step per instance, so re-completing an already-finished
        // workflow instance never creates a duplicate. Yearly steps (the common case for
        // things like annual pre-qualification) also get 3 staged early-warning
        // notifications at 90/60/30 days before the due date, so it's flagged well ahead of
        // time rather than surfacing only once it's already close. Monthly/quarterly steps
        // keep the simpler single reminder fired 30 days early, since 90-day advance notice
        // doesn't make sense on something that recurs monthly.
        const recurringSteps = steps.filter((s) => s.recurring && s.recurring !== "none");
        if (recurringSteps.length > 0) {
          const intervalDays = { monthly: 30, quarterly: 90, yearly: 365 };
          const newReminders = recurringSteps.flatMap((s) => {
            const baseId = `workflow-recurring-${inst.id}-${s.id}`;
            if (s.recurring === "yearly") {
              const dueDate = addDays(s.dueDate || today(), intervalDays.yearly);
              const mainReminder = { id: baseId, text: s.title, assignee: s.owner, estHours: s.estHours || 0, done: false, recurring: "yearly", date: dueDate };
              const staged = [90, 60, 30].map((days) => ({
                id: `${baseId}-${days}d`, text: `${s.title}, due in ${days} days`, assignee: s.owner, estHours: 0, done: false, recurring: "none",
                date: addDays(dueDate, -days),
              }));
              return [mainReminder, ...staged];
            }
            return [{
              id: baseId, text: s.title, assignee: s.owner, estHours: s.estHours || 0, done: false, recurring: s.recurring,
              date: addDays(addDays(s.dueDate || today(), intervalDays[s.recurring] || 30), -30),
            }];
          });
          const existingIds = new Set((client.reminders || []).map((r) => r.id));
          const toAdd = newReminders.filter((r) => !existingIds.has(r.id));
          if (toAdd.length > 0) {
            updateDoc(doc(db, "clients", client.id), { reminders: [...(client.reminders || []), ...toAdd] });
          }
        }
        return { ...inst, steps, completedDate: today() };
      }
      return { ...inst, steps };
    }));
  };
  // An "Email to client" step doesn't get a plain checkbox. Clicking it queues the actual
  // email (same mail-collection pipeline as the Sales tab's sign-up link) to whichever
  // address is on file for the client, substituting {{clientName}} in the body, then marks
  // the step done via the normal markDone flow so recurring email steps behave the same
  // way any other recurring step does.
  const sendStepEmail = async (inst, step) => {
    const to = client.billing?.email || client.contacts?.[0]?.email;
    if (!to) { alert(`No email address on file for ${client.name}. Add one on the Overview tab first.`); return; }
    try {
      await setDoc(doc(collection(db, "mail")), {
        to: [to],
        message: {
          subject: (step.emailSubject || step.title).replaceAll("{{clientName}}", client.name),
          html: (step.emailBody || "").replaceAll("{{clientName}}", client.name).replaceAll("\n", "<br>"),
        },
      });
      markDone(inst.id, step.id);
    } catch (err) {
      console.error("Couldn't queue workflow step email:", err);
      alert(`Couldn't send this email: ${err.message || err}`);
    }
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

  const removeOnboardingInstance = (instId) => {
    updateOnboardingsForClient(client.id, (clientList) => clientList.filter((i) => i.id !== instId));
  };

  // Billable hours on a workflow instance aren't a separate number sitting off to the side.
  // they're a real entry in this client's hours log (same one the Activity tab's "Hours
  // this month" and Monthly Hours list already read from), keyed by a fixed id derived from
  // the instance so changing the hours updates that same entry instead of creating another.
  const setInstanceBillable = (inst, billable, hours) => {
    const safeHours = hours == null ? 0 : hours;
    updateOnboardingsForClient(client.id, (clientList) => clientList.map((i) => (i.id === inst.id ? { ...i, billable, billableHours: safeHours } : i)));
    const logId = "wf-billable-" + inst.id;
    const withoutOld = (client.hours?.log || []).filter((h) => h.id !== logId);
    const nextLog = billable && safeHours
      ? [...withoutOld, { id: logId, date: inst.completedDate || today(), member: "Workflow", hours: Number(safeHours) || 0, description: `Billable: ${inst.workflowName}` }]
      : withoutOld;
    updateDoc(doc(db, "clients", client.id), { hours: { ...client.hours, log: nextLog } });
  };

  // Once a workflow's actually running for a client, the due date and assignee set on the
  // template rarely stays exactly right. A step might genuinely need to happen later, or
  // land with a different person than the template's default. Editing them here only ever
  // touches this one client's instance, never the shared workflow template itself.
  const updateStepField = (instId, stepId, field, value) => {
    updateOnboardingsForClient(client.id, (clientList) => clientList.map((inst) => {
      if (inst.id !== instId) return inst;
      return { ...inst, steps: inst.steps.map((s) => (s.id === stepId ? { ...s, [field]: value } : s)) };
    }));
  };
  // One free-text note per running workflow instance, for anything worth flagging about
  // this specific client's run of it that doesn't fit anywhere else, distinct from a
  // step: a delay explanation, why the date got pushed, who to chase, etc.
  const updateInstanceNote = (instId, note) => {
    updateOnboardingsForClient(client.id, (clientList) => clientList.map((inst) => (inst.id === instId ? { ...inst, note } : inst)));
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
              <div className="flex items-center gap-2">
                <button onClick={goToWorkflows} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                  Edit this workflow
                </button>
                <ConfirmButton onConfirm={() => removeOnboardingInstance(inst.id)} title="Remove this workflow from this client" iconSize={14} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: T.slate }}>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={inst.billable || false}
                  onChange={(e) => setInstanceBillable(inst, e.target.checked, inst.billableHours)} />
                Billable
              </label>
              {inst.billable && (
                <>
                  <span>&middot;</span>
                  <input type="number" min="0" step="0.5" value={inst.billableHours ?? ""}
                    onChange={(e) => setInstanceBillable(inst, true, e.target.value ? Number(e.target.value) : 0)}
                    placeholder="0" className="w-16 px-2 py-1 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <span>hrs for this workflow, added to this client's Activity hours log</span>
                </>
              )}
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
                          <div className="text-sm flex items-center gap-1.5" style={{ color: T.ink, textDecoration: s.done ? "line-through" : "none" }}>
                            {s.type === "email" && <Mail size={12} color={T.blue} />}
                            {s.title}
                          </div>
                          <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: T.slate }}>
                            {s.type === "email" && <span className="text-[11px]">to send:</span>}
                            <select value={s.owner} onChange={(e) => updateStepField(inst.id, s.id, "owner", e.target.value)}
                              className="text-xs px-1.5 py-0.5 rounded-md outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, background: "transparent" }}>
                              {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                            {!s.done && (
                              <input type="date" value={s.dueDate || ""} onChange={(e) => updateStepField(inst.id, s.id, "dueDate", e.target.value)}
                                className="text-xs px-1.5 py-0.5 rounded-md outline-none" style={{ border: `1px solid ${T.border}`, color: urgencyColor(s.dueDate) }} />
                            )}
                            {s.recurring && s.recurring !== "none" && (
                              <span className="flex items-center gap-1" style={{ color: T.slateLight }}><Repeat size={10} /> {s.recurring}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isCurrent && !s.done && (
                        s.type === "email" ? (
                          <button onClick={() => sendStepEmail(inst, s)} className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: T.blue, color: "#fff" }}>
                            <Mail size={13} /> Send email to client
                          </button>
                        ) : (
                          <button onClick={() => markDone(inst.id, s.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: T.tealDark, color: "#fff" }}>
                            Mark done &amp; hand off
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card style={{ padding: 14 }}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Note for this workflow</div>
              <textarea
                defaultValue={inst.note || ""}
                onBlur={(e) => updateInstanceNote(inst.id, e.target.value)}
                placeholder="Anything worth flagging about this client's run of this workflow, why a date moved, who to chase, etc."
                rows={2}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y"
                style={{ border: `1px solid ${T.border}`, color: T.ink }}
              />
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
// Shared by ClientsView's "Mark issued today" button and the Manual PDF download — an
// OHSMS review reminder always has this shape: fires 30 days before the actual due date
// (an early-warning buffer, not the due date itself), yearly, assigned to Jo.
function ohsmsAnnualReminder(dueDate) {
  return { id: "ohsms-annual-review", text: "OHSMS annual review due", date: addDays(dueDate, -30), recurring: "yearly", done: false, assignee: "Jo", estHours: 0.5 };
}
function upsertOhsmsReminder(reminders, dueDate) {
  const reminder = ohsmsAnnualReminder(dueDate);
  const idx = (reminders || []).findIndex((r) => r.id === "ohsms-annual-review");
  return idx >= 0 ? reminders.map((r, i) => (i === idx ? reminder : r)) : [...(reminders || []), reminder];
}

function ClientsView({ clients, selectedId, setSelectedId, onboardings, updateOnboardingsForClient, workflows, pushNotification, goToWorkflows, tabRequest, currentUser }) {
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    if (tabRequest && tabRequest.nonce) setTab(tabRequest.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRequest && tabRequest.nonce]);
  const [newHour, setNewHour] = useState({ member: TEAM[0], hours: "", description: "", date: today() });
  const [newExtra, setNewExtra] = useState({ description: "", hours: "" });
  const [newUserCount, setNewUserCount] = useState("");
  const [newContact, setNewContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [noteDraft, setNoteDraft] = useState({ text: "", tags: [] });
  const [newReminder, setNewReminder] = useState({ text: "", date: "", recurring: "none", assignee: TEAM[0], estHours: "" });
  const [showAddClient, setShowAddClient] = useState(false);
  const [showGeneratedDocs, setShowGeneratedDocs] = useState(false);
  // If the clients list is ever completely empty (freshly cleared, brand new install, or
  // testing), fall straight into the Add Client form instead of letting the detail pane try
  // to render around a client that doesn't exist — that's what was crashing before.
  useEffect(() => {
    if (clients.length === 0) setShowAddClient(true);
  }, [clients.length]);
  const [newClientForm, setNewClientForm] = useState({
    name: "", legalName: "", plan: "", contractStart: "", contractRenewal: "",
    billingContact: "", billingEmail: "", billingTerms: "", billingStatus: "Current",
    billingType: "FlatFee", profile: "Standard Client", includedHours: "", ohsmsLastIssued: "",
  });
  const setNCF = (field, value) => setNewClientForm((f) => ({ ...f, [field]: value }));
  const [showArchived, setShowArchived] = useState(false);
  const [viewMonth, setViewMonth] = useState(currentMonth());
  useEffect(() => { setViewMonth(currentMonth()); }, [client?.id]);
  const [clientSearch, setClientSearch] = useState("");
  const visibleClients = clients
    .filter((c) => (showArchived ? c.archived : !c.archived))
    .filter((c) => {
      const q = clientSearch.trim().toLowerCase();
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.legalName || "").toLowerCase().includes(q);
    });

  const archiveClient = (id) => updateDoc(doc(db, "clients", id), { archived: true });
  const unarchiveClient = (id) => updateDoc(doc(db, "clients", id), { archived: false });
  const deleteClientPermanently = async (id) => {
    try {
      await deleteDoc(doc(db, "clients", id));
      // If this was one of the batch-imported clients, record it so the reconciliation
      // effect that adds any "missing" imported clients doesn't mistake this deliberate
      // deletion for "never imported yet" and recreate it fresh.
      setDoc(doc(db, "meta", "deletedImports"), { clientIds: arrayUnion(id) }, { merge: true }).catch((err) => console.error("Couldn't record deletion tombstone:", err));
      if (id === client.id) {
        const next = clients.find((c) => c.id !== id);
        if (next) setSelectedId(next.id);
      }
    } catch (err) {
      console.error("Client delete failed:", err);
      alert(`Couldn't delete this client: ${err.message || err}${err.code === "permission-denied" ? "\n\nThis usually means the Firestore security rules don't allow deleting from the \"clients\" collection — that needs fixing in the Firebase console, not in the app itself." : ""}`);
    }
  };

  const updateClient = (fn) => {
    const updated = fn(client);
    const { id, ...fields } = updated;
    updateDoc(doc(db, "clients", client.id), fields);
  };

  const [uploadingClientFile, setUploadingClientFile] = useState(false);
  const uploadClientFile = async (file) => {
    if (!file) return;
    setUploadingClientFile(true);
    try {
      const path = `client-files/${client.id}/${Date.now()}-${file.name}`;
      await uploadBytes(storageRef(storage, path), file);
      const entry = { id: Date.now(), path, name: file.name, uploadedAt: today() };
      updateClient((c) => ({ ...c, files: [...(c.files || []), entry] }));
    } catch (err) {
      console.error("Client file upload failed:", err);
      alert(`Couldn't upload that file: ${err.message || err}`);
    } finally {
      setUploadingClientFile(false);
    }
  };
  const viewClientFile = async (path) => {
    try {
      const url = await getDownloadURL(storageRef(storage, path));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Couldn't open file:", err);
      alert("Couldn't open that file.");
    }
  };
  const removeClientFile = (fileId) => updateClient((c) => ({ ...c, files: (c.files || []).filter((f) => f.id !== fileId) }));
  const viewGeneratedDocument = viewClientFile; // same Storage-backed pattern, just a different array
  const removeGeneratedDocument = (docId) => updateClient((c) => ({ ...c, generatedDocuments: (c.generatedDocuments || []).filter((d) => d.id !== docId) }));

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
      ohsmsLastIssued: lastIssued, ohsmsDue: lastIssued ? addDays(lastIssued, 365) : null,
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
        hours = { ...c.hours, log: [...c.hours.log, { id: Date.now(), date: today(), member: "Extra work", hours: justDone.hours, description: `Extra: ${justDone.description}`, archived: false }] };
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
    if (!newHour.description.trim() || !newHour.hours || !newHour.date) return;
    updateClient((c) => ({ ...c, hours: { ...c.hours, log: [...c.hours.log, { id: Date.now(), date: newHour.date, member: newHour.member, hours: Number(newHour.hours), description: newHour.description }] } }));
    setNewHour({ member: newHour.member, hours: "", description: "", date: today() });
  };
  // Deletes straight out of the same hours log Billing reads from — nothing else to sync,
  // it disappears from the itemised Billing breakdown the moment it's gone here.
  const removeHour = (id) => updateClient((c) => ({ ...c, hours: { ...c.hours, log: c.hours.log.filter((h) => h.id !== id) } }));
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
  const withOhsmsReminder = (c, dueDate) => ({ ...c, reminders: upsertOhsmsReminder(c.reminders, dueDate) });
  const addReminder = () => {
    if (!newReminder.text.trim() || !newReminder.date) return;
    updateClient((c) => ({ ...c, reminders: [...c.reminders, { id: Date.now(), ...newReminder, estHours: newReminder.estHours ? Number(newReminder.estHours) : 0, done: false }] }));
    setNewReminder({ text: "", date: "", recurring: "none", assignee: TEAM[0], estHours: "" });
  };
  // Completing a reminder does three things: marks it done (so it shows crossed out),
  // logs a note so it counts as a client touchpoint on the dashboard heatmap, and — if it's
  // a recurring reminder — immediately reopens it at its next due date rather than leaving it
  // permanently ticked off, so the next occurrence isn't lost. For a task that came from the
  // Scheduling tab (id starts with "sched-task-"), completing it is also what triggers the
  // billing sync — these are pre-programmed in advance, so being on the calendar isn't the
  // same as being done; the hours only land in Activity/Billing once it's actually ticked off.
  const toggleReminderDone = (id) => {
    const reminder = client.reminders.find((r) => r.id === id);
    if (reminder && !reminder.done) playCompletionChime();
    updateClient((c) => {
      const reminder = c.reminders.find((r) => r.id === id);
      if (!reminder) return c;
      const completing = !reminder.done;
      let reminders;
      // A workflow-spawned annual task (not one of its own -90d/-60d/-30d staged notification
      // siblings) needs special handling on completion: recomputing just its own date isn't
      // enough, since the 3 staged notifications leading up to it also need to move forward
      // to the new cycle and reset to not-done, or they'd stay stuck pointing at last year's
      // dates. Monthly/quarterly workflow tasks and every other recurring reminder keep the
      // simple single-date reopen below, since staged notifications are only built for yearly.
      const isWorkflowMainTask = String(id).startsWith("workflow-recurring-") && !/-(90|60|30)d$/.test(id);
      if (completing && reminder.recurring === "yearly" && isWorkflowMainTask) {
        const nextDate = addDays(reminder.date, 365);
        const stageDays = [90, 60, 30];
        reminders = c.reminders.map((r) => {
          if (r.id === id) return { ...r, date: nextDate, done: false };
          const staged = stageDays.find((d) => r.id === `${id}-${d}d`);
          if (staged) return { ...r, date: addDays(nextDate, -staged), done: false };
          return r;
        });
      } else if (completing && reminder.recurring !== "none") {
        const intervalDays = { monthly: 30, quarterly: 90, yearly: 365 }[reminder.recurring] || 30;
        const nextDate = addDays(reminder.date, intervalDays);
        reminders = c.reminders.map((r) => (r.id === id ? { ...r, date: nextDate, done: false } : r));
      } else {
        reminders = c.reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r));
      }
      const notes = completing
        ? [...c.notes, { id: Date.now(), author: "You", date: today(), text: `Completed reminder: "${reminder.text}"` }]
        : c.notes;
      let hours = c.hours;
      if (completing && String(id).startsWith("sched-task-") && reminder.estHours) {
        const logId = `sched-hours-${id}`;
        const alreadyLogged = (c.hours?.log || []).some((h) => h.id === logId);
        if (!alreadyLogged) {
          const logEntry = { id: logId, date: today(), member: reminder.assignee, hours: reminder.estHours, description: `Schedule: ${reminder.text}` };
          hours = { ...c.hours, log: [...(c.hours?.log || []), logEntry] };
        }
      }
      return { ...c, reminders, notes, hours };
    });
  };
  const removeReminder = (id) => updateClient((c) => {
    const patch = { reminders: c.reminders.filter((r) => r.id !== id) };
    // Deleting the auto-generated touchpoint check-in specifically means "not now" — without
    // this, the Dashboards reconciliation effect would just recreate it on the very next
    // pass since the underlying "below target" condition is still true.
    if (id === "touchpoint-baseline-" + c.id) patch.touchpointSnoozedUntil = addDays(today(), 30);
    // Same problem for a Scheduling-tab task: as long as the schedule entry that spawned it
    // still exists, the Scheduling tab's own reconciliation would just recreate this exact
    // occurrence again next time it runs. Recording it here is what makes "delete" actually
    // stick — the real way to stop it recurring for good is deleting the schedule entry
    // itself (Scheduling tab), this is just for "skip this one occurrence".
    if (String(id).startsWith("sched-task-")) {
      const logId = `sched-hours-${id}`;
      patch.hours = { ...c.hours, log: (c.hours?.log || []).filter((h) => h.id !== logId) };
      patch.deletedScheduleTaskIds = [...(c.deletedScheduleTaskIds || []), id];
    }
    return { ...c, ...patch };
  });

  const dueIn = daysUntil(client.ohsmsDue);
  const urgency = dueIn < 0 ? { label: "Overdue", color: T.coral } : dueIn <= 30 ? { label: `Due in ${dueIn}d`, color: T.amber } : { label: "On track", color: T.tealDark };

  return (
    <div className="flex h-full gap-6">
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: T.paperAlt }}>
          <Search size={15} color={T.slate} />
          <input placeholder="Search clients" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)}
            className="bg-transparent text-sm outline-none w-full" style={{ color: T.ink }} />
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {visibleClients.map((c) => {
            const d = daysUntil(c.ohsmsDue);
            const dot = d < 0 ? T.coral : d <= 30 ? T.amber : T.tealDark;
            const fromNztg = (c.intake?.hearAboutUs || "").toLowerCase().includes("nztg");
            const fromBmc = (c.intake?.hearAboutUs || "").toLowerCase().includes("bmc");
            const wantsReports = Boolean(c.intake?.wantsMonthlyReports);
            return (
              <button key={c.id} onClick={() => setSelectedId(c.id)} className="text-left p-3 rounded-xl transition-colors"
                style={{ background: c.id === client?.id ? T.paperAlt : T.card, border: `1px solid ${c.id === client?.id ? T.tealDark : T.border}`, opacity: c.archived ? 0.6 : 1 }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: T.ink }}>{c.name}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
                </div>
                <div className="text-xs mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: T.slate }}>
                  {c.contract.plan}
                  {fromNztg && <Pill color={T.blue} bg={T.paperAlt}>NZTG</Pill>}
                  {fromBmc && <Pill color="#8B6BA8" bg={T.paperAlt}>BMC</Pill>}
                  {wantsReports && <Pill color={T.amber} bg={T.paperAlt}>Monthly Reports</Pill>}
                </div>
              </button>
            );
          })}
          {visibleClients.length === 0 && (
            <div className="text-xs text-center py-4" style={{ color: T.slateLight }}>
              {clientSearch.trim() ? `No clients match "${clientSearch.trim()}".` : showArchived ? "No archived clients." : "No clients yet."}
            </div>
          )}
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
              <div className="text-lg font-bold flex items-center gap-2" style={{ color: T.ink }}>
                {client.name}
                {(client.intake?.hearAboutUs || "").toLowerCase().includes("nztg") && <Pill color={T.blue} bg={T.paperAlt}>NZTG</Pill>}
                {(client.intake?.hearAboutUs || "").toLowerCase().includes("bmc") && <Pill color="#8B6BA8" bg={T.paperAlt}>BMC</Pill>}
                {Boolean(client.intake?.wantsMonthlyReports) && <Pill color={T.amber} bg={T.paperAlt}>Monthly Reports</Pill>}
              </div>
              <div className="text-sm" style={{ color: T.slate }}>{client.legalName}</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill color={urgency.color} bg={T.paperAlt}>OHSMS: {urgency.label}</Pill>
              {client.archived ? (
                <button onClick={() => unarchiveClient(client.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Unarchive</button>
              ) : (
                <button onClick={() => archiveClient(client.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>Archive</button>
              )}
              <ConfirmButton onConfirm={() => deleteClientPermanently(client.id)} title="Delete permanently" iconSize={15} />
            </div>
          </div>
          <div className="flex gap-1 mt-5 border-b overflow-x-auto" style={{ borderColor: T.border }}>
            {[
              { id: "overview", label: "Overview", icon: Building2 },
              { id: "contract", label: "Contract", icon: CreditCard },
              { id: "billing", label: "Activity", icon: ClipboardList },
              { id: "onboarding", label: "Workflows", icon: ListChecks },
              { id: "notes", label: "Notes", icon: StickyNote },
              { id: "reminders", label: "Tasks", icon: Bell },
              { id: "scheduling", label: "Scheduling", icon: CalendarClock },
            ].filter((t) => t.id !== "scheduling" || client.profile === "Enterprise Client").map((t) => (
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
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Document control</div>
                <label className="flex items-center gap-2 text-sm mt-1" style={{ color: T.ink }}>
                  <input type="checkbox" checked={Boolean(client.showVersionInFooter)} onChange={(e) => updateClient((c) => ({ ...c, showVersionInFooter: e.target.checked }))} />
                  Show the current document version number in this client's document footers
                </label>
                <div className="text-[11px] mt-1.5" style={{ color: T.slateLight }}>Version numbers themselves are set on the Systems tab's Review Log — this only controls whether they show up on {client.name}'s documents specifically.</div>
              </Card>
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
                      <div>
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>SIGNED TERMS &amp; CONDITIONS</div>
                        <button type="button" onClick={async () => {
                          try {
                            const url = await getDownloadURL(storageRef(storage, client.intake.signedTermsPath));
                            window.open(url, "_blank");
                          } catch (err) {
                            console.error("Couldn't open signed T&Cs:", err);
                            alert("Couldn't open the signed T&Cs PDF — it may not have finished uploading, or the link has expired.");
                          }
                        }} className="text-xs text-left underline" style={{ color: T.tealDark }}>
                          Open signed T&amp;Cs
                        </button>
                      </div>
                    )}
                    {client.intake.questionnairePath && (
                      <div>
                        <div className="text-xs font-semibold mb-1" style={{ color: T.slate }}>SIGN-UP QUESTIONNAIRE</div>
                        <button type="button" onClick={async () => {
                          try {
                            const url = await getDownloadURL(storageRef(storage, client.intake.questionnairePath));
                            window.open(url, "_blank");
                          } catch (err) {
                            console.error("Couldn't open questionnaire:", err);
                            alert("Couldn't open the questionnaire PDF — it may not have finished uploading, or the link has expired.");
                          }
                        }} className="text-xs text-left underline" style={{ color: T.tealDark }}>
                          Open questionnaire
                        </button>
                      </div>
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

              {(onboardings[client.id] || []).some((i) => i.billable) && (
                <Card style={{ padding: 16 }}>
                  <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>Billable workflows</div>
                  <div className="text-[11px] mb-3" style={{ color: T.slateLight }}>Already counted in the hours log below — this is just the rollup across all workflows.</div>
                  <div className="flex flex-col gap-2">
                    {(onboardings[client.id] || []).filter((i) => i.billable).map((i) => (
                      <div key={i.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                        <div style={{ color: T.ink }}>{i.workflowName}{i.completedDate ? " (complete)" : ""}</div>
                        <div className="font-bold" style={{ color: T.tealDark }}>{i.billableHours || 0}h</div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-sm pt-1.5 font-bold">
                      <div style={{ color: T.ink }}>Total</div>
                      <div style={{ color: T.tealDark }}>{(onboardings[client.id] || []).filter((i) => i.billable).reduce((s, i) => s + (i.billableHours || 0), 0)}h</div>
                    </div>
                  </div>
                </Card>
              )}

              <Card style={{ padding: 16 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold" style={{ color: T.ink }}>Monthly hours</div>
                  <select value={viewMonth} onChange={(e) => setViewMonth(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {monthsWithActivity(client.hours.log).map((m) => (
                      <option key={m} value={m}>{m === currentMonth() ? "This month" : monthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2 mb-3">
                  {client.hours.log.filter((h) => h.date.slice(0, 7) === viewMonth).map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
                      <div><span className="font-medium" style={{ color: T.ink }}>{h.member}</span><span className="ml-2" style={{ color: T.slate }}>{h.description}</span></div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span style={{ color: T.slate }}>{fmtDate(h.date)}</span>
                        <span className="font-bold" style={{ color: T.tealDark }}>{h.hours}h</span>
                        <ConfirmButton onConfirm={() => removeHour(h.id)} title="Remove this hours entry" iconSize={13} />
                      </div>
                    </div>
                  ))}
                  {client.hours.log.filter((h) => h.date.slice(0, 7) === viewMonth).length === 0 && (
                    <div className="text-xs" style={{ color: T.slateLight }}>No hours logged {viewMonth === currentMonth() ? "yet this month" : `for ${monthLabel(viewMonth)}`}.</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={newHour.member} onChange={(e) => setNewHour({ ...newHour, member: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="date" value={newHour.date} onChange={(e) => setNewHour({ ...newHour, date: e.target.value })} title="Logging retrospectively? Just pick the actual date it happened."
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <input placeholder="What was the work?" value={newHour.description} onChange={(e) => setNewHour({ ...newHour, description: e.target.value })}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 140 }} />
                  <input placeholder="Hrs" value={newHour.hours} onChange={(e) => setNewHour({ ...newHour, hours: e.target.value })}
                    className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <button onClick={addHour} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log</button>
                </div>
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
                <div className="text-sm font-semibold mb-2" style={{ color: T.ink }}>Files & emails</div>
                <div className="flex flex-col gap-1.5 mb-2">
                  {(client.files || []).map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5" style={{ background: T.paperAlt }}>
                      <button onClick={() => viewClientFile(f.path)} className="truncate text-left flex-1" style={{ color: T.tealDark }} title={f.name}>{f.name}</button>
                      <div className="flex items-center gap-2 shrink-0">
                        <span style={{ color: T.slateLight }}>{fmtDate(f.uploadedAt)}</span>
                        <button onClick={() => removeClientFile(f.id)} title="Remove file"><Trash2 size={12} color={T.slateLight} /></button>
                      </div>
                    </div>
                  ))}
                  {(client.files || []).length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing uploaded yet.</div>}
                </div>
                <label className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer inline-flex items-center gap-1.5" style={{ background: T.paperAlt, color: T.tealDark }}>
                  <Upload size={13} /> {uploadingClientFile ? "Uploading…" : "Upload file or email"}
                  <input type="file" className="hidden" disabled={uploadingClientFile} onChange={(e) => uploadClientFile(e.target.files?.[0])} />
                </label>
                <div className="text-[11px] mt-1.5" style={{ color: T.slateLight }}>Any file type — save an email as a .eml/.msg/PDF first if you're uploading correspondence.</div>
              </Card>
              <Card style={{ padding: 14 }}>
                <button onClick={() => setShowGeneratedDocs((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <div className="flex items-center gap-1.5">
                    <ChevronDown size={13} color={T.slateLight} style={{ transform: showGeneratedDocs ? "none" : "rotate(-90deg)" }} />
                    <span className="text-sm font-semibold" style={{ color: T.ink }}>Generated documents</span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: T.paperAlt, color: T.slate }}>{(client.generatedDocuments || []).length}</span>
                </button>
                {showGeneratedDocs && (
                  <>
                    <div className="text-[11px] mt-2 mb-2" style={{ color: T.slateLight }}>Every Manual, Policy, Procedure, ERP, and Monthly Report generated for {client.name} — a running record of what's actually been produced.</div>
                    <div className="flex flex-col gap-1.5">
                      {[...(client.generatedDocuments || [])].reverse().map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5" style={{ background: T.paperAlt }}>
                          <button onClick={() => viewGeneratedDocument(d.path)} className="truncate text-left flex-1 flex items-center gap-2" style={{ color: T.tealDark }} title={d.name}>
                            <Pill color={T.blue} bg={T.card}>{d.category}</Pill>
                            <span className="truncate">{d.name}</span>
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span style={{ color: T.slateLight }}>{fmtDate(d.date)}</span>
                            <ConfirmButton onConfirm={() => removeGeneratedDocument(d.id)} title="Remove from history" iconSize={12} />
                          </div>
                        </div>
                      ))}
                      {(client.generatedDocuments || []).length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing generated yet — anything downloaded from Systems or Reports will show up here automatically.</div>}
                    </div>
                  </>
                )}
              </Card>
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
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input type="number" min="0" step="0.25" value={r.estHours || ""}
                      onChange={(e) => updateClient((c) => ({ ...c, reminders: c.reminders.map((x) => (x.id === r.id ? { ...x, estHours: e.target.value ? Number(e.target.value) : 0 } : x)) }))}
                      placeholder="hrs" title="Estimated hours — counts toward Schedule workload"
                      className="w-14 text-xs px-1.5 py-1 rounded-lg outline-none text-center" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    <button onClick={() => removeReminder(r.id)}><Trash2 size={14} color={T.slateLight} /></button>
                  </div>
                </Card>
              ))}
              {client.reminders.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>No tasks yet.</div>}
              <Card style={{ padding: 14 }} className="flex items-center gap-2 flex-wrap">
                <input placeholder="Task" value={newReminder.text} onChange={(e) => setNewReminder({ ...newReminder, text: e.target.value })}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 160 }} />
                <input type="date" value={newReminder.date} onChange={(e) => setNewReminder({ ...newReminder, date: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <input type="number" min="0" step="0.25" placeholder="hrs" value={newReminder.estHours} onChange={(e) => setNewReminder({ ...newReminder, estHours: e.target.value })}
                  title="Estimated hours — counts toward Schedule workload"
                  className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <select value={newReminder.assignee} onChange={(e) => setNewReminder({ ...newReminder, assignee: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={newReminder.recurring} onChange={(e) => setNewReminder({ ...newReminder, recurring: e.target.value })}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  <option value="none">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <button onClick={addReminder} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
              </Card>
            </div>
          )}
          {tab === "scheduling" && client.profile === "Enterprise Client" && (
            <ErrorBoundary>
              <ClientScheduling client={client} updateClient={updateClient} toggleReminderDone={toggleReminderDone} />
            </ErrorBoundary>
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
  {
    key: "erp", label: "Emergency Response Plan",
    itemList: ERP_ITEMS,
    alwaysLabels: [...ERP_CONTACT_ITEMS, ...ERP_ALWAYS_TICKED_EMERGENCIES],
    complianceExtraLabels: [],
  },
];

// The sign-up form's `emergencyOptions` (SignupForm.jsx) were written independently of this
// app's ERP tab emergency types, so the labels don't match 1:1. Where a sign-up label maps
// cleanly onto real ERP content, tick that item; "Natural disaster" and "Working at Heights
// rescue" cover more than one ERP item so they map to several. Anything on the sign-up form
// with no ERP equivalent yet (no real reference content exists for it) isn't silently
// dropped — syncFromIntake() below creates it as a new custom ERP item instead, same as
// clicking "Add emergency" by hand, just blank and ready to write.
const SIGNUP_TO_ERP_LABELS = {
  "Fire": ["Fire"],
  "Medical emergency": ["Medical Emergency"],
  "Hazardous substance spill": ["Spill Response"],
  "Plant roll over": ["Plant Roll Over"],
  "Natural disaster": ["Earthquake", "Tsunami", "Cyclone / Severe Storm", "Tornado"],
  "Electrical incident": ["Electric Shock"],
  "Working at Heights rescue": ["Ladder Rescue Plan (Harness Use)", "Elevated Work Platform Rescue (Harness Use)", "Elevated Work Platforms (EWP)"],
  "Lone working": ["Lone Workers"],
  "Service strike": ["Service Strike"],
  "Chainsaw": ["Chainsaw Accident"],
  "Vehicle accident": ["Vehicle Accident"],
  "Confined Space rescue": ["Confined Space Rescue"],
  "Excavation collapse": ["Excavation Collapse"],
  "Violence or aggressive behaviour": ["Violence or Aggressive Behaviour"],
};

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

// Every PDF in this app uses pdf-lib's standard fonts (Helvetica), which only support
// WinAnsi encoding — it throws instead of skipping a character it can't render. Macron
// vowels (ā, ē, ī, ō, ū — common in Māori place names and words) are the most likely thing
// to trip this, since they show up unpredictably in client-supplied data like CSV site
// addresses, but any character outside WinAnsi's range would do the same. Rather than crash
// PDF generation entirely over one character, map the common ones to their plain equivalents
// and drop anything else outside WinAnsi's safe range.
const PDF_MACRON_MAP = { "ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u", "Ā": "A", "Ē": "E", "Ī": "I", "Ō": "O", "Ū": "U" };
function sanitizeForPdf(text) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  const deMacroned = str.replace(/[āēīōūĀĒĪŌŪ]/g, (c) => PDF_MACRON_MAP[c] || c);
  return deMacroned.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}
function sanitizeArrayForPdf(arr) { return (arr || []).map((v) => sanitizeForPdf(v)); }

// Every PDF generator below calls this right after building its bytes — uploads the actual
// PDF to Storage and records it against the client, so there's a real, visible history of
// what's been generated for them (viewable/deletable on their Notes tab), not just whatever
// happened to land in someone's Downloads folder. Never blocks or breaks the download itself
// if it fails — that's the primary thing the person actually asked for, this is secondary.
async function saveGeneratedDocument(client, bytes, filename, category) {
  try {
    const path = `generated-documents/${client.id}/${Date.now()}-${filename}`;
    const blob = new Blob([bytes], { type: "application/pdf" });
    await uploadBytes(storageRef(storage, path), blob);
    const entry = { id: Date.now(), name: filename, category, path, date: today() };
    const snap = await getDoc(doc(db, "clients", client.id));
    const current = snap.exists() ? snap.data().generatedDocuments || [] : [];
    await updateDoc(doc(db, "clients", client.id), { generatedDocuments: [...current, entry] });
  } catch (err) {
    console.error("Couldn't save generated document to history:", err);
  }
}

async function exportReviewLogPdf(entries) {
  entries = (entries || []).map((e) => ({ ...e, type: sanitizeForPdf(e.type), person: sanitizeForPdf(e.person), notes: sanitizeForPdf(e.notes) }));
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
      "Meet applicable health and safety legislative requirements and strive for continual improvement",
      "Provide information, supervision, training and instruction to workers",
      "Continually improve our Health and Safety Management System",
      "Consult, cooperate and coordinate with contractors and other PCBUs to ensure work-related risks are effectively managed",
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
      `Ensure that ${clientName} implements appropriate health and safety processes and verifies those processes are being used and are effective`,
    ] },
    { label: "Supervisors", color: DEEP_GREEN, items: [
      `Support ${clientName} and its Officers in meeting their health and safety responsibilities`,
      "Lead Health and Safety by example",
      "Promote a positive Health and Safety culture",
      "Enable and encourage workers to communicate and participate in Health and Safety",
      "Ensure that processes and procedures are communicated and followed",
      "Ensure workers are competent for the work being undertaken",
      `Ensure that all policies, procedures, and objectives are in place and compatible with ${clientName}'s direction, work practices, goals, and targets`,
      "Support early return to work",
    ] },
    { label: "Workers", color: DEEP_GREEN, items: [
      "Take reasonable care of their own health and safety",
      "Take reasonable care that their acts or omissions do not adversely affect the health and safety of other persons",
      `Comply with any reasonable instruction from ${clientName}`,
      `Cooperate with any reasonable policy or procedure from ${clientName}`,
      "Wear all Personal Protective Equipment provided",
      "Report any incidents, hazards or risks",
      `Participate in Health and Safety within ${clientName}`,
    ] },
  ];
}

function getPolicyIntro(clientName) {
  return `${clientName} is committed to ensuring so far as is reasonably practicable the obligations under the Health and Safety at Work Act 2015, applicable Regulations, Approved Codes of Practice, Guidelines, and other relevant standards are met. ${clientName} will also ensure as far as is reasonably practicable the health, safety and wellness of workers and any other person(s) that may be affected from the risks created by the operations of ${clientName}. ${clientName} is dedicated to providing a work environment where health, safety and wellness is of equal importance to all other business operations and the culture within ${clientName} reflects this by making a commitment to:`;
}

function drawCenteredText(page, text, centerX, y, size, font, color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, size, font, color });
}

// Draws the 4-box Health & Safety Policy grid (PCBU / Officers / Supervisors / Workers).
// Each ROW is sized to its own tallest box (not one global height across all 4), so a
// shorter list doesn't leave a big gap of empty space at the bottom of its box. Returns
// the bottom y.
function drawPolicyGrid({ page, x, y0, maxWidth, font, boldFont, rgb, clientName, availableHeight }) {
  const quadrants = getPolicyQuadrants(clientName);
  const colGap = 10, rowGap = 5;
  const colW = (maxWidth - colGap) / 2;
  const cellPad = 5;

  // Compute the total grid height a given font size would need, without drawing anything -
  // used below to test candidate sizes and find the largest one that actually fits the space
  // available on the page, instead of the grid always rendering at the smallest safe size
  // even when there's plenty of room and it ends up looking tiny with a big empty gap below.
  const BULLET_INDENT = 9;
  const measureAt = (bulletSize, lineHeight, headerH) => {
    const cellContentHeight = (items) => {
      let h = 0;
      items.forEach((item) => {
        h += wrapTextLines(item, font, bulletSize, colW - 2 * cellPad - BULLET_INDENT).length * lineHeight + Math.max(1, lineHeight * 0.12);
      });
      return h;
    };
    const row1H = headerH + Math.max(cellContentHeight(quadrants[0].items), cellContentHeight(quadrants[1].items)) + cellPad * 2;
    const row2H = headerH + Math.max(cellContentHeight(quadrants[2].items), cellContentHeight(quadrants[3].items)) + cellPad * 2;
    return { row1H, row2H, total: row1H + rowGap + row2H };
  };

  // Candidate sizes from most to least comfortable, [bulletSize, lineHeight, headerH]. Picks
  // the first (largest) one whose total height fits within availableHeight, only falling
  // back to smaller sizes for clients whose policy content is genuinely longer.
  const candidates = [
    [10, 12, 20], [9.5, 11, 19], [9, 10.5, 18], [8.5, 10, 17], [8, 9.5, 16], [7.5, 8.5, 16],
  ];
  let chosen = candidates[candidates.length - 1];
  let measured = measureAt(...chosen);
  if (availableHeight) {
    for (const c of candidates) {
      const m = measureAt(...c);
      if (m.total <= availableHeight) { chosen = c; measured = m; break; }
    }
  }
  const [bulletSize, lineHeight, headerH] = chosen;
  const { row1H, row2H } = measured;

  const drawCell = (cx, yTop, item, cellH) => {
    page.drawRectangle({ x: cx, y: yTop - headerH, width: colW, height: headerH, color: rgb(item.color[0], item.color[1], item.color[2]) });
    page.drawText(item.label, { x: cx + cellPad, y: yTop - headerH + headerH / 2 - 3, size: Math.min(9.5, bulletSize + 0.5), font: boldFont, color: rgb(1, 1, 1) });
    let cy = yTop - headerH - cellPad - lineHeight * 0.7;
    item.items.forEach((line) => {
      // Bullet character sits on its own, drawn only once at the un-indented left edge; every
      // wrapped line (including the first) lands at the same indented x, so a bullet that
      // wraps to a second line reads as a clean paragraph continuation instead of looking
      // like the text just restarted flush against the cell's edge.
      wrapTextLines(line, font, bulletSize, colW - 2 * cellPad - BULLET_INDENT).forEach((wl, i) => {
        if (i === 0) page.drawText("•", { x: cx + cellPad, y: cy, size: bulletSize, font, color: rgb(0.2, 0.25, 0.25) });
        page.drawText(wl, { x: cx + cellPad + BULLET_INDENT, y: cy, size: bulletSize, font, color: rgb(0.2, 0.25, 0.25) });
        cy -= lineHeight;
      });
      cy -= Math.max(1, lineHeight * 0.12);
    });
    page.drawRectangle({ x: cx, y: yTop - cellH, width: colW, height: cellH, borderColor: rgb(0.75, 0.8, 0.8), borderWidth: 1 });
  };

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
async function downloadBuildPdf({ client, category, categoryKey, included, documentTemplates, docVersion }) {
  const showVersion = docVersion && client.showVersionInFooter;
  const versionSuffix = showVersion ? ` · ${docVersion}` : "";
  client = { ...client, name: sanitizeForPdf(client.name), legalName: sanitizeForPdf(client.legalName) };
  documentTemplates = Object.fromEntries(Object.entries(documentTemplates || {}).map(([k, v]) => [k, sanitizeForPdf(v)]));
  const { PDFDocument, StandardFonts, rgb } = await importWithReloadOnStaleChunk(() => import("pdf-lib"));
  const isFlowing = categoryKey === "sections";
  const displayName = client.legalName || client.name;  // Manual/Procedures/Policies use the legal name; ERP intentionally still uses the trading name below.
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
    while (nameSize > 18 && boldFont.widthOfTextAtSize(displayName, nameSize) > nameMaxWidth) nameSize -= 1;
    page.drawText(displayName, { x: margin, y: pageHeight - 100, size: nameSize, font: boldFont, color: rgb(1, 1, 1) });

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
    page.drawText(`Prepared for: ${displayName}`, { x: margin, y: coverY, size: 11, font: boldFont, color: ink });
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
      const nw = boldFont.widthOfTextAtSize(displayName, 8);
      pg.drawText(displayName, { x: w - m - nw, y: h - 22, size: 8, font: boldFont, color: slate });
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
        const content = raw.replaceAll("The Company", displayName) || `No template text written yet for "${label}".`;
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
        drawPolicyGrid({ page: landscapePage, x: lMargin, y0: ly, maxWidth: landscapeWidth - lMargin * 2, font, boldFont, rgb, clientName: displayName });
        newPage(); // force fresh portrait page so section 5+ don't land back on the pre-section-4 page
        continue;
      }

      const raw = documentTemplates[templateKey(categoryKey, label)] || "";
      const content = raw.replaceAll("The Company", displayName) || `No template text written yet for "${label}".`;
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
      { date: today(), details: `Manual issued for ${displayName}` },
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
        ? `Prepared for ${displayName}  ·  ${fmtDate(today())}${versionSuffix}`
        : `Prepared for ${displayName}  ·  ${fmtDate(today())}  ·  Page ${p} of ${pageCount - 1}${versionSuffix}`;
      pg.drawText(footerText, { x: margin, y: 24, size: 8, font, color: slate });
    }

    const bytes = await pdfDoc.save();
    const manualFilename = `${safeFilenamePart(displayName)} Health and Safety Manual ${new Date().getFullYear()}.pdf`;
    saveGeneratedDocument(client, bytes, manualFilename, "Manual");
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = manualFilename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (categoryKey === "erp") {
    // Emergency Response Plan: one combined document — page 1 is the cover (centered logo
    // + title, moved up top) with the Emergency Numbers / Site Contacts table directly
    // beneath it on the same page, then every ticked emergency flows continuously after
    // that (like the Manual's sections) — sections stack normally and share a page when
    // they fit, only breaking to a fresh page when a section genuinely doesn't fit where
    // it is, so a heading is never stranded away from its own body.
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoImage = await loadClientLogoImage(client, pdfDoc);

    const centerX = pageWidth / 2;
    const drawCenteredOn = (pg, text, size, f, color, yPos) => {
      const w = f.widthOfTextAtSize(text, size);
      pg.drawText(text, { x: centerX - w / 2, y: yPos, size, font: f, color });
    };

    // --- Page 1: cover header (logo + title, pushed up top) + the contacts table below it ---
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let cy = pageHeight - 70;
    if (logoImage) {
      const bigMaxH = 100, bigMaxW = 220;
      const scale = Math.min(bigMaxH / logoImage.height, bigMaxW / logoImage.width, 1);
      const w = logoImage.width * scale, h = logoImage.height * scale;
      page.drawImage(logoImage, { x: centerX - w / 2, y: cy - h, width: w, height: h });
      cy -= h + 22;
    }
    drawCenteredOn(page, "EMERGENCY RESPONSE PLAN", 21, boldFont, charcoal, cy);
    cy -= 24;
    drawCenteredOn(page, displayName, 13, boldFont, rgb(0.2, 0.28, 0.28), cy);
    cy -= 18;
    const issueDate = today();
    drawCenteredOn(page, `Issued: ${fmtDate(issueDate)}  ·  Review Date: ${fmtDate(addDays(issueDate, 365))}`, 9, font, slate, cy);
    cy -= 20;
    page.drawLine({ start: { x: margin, y: cy }, end: { x: pageWidth - margin, y: cy }, thickness: 0.75, color: rgb(0.85, 0.85, 0.85) });

    // Thin repeating content header for every page after the first.
    const headerHeight = 34, topGap = headerHeight + 20;
    const drawContentHeader = (pg) => {
      pg.drawLine({ start: { x: margin, y: pageHeight - headerHeight + 8 }, end: { x: pageWidth - margin, y: pageHeight - headerHeight + 8 }, thickness: 0.75, color: rgb(0.85, 0.85, 0.85) });
      pg.drawText("EMERGENCY RESPONSE PLAN", { x: margin, y: pageHeight - 22, size: 8, font: boldFont, color: teal });
      const nw = boldFont.widthOfTextAtSize(displayName, 8);
      pg.drawText(displayName, { x: pageWidth - margin - nw, y: pageHeight - 22, size: 8, font: boldFont, color: slate });
    };
    const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); drawContentHeader(page); y = pageHeight - topGap; };

    // Numbers table is now region-specific — national numbers like Police/Fire/Ambulance
    // stay the same everywhere, but regional council pollution lines, hospitals, and Civil
    // Defence contacts vary, so this reads whichever region's template is set on the client
    // (client.erpRegion) rather than one shared list for every client in the country.
    // Company contacts (Emergency Controller etc.) are different: genuinely per-client, so
    // those come straight off the client record (client.erpCompanyContacts) instead of being
    // parsed out of free text. Real fields can't produce the malformed rows a hand-typed
    // "Name, X Number, Y" could.
    const parseRows = (raw) => (raw || "").replaceAll("The Company", displayName).split("\n\n").map((p) => p.trim()).filter(Boolean)
      .map((p) => { const idx = p.indexOf(":"); return idx > 0 ? { label: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() } : null; })
      .filter(Boolean);
    const numberRows = client.erpRegion
      ? parseRows(documentTemplates[templateKey("erp", `Emergency Contact Numbers (${client.erpRegion})`)])
      : [];
    const companyRows = ERP_COMPANY_ROLES.map((role) => {
      const c = (client.erpCompanyContacts || {})[role] || {};
      return { role, name: c.name || "", number: c.number || "" };
    });

    // Cell text now wraps within its own column instead of being drawn as one unbroken line
    // that could run straight off the edge of the page — some regional entries (e.g. "Powerco
    // 0800 27 27 27. Other networks include Electra, Centralines, Scanpower and The Lines
    // Company depending on location.") are far longer than a single line comfortably fits.
    // Row height is computed per row from whichever cell needs the most wrapped lines, rather
    // than a flat height that assumed every cell was short.
    const CELL_PAD = 8, CELL_FONT_SIZE = 9, CELL_LINE_H = 11, CELL_ROW_MIN_H = 22;
    const wrapCells = (cells, widths) => cells.map((c, i) => wrapTextLines(String(c || ""), font, CELL_FONT_SIZE, widths[i] - CELL_PAD * 2));
    const rowHeightFor = (cellLines) => Math.max(CELL_ROW_MIN_H, Math.max(1, ...cellLines.map((lines) => lines.length)) * CELL_LINE_H + 11);

    const numWidths = [200, maxWidth - 200];
    const compWidths = [110, 190, maxWidth - 300];
    const numberRowsWrapped = numberRows.map((r) => wrapCells([r.label, r.value], numWidths));
    const companyRowsWrapped = companyRows.map((r) => wrapCells([r.role, r.name, r.number], compWidths));
    const numberRowHeights = numberRowsWrapped.map(rowHeightFor);
    const companyRowHeights = companyRowsWrapped.map(rowHeightFor);

    // Table sits flush against the bottom margin when it fits below the cover content, same
    // as before — but with regions now adding up to 9 number rows, some spanning multiple
    // wrapped lines, on top of the company contacts table, it can end up taller than the
    // space actually available under the logo/title block. Falling back to a fresh page when
    // that happens keeps it from overlapping the cover content instead of assuming it fits.
    const tableTitleH = 24, tableHeaderH = 20, tableGap = 24;
    const numTableH = tableHeaderH + numberRowHeights.reduce((a, b) => a + b, 0);
    const compTableH = tableHeaderH + companyRowHeights.reduce((a, b) => a + b, 0);
    const tableBlockH = tableTitleH + numTableH + tableGap + compTableH;
    const spaceBelowCover = cy - margin;

    let y;
    if (tableBlockH <= spaceBelowCover) {
      y = margin + tableBlockH;
    } else {
      newPage();
      y = pageHeight - topGap;
    }
    page.drawText("Emergency Numbers & Site Contacts", { x: margin, y, size: 14, font: boldFont, color: teal });
    y -= tableTitleH;

    const drawTableHeader = (cols, widths) => {
      const totalW = widths.reduce((a, b) => a + b, 0);
      page.drawRectangle({ x: margin, y: y - 20, width: totalW, height: 20, color: charcoal });
      let cx = margin;
      cols.forEach((c, i) => { page.drawText(c, { x: cx + CELL_PAD, y: y - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) }); cx += widths[i]; });
      y -= 20;
    };
    const drawTableRow = (cellLines, widths, rowH, shade) => {
      const totalW = widths.reduce((a, b) => a + b, 0);
      if (shade) page.drawRectangle({ x: margin, y: y - rowH, width: totalW, height: rowH, color: rgb(0.96, 0.98, 0.97) });
      let cx = margin;
      cellLines.forEach((lines, i) => {
        let ly = y - CELL_LINE_H + 2;
        lines.forEach((line) => { page.drawText(line, { x: cx + CELL_PAD, y: ly, size: CELL_FONT_SIZE, font, color: ink }); ly -= CELL_LINE_H; });
        cx += widths[i];
      });
      page.drawLine({ start: { x: margin, y: y - rowH }, end: { x: margin + totalW, y: y - rowH }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });
      y -= rowH;
    };

    drawTableHeader(["Service", "Number"], numWidths);
    numberRowsWrapped.forEach((cellLines, i) => drawTableRow(cellLines, numWidths, numberRowHeights[i], i % 2 === 1));

    y -= tableGap;
    drawTableHeader(["Role", "Name", "Number"], compWidths);
    companyRowsWrapped.forEach((cellLines, i) => drawTableRow(cellLines, compWidths, companyRowHeights[i], i % 2 === 1));

    // --- Emergencies flow continuously from here, sections stacking normally ---
    const splitHeading = (text) => {
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0 && colonIdx < 60) return { heading: text.slice(0, colonIdx + 1), body: text.slice(colonIdx + 1).trim() };
      return { heading: null, body: text };
    };
    const BULLET_INDENT = 14, bodySize = 9.5, lineH = 12.5, headingH = 14, paraGap = 6;
    const wrapBodyWithBullets = (body, forWidth) => {
      const result = [];
      body.split("\n").forEach((seg) => {
        if (seg.trim() === "") return;
        const isBullet = seg.trim().startsWith("• ");
        const cleanText = isBullet ? seg.trim().slice(2) : seg;
        const effectiveWidth = isBullet ? forWidth - BULLET_INDENT : forWidth;
        wrapTextLines(cleanText, font, bodySize, effectiveWidth).forEach((line, i) => result.push({ text: line, isBullet, isFirst: i === 0 }));
      });
      return result;
    };
    const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };

    const emergencyLabels = included.filter((label) => !ERP_CONTACT_ITEMS.includes(label));
    const fullPageHeight = pageHeight - topGap - margin;
    emergencyLabels.forEach((label) => {
      const raw = documentTemplates[templateKey("erp", label)] || "";
      const content = raw.replaceAll("The Company", displayName) || `No template text written yet for "${label}".`;
      const paragraphs = content.split("\n\n").map((p) => {
        const { heading, body } = splitHeading(p);
        const bodyLines = wrapBodyWithBullets(body, maxWidth);
        return { heading, bodyLines, height: (heading ? headingH : 0) + bodyLines.length * lineH + paraGap };
      });
      const sectionHeight = 22 + paragraphs.reduce((sum, p) => sum + p.height, 0);

      // Orphan control at the whole-emergency level: if it fits where we are, keep stacking
      // on the current page; if it doesn't but would fit on a fresh page, start a new page
      // so the heading and its content land together rather than split; if it's simply
      // longer than one page (rare), start fresh and let it flow across as many as it needs.
      if (y - sectionHeight < margin && sectionHeight <= fullPageHeight) newPage();
      else ensureSpace(30);

      page.drawText(label, { x: margin, y, size: 13, font: boldFont, color: teal });
      y -= 22;

      paragraphs.forEach(({ heading, bodyLines }) => {
        if (heading) {
          ensureSpace(headingH);
          page.drawText(heading, { x: margin, y, size: 10.5, font: boldFont, color: teal });
          y -= headingH;
        }
        bodyLines.forEach((l) => {
          ensureSpace(lineH);
          if (l.isBullet && l.isFirst) {
            page.drawText("•", { x: margin, y, size: bodySize, font, color: ink });
            page.drawText(l.text, { x: margin + BULLET_INDENT, y, size: bodySize, font, color: ink });
          } else if (l.isBullet) {
            page.drawText(l.text, { x: margin + BULLET_INDENT, y, size: bodySize, font, color: ink });
          } else {
            page.drawText(l.text, { x: margin, y, size: bodySize, font, color: ink });
          }
          y -= lineH;
        });
        y -= paraGap;
      });
    });

    const erpPageCount = pdfDoc.getPageCount();
    for (let p = 0; p < erpPageCount; p++) {
      const pg = pdfDoc.getPage(p);
      pg.drawText(`Prepared for ${displayName}  ·  ${fmtDate(today())}  ·  Page ${p + 1} of ${erpPageCount}${versionSuffix}`, { x: margin, y: 24, size: 8, font, color: slate });
    }

    const bytes = await pdfDoc.save();
    const erpFilename = `${safeFilenamePart(displayName)} Emergency Response Plan.pdf`;
    saveGeneratedDocument(client, bytes, erpFilename, "Emergency Response Plan");
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = erpFilename;
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

      let y = lh - bandHeight - 12;
      const introSize = 9;
      const introLines = wrapTextLines(getPolicyIntro(displayName), font, introSize, lMaxWidth * 0.96);
      introLines.forEach((line) => { drawCenteredText(page, line, lw / 2, y, introSize, font, ink); y -= introSize + 2; });
      y -= 4;

      const signOffAnchorY = margin + 25;
      const availableGridHeight = y - (signOffAnchorY + 24 + 12); // leaves clear space above the sign-off lines
      const bottomY = drawPolicyGrid({ page, x: lMargin, y0: y, maxWidth: lMaxWidth, font, boldFont, rgb, clientName: displayName, availableHeight: availableGridHeight });

      // The sign-off block now anchors to a fixed, generous position near the bottom margin
      // (same approach already used successfully on the other policy sign-off block below)
      // instead of floating directly under wherever the grid happened to end, which could
      // land right on top of the footer if the grid's content ran long for a client with a
      // lot of bullet points. Kept to a single page, so the grid itself is drawn more
      // compactly (see drawPolicyGrid) to reliably leave this much room clear every time.
      let sy = signOffAnchorY;
      const rightColX = lw - lMargin - 200;
      page.drawText("Director Name: _______________________________", { x: lMargin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Date: ${fmtDate(today())}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      sy -= 24;
      page.drawText("Signed: _______________________________", { x: lMargin, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });
      page.drawText(`Review Date: ${fmtDate(addDays(today(), 365))}`, { x: rightColX, y: sy, size: 9, font, color: rgb(0.2, 0.25, 0.25) });

      const policyPageCount = pdfDoc.getPageCount();
      for (let p = 0; p < policyPageCount; p++) {
        const pg = pdfDoc.getPage(p);
        pg.drawText(`Prepared for ${displayName}  ·  ${fmtDate(today())}${versionSuffix}`, { x: margin, y: 24, size: 8, font, color: slate });
      }

      const bytes = await pdfDoc.save();
      const policyFilename = `${safeFilenamePart(displayName)} Health Safety Policy ${new Date().getFullYear()}.pdf`;
      saveGeneratedDocument(client, bytes, policyFilename, "Policy");
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = policyFilename;
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
      const content = raw.replaceAll("The Company", displayName) || `No template text written yet for "${label}".`;
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

      const itemPageCount = pdfDoc.getPageCount();
      for (let p = 0; p < itemPageCount; p++) {
        const pg = pdfDoc.getPage(p);
        pg.drawText(`Prepared for ${displayName}  ·  ${fmtDate(today())}${versionSuffix}`, { x: margin, y: 24, size: 8, font, color: rgb(0.36, 0.45, 0.45) });
      }

      const bytes = await pdfDoc.save();
      const itemFilename = `${safeFilenamePart(displayName)} ${safeFilenamePart(label)} ${new Date().getFullYear()}.pdf`;
      saveGeneratedDocument(client, bytes, itemFilename, categoryKey === "policies" ? "Policy" : "Procedure");
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = itemFilename;
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
      pg.drawText(displayName, { x: margin, y: pageHeight - 75, size: 10, font, color: rgb(0.72, 0.78, 0.78) });
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
      "Contractor Management Procedure": {
        2: [{ file: "contractor-prequalification-arrangements.png", maxHeight: 200 }],
      },
      // Paragraph 3 of this procedure is the "Notifiable Events:" paragraph — the diagram
      // goes right after it, same as every other inline diagram in this map.
      "Incident Reporting & Investigation Procedure": {
        3: [{ file: "incident-corrective-cycle.png", maxHeight: 110 }],
      },
    };
    const drawInlineDiagram = async (filename, maxHeight, preloadedImg) => {
      const img = preloadedImg || (await loadStaticDiagramImage(pdfDoc, filename));
      if (!img) return;
      y -= 8;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      ensureSpace(h + 16);
      page.drawImage(img, { x: margin + (maxWidth - w) / 2, y: y - h, width: w, height: h });
      y -= h + 16;
    };

    const raw = documentTemplates[templateKey(categoryKey, label)] || "";
    const content = raw.replaceAll("The Company", displayName) || `No template text written yet for "${label}".`;
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

    // Within a paragraph's body, a line starting with "• " is rendered as a bullet: narrower
    // wrap width to leave room for the indent, bullet character only on the first wrapped
    // line, and a hanging indent so wrapped continuation lines still line up under the text.
    const BULLET_INDENT = 14;
    const wrapBodyWithBullets = (body, size, forWidth) => {
      const result = [];
      body.split("\n").forEach((seg) => {
        if (seg.trim() === "") return;
        const isBullet = seg.trim().startsWith("• ");
        const cleanText = isBullet ? seg.trim().slice(2) : seg;
        const effectiveWidth = isBullet ? forWidth - BULLET_INDENT : forWidth;
        wrapTextLines(cleanText, font, size, effectiveWidth).forEach((line, i) => {
          result.push({ text: line, isBullet, isFirst: i === 0 });
        });
      });
      return result;
    };

    // Measure the whole document first: if it would comfortably fit on one page at the
    // minimum gap, spread the leftover space evenly between paragraphs (up to a sensible
    // cap) so short procedures fill the page nicely instead of leaving a big empty gap at
    // the bottom. Longer documents that need multiple pages anyway just use the minimum.
    const MIN_GAP = 10, MAX_GAP = 26, SQUEEZE_FLOOR = 3;
    const measured = paragraphs.map((p) => {
      const { heading, body } = splitHeading(p);
      const bodyLines = wrapBodyWithBullets(body, 10, maxWidth);
      return { heading, body, bodyLines, fixedHeight: (heading ? 15 : 0) + bodyLines.length * 13 };
    });

    // Pre-load any inline diagram images so we know their rendered height up front — this lets
    // orphan control treat "heading + its diagram" as one unit that moves to a new page
    // together, instead of leaving the heading stranded above a diagram that got pushed down.
    const preloadedDiagrams = {};
    for (const pIdx of Object.keys(inlineMap)) {
      let totalH = 0;
      const imgs = [];
      for (const d of inlineMap[pIdx]) {
        const img = await loadStaticDiagramImage(pdfDoc, d.file);
        if (img) {
          const scale = Math.min(maxWidth / img.width, d.maxHeight / img.height, 1);
          totalH += img.height * scale + 16 + 8;
          imgs.push({ ...d, img });
        }
      }
      preloadedDiagrams[pIdx] = { totalH, imgs };
    }

    const totalFixedHeight = measured.reduce((sum, m) => sum + m.fixedHeight, 0);
    const fullPageHeight = pageHeight - bandHeight - 30 - margin;
    const hasInlineDiagrams = Object.keys(inlineMap).length > 0;
    let paraGap = MIN_GAP;
    if (!hasInlineDiagrams) {
      if (totalFixedHeight + paragraphs.length * MIN_GAP <= fullPageHeight) {
        // Comfortably fits — stretch gaps to fill the page instead of leaving dead space.
        paraGap = Math.min(MAX_GAP, (fullPageHeight - totalFixedHeight) / paragraphs.length);
      } else {
        // Doesn't fit at the normal minimum — if a modest squeeze would make it fit on one
        // page, use that instead of spilling a couple of lines onto an otherwise-empty 2nd page.
        const squeezeGap = (fullPageHeight - totalFixedHeight) / paragraphs.length;
        if (squeezeGap >= SQUEEZE_FLOOR) paraGap = squeezeGap;
      }
    }

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const { heading, bodyLines } = measured[pIdx];
      const diagramH = preloadedDiagrams[pIdx]?.totalH || 0;
      const paraHeight = measured[pIdx].fixedHeight + paraGap + diagramH;
      // Orphan control: if the whole paragraph (plus any diagram that follows it) doesn't fit
      // but a fresh page would, jump to a fresh page now rather than splitting them apart.
      if (y - paraHeight < margin && paraHeight <= fullPageHeight) newPage();

      if (heading) {
        ensureSpace(15);
        page.drawText(heading, { x: margin, y, size: 10, font: boldFont, color: teal });
        y -= 15;
      }
      bodyLines.forEach((line) => {
        ensureSpace(13);
        if (line.isBullet) {
          if (line.isFirst) page.drawText("•", { x: margin, y, size: 10, font, color: ink });
          page.drawText(line.text, { x: margin + BULLET_INDENT, y, size: 10, font, color: ink });
        } else {
          page.drawText(line.text, { x: margin, y, size: 10, font, color: ink });
        }
        y -= 13;
      });
      y -= paraGap;
      if (preloadedDiagrams[pIdx]) {
        for (const d of preloadedDiagrams[pIdx].imgs) {
          await drawInlineDiagram(d.file, d.maxHeight, d.img);
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

    // Landscape-page appendix for reference images that are themselves wide/landscape shaped
    // (e.g. the hazard symbol charts) — gives them the full width instead of shrinking to fit
    // a portrait page. Each image gets its own landscape page under a shared title.
    const drawLandscapeAppendix = async (title, filenames) => {
      for (const filename of filenames) {
        const lw = pageHeight, lh = pageWidth, lMargin = 40;
        const lPage = pdfDoc.addPage([lw, lh]);
        const lBandHeight = 90;
        lPage.drawRectangle({ x: 0, y: lh - lBandHeight, width: lw, height: lBandHeight, color: charcoal });
        if (logoImage) {
          const maxLogoH = 32, maxLogoW = 100;
          const scale = Math.min(maxLogoH / logoImage.height, maxLogoW / logoImage.width, 1);
          const w = logoImage.width * scale, h = logoImage.height * scale;
          lPage.drawImage(logoImage, { x: lw - lMargin - w, y: lh - lBandHeight / 2 - h / 2, width: w, height: h });
        }
        lPage.drawText(label, { x: lMargin, y: lh - 48, size: 15, font: boldFont, color: rgb(1, 1, 1) });
        lPage.drawText(displayName, { x: lMargin, y: lh - 68, size: 9, font, color: rgb(0.72, 0.78, 0.78) });

        lPage.drawText(`Appendix: ${title}`, { x: lMargin, y: lh - lBandHeight - 24, size: 13, font: boldFont, color: teal });
        let ly = lh - lBandHeight - 48;
        const img = await loadStaticDiagramImage(pdfDoc, filename);
        if (img) {
          const availW = lw - lMargin * 2, availH = ly - margin;
          const scale = Math.min(availW / img.width, availH / img.height, 1);
          const w = img.width * scale, h = img.height * scale;
          lPage.drawImage(img, { x: lMargin + (availW - w) / 2, y: ly - h, width: w, height: h });
        }
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
    if (label === "Hazardous Substances Procedure") {
      await drawLandscapeAppendix("Hazardous Substances Symbols and Meanings", ["hazard-symbols-1.png", "hazard-symbols-2.png"]);
    }

    const pageCount = pdfDoc.getPageCount();
    const monthYear = new Date().toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
    for (let p = 0; p < pageCount; p++) {
      const pg = pdfDoc.getPage(p);
      pg.drawText(`Developed by OSHE for ${displayName}${versionSuffix}`, { x: margin, y: 24, size: 8, font, color: slate });
      const rightText = pageCount > 1 ? `${monthYear}  ·  Page ${p + 1} of ${pageCount}` : monthYear;
      const rightW = font.widthOfTextAtSize(rightText, 8);
      pg.drawText(rightText, { x: pageWidth - margin - rightW, y: 24, size: 8, font, color: slate });
    }

    const bytes = await pdfDoc.save();
    const finalFilename = `${safeFilenamePart(displayName)} ${safeFilenamePart(label)} ${new Date().getFullYear()}.pdf`;
    saveGeneratedDocument(client, bytes, finalFilename, categoryKey === "policies" ? "Policy" : "Procedure");
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = finalFilename;
    a.click();
    URL.revokeObjectURL(url);
    // A small gap between each download — most browsers will block or warn on a burst of
    // simultaneous downloads triggered from one click, so this keeps it reliable.
    if (idx < included.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
}


// The three site-contact roles on the Emergency Response Plan — genuinely per-client (each
// client's own Controller/Warden/First Aider), so these live on the client record itself
// (client.erpCompanyContacts) rather than the shared Templates tab. That's also what fixes
// the table-overflow bug: real Name/Number fields can't produce anything but clean data,
// unlike free text someone has to type in an exact "Name — X Number — Y" format by hand.
const ERP_COMPANY_ROLES = ["Emergency Controller", "Fire Warden", "First Aider"];

function SystemsView({ clients, selectedId, setSelectedId, documentTemplates, saveDocumentTemplate, systemReviewLog, addSystemReviewLogEntry, customErpItems, addCustomErpItem }) {
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [mode, setMode] = useState("build");
  const [categoryKey, setCategoryKey] = useState("sections");
  const category = DOCUMENT_CATEGORIES.find((c) => c.key === categoryKey);
  const [checked, setChecked] = useState(() => defaultChecked(client, category));
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [newLogEntry, setNewLogEntry] = useState({ type: "Review", person: TEAM[0], notes: "", version: "" });
  const [newEmergencyName, setNewEmergencyName] = useState("");
  const [erpContactDraft, setErpContactDraft] = useState({});
  useEffect(() => {
    setErpContactDraft(client.erpCompanyContacts || {});
  }, [client.id]);
  const setErpContactField = (role, field, value) => {
    setErpContactDraft((d) => ({ ...d, [role]: { ...(d[role] || {}), [field]: value } }));
    updateErpContact(role, field, value);
  };
  const addEmergency = () => {
    const name = newEmergencyName.trim();
    if (!name) return;
    addCustomErpItem(name);
    setChecked((c) => ({ ...c, [name]: true }));
    setNewEmergencyName("");
  };
  const syncFromIntake = () => {
    const emergencies = client?.intake?.emergencies || [];
    if (emergencies.length === 0) return;
    const toTick = {};
    emergencies.forEach((label) => {
      if (label === "Other") {
        const customLabel = (client.intake.emergencyOther || "").trim();
        if (!customLabel) return;
        if (!customErpItems.some((i) => i.label === customLabel)) addCustomErpItem(customLabel);
        toTick[customLabel] = true;
        return;
      }
      const mapped = SIGNUP_TO_ERP_LABELS[label];
      if (mapped) {
        mapped.forEach((m) => { toTick[m] = true; });
      } else {
        // No ERP content exists for this one yet (e.g. "Excavation collapse") — create it
        // as a blank custom item rather than dropping it silently.
        if (!customErpItems.some((i) => i.label === label)) addCustomErpItem(label);
        toTick[label] = true;
      }
    });
    setChecked((c) => ({ ...c, ...toTick }));
  };

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

  const items = categoryKey === "erp"
    ? [...categoryItems(category), ...customErpItems.map((i) => i.label)]
    : categoryItems(category);
  const included = items.filter((label) => checked[label]);
  const hasRealAnswers = Boolean(client?.intake?.ohsmsPack);

  const contentFor = (label) => {
    if (label === "Company Emergency Contacts") {
      const contacts = client.erpCompanyContacts || {};
      const lines = ERP_COMPANY_ROLES.map((role) => {
        const c = contacts[role] || {};
        return `${role}: ${c.name || "(not set)"}, ${c.number || "(not set)"}`;
      });
      return lines.join("\n") + "\n\nSet these in the \"Site Contacts\" panel on the left.";
    }
    if (label === "Emergency Contact Numbers") {
      const region = client.erpRegion;
      if (!region) return `No region set for ${client.name} yet. Set it in the "Region" panel on the left, then add that region's numbers on the Templates tab.`;
      const raw = documentTemplates[templateKey(categoryKey, `Emergency Contact Numbers (${region})`)];
      if (!raw) return `No template written yet for the ${region} region's numbers. Add it on the Templates tab.`;
      return raw.replaceAll("The Company", client.name);
    }
    const raw = documentTemplates[templateKey(categoryKey, label)];
    if (!raw) return `No template written yet for "${label}". Add it on the Templates tab.`;
    return raw.replaceAll("The Company", client.name);
  };

  const addLogEntry = () => {
    if (!newLogEntry.notes.trim()) return;
    addSystemReviewLogEntry({ date: today(), type: newLogEntry.type, person: newLogEntry.person, notes: newLogEntry.notes, version: newLogEntry.version.trim() || null });
    setNewLogEntry({ type: "Review", person: TEAM[0], notes: "", version: "" });
  };
  // The current document version is just whatever the most recent log entry with a version
  // set says — no separate place that number lives, so it can never drift from the log.
  const currentDocVersion = [...systemReviewLog].reverse().find((e) => e.version)?.version || null;
  const updateErpContact = (role, field, value) => {
    const current = client.erpCompanyContacts || {};
    const next = { ...current, [role]: { ...(current[role] || {}), [field]: value } };
    updateDoc(doc(db, "clients", client.id), { erpCompanyContacts: next });
  };

  const [newReissueMonth, setNewReissueMonth] = useState("");
  const addReissueEntry = () => {
    if (!newReissueMonth) return;
    const entry = { id: Date.now(), monthYear: newReissueMonth };
    updateDoc(doc(db, "clients", client.id), { reissueLog: [...(client.reissueLog || []), entry] });
    setNewReissueMonth("");
  };

  if (!client) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: T.slate }}>No clients yet — add one on the Clients tab first.</div>;
  }

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
            {categoryKey === "erp" && (
              <Card style={{ padding: 16 }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Region</div>
                <select value={client.erpRegion || ""} onChange={(e) => updateDoc(doc(db, "clients", client.id), { erpRegion: e.target.value })}
                  className="w-full text-sm px-2.5 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                  <option value="">Select region...</option>
                  {NZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <div className="text-[11px] mt-2" style={{ color: T.slateLight }}>Sets which regional Emergency Contact Numbers page is used for {client.name}. Edit each region's numbers on the Templates tab.</div>
              </Card>
            )}
            {categoryKey === "erp" && (
              <Card style={{ padding: 16 }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: T.slate }}>Site Contacts</div>
                <div className="flex flex-col gap-3">
                  {ERP_COMPANY_ROLES.map((role) => (
                    <div key={role}>
                      <div className="text-xs font-semibold mb-1" style={{ color: T.ink }}>{role}</div>
                      <input placeholder="Name" value={erpContactDraft[role]?.name || ""} onChange={(e) => setErpContactField(role, "name", e.target.value)}
                        className="w-full text-xs px-2 py-1.5 rounded-lg outline-none mb-1" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                      <input placeholder="Number" value={erpContactDraft[role]?.number || ""} onChange={(e) => setErpContactField(role, "number", e.target.value)}
                        className="w-full text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    </div>
                  ))}
                </div>
                <div className="text-[11px] mt-2" style={{ color: T.slateLight }}>Specific to {client.name}, not shared with other clients.</div>
              </Card>
            )}
          </div>

          <div className="w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>{category.label} {included.length}/{items.length} selected</div>
            {categoryKey === "erp" && (
              <div className="flex items-center gap-1.5 mb-1">
                <input value={newEmergencyName} onChange={(e) => setNewEmergencyName(e.target.value)} placeholder="New emergency type…"
                  onKeyDown={(e) => e.key === "Enter" && addEmergency()}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <button onClick={addEmergency} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0 flex items-center gap-1" style={{ background: T.tealDark, color: "#fff" }}>
                  <Plus size={12} /> Add
                </button>
              </div>
            )}
            {categoryKey === "erp" && Array.isArray(client?.intake?.emergencies) && client.intake.emergencies.length > 0 && (
              <button onClick={syncFromIntake} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg mb-1 flex items-center justify-center gap-1.5"
                style={{ background: T.paperAlt, color: T.tealDark }} title="Tick the emergencies this client selected on their sign-up form">
                <Repeat size={12} /> Sync from sign-up form ({client.intake.emergencies.length})
              </button>
            )}
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
                    await downloadBuildPdf({ client, category, categoryKey, included, documentTemplates, docVersion: currentDocVersion });
                    if (categoryKey === "sections") {
                      // Downloading the Manual is the actual moment it's issued to the
                      // client — that's what should set the date of issue, not a default
                      // picked when the client record was first created.
                      const issueDate = today();
                      const dueDate = addDays(issueDate, 365);
                      await updateDoc(doc(db, "clients", client.id), {
                        ohsmsLastIssued: issueDate, ohsmsDue: dueDate,
                        reminders: upsertOhsmsReminder(client.reminders, dueDate),
                      });
                    }
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
                {downloading ? "Generating…" : (categoryKey === "sections" || categoryKey === "erp") ? "Download as PDF" : "Download as individual PDFs"}
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
            {categoryKey === "erp" && (
              <Card style={{ padding: 16 }}>
                <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>Emergency Contact Numbers, by region</div>
                <div className="text-[11px] mb-3" style={{ color: T.slateLight }}>National numbers (Police/Fire/Ambulance, WorkSafe, Poison Centre) can go in every region's box, but this is also where regional council pollution lines, hospitals, and other numbers that differ by area get set. Each client uses whichever region is picked for them on the Build tab.</div>
                <div className="flex flex-col gap-3">
                  {NZ_REGIONS.map((region) => {
                    const key = templateKey("erp", `Emergency Contact Numbers (${region})`);
                    return (
                      <div key={region}>
                        <div className="text-xs font-semibold mb-1" style={{ color: T.tealDark }}>{region}</div>
                        <textarea
                          defaultValue={documentTemplates[key] || ""}
                          onBlur={(e) => saveDocumentTemplate(key, e.target.value)}
                          placeholder={"Police / Ambulance / Fire: 111\n\nHospital: 07 579 8000\n\nWorkSafe: 0800 030 040"}
                          rows={3}
                          className="w-full text-xs px-3 py-2 rounded-lg outline-none resize-y"
                          style={{ border: `1px solid ${T.border}`, color: T.ink }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] mt-2" style={{ color: T.slateLight }}>Saves automatically when you click away from each box. Same "Label: value" format, one per blank line, as everything else here.</div>
              </Card>
            )}
            {categoryItems(category).filter((label) => label !== "Emergency Contact Numbers").map((label) => {
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
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold" style={{ color: T.ink }}>System Review Log</div>
                {currentDocVersion && <Pill color={T.tealDark} bg={T.paperAlt}>Current: {currentDocVersion}</Pill>}
              </div>
              <button onClick={() => exportReviewLogPdf(systemReviewLog)} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                Download log as PDF
              </button>
            </div>
            <div className="text-xs mb-3" style={{ color: T.slateLight }}>
              Shared across every client — when the templates or system itself change, that's one entry here, not something logged per client. Whether the version number shows up in a client's document footer is set per client, on their Overview tab.
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
              <input placeholder="Version (e.g. v1.4) — optional" value={newLogEntry.version} onChange={(e) => setNewLogEntry({ ...newLogEntry, version: e.target.value })}
                className="w-40 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              <input placeholder="What was reviewed or changed?" value={newLogEntry.notes} onChange={(e) => setNewLogEntry({ ...newLogEntry, notes: e.target.value })}
                className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 200 }} />
              <button onClick={addLogEntry} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Log entry</button>
            </Card>
            <div className="flex flex-col gap-2 mt-2">
              {[...systemReviewLog].reverse().map((entry) => (
                <Card key={entry.id} style={{ padding: 14 }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pill color={entry.type === "Update" ? T.amber : T.tealDark} bg={T.paperAlt}>{entry.type}</Pill>
                      {entry.version && <Pill color={T.blue} bg={T.paperAlt}>{entry.version}</Pill>}
                    </div>
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
  const [showArchived, setShowArchived] = useState(false);
  const [showSummary, setShowSummary] = useState(true);

  const setStage = (id, stage) => updateDoc(doc(db, "leads", id), { stage });
  const archiveLead = (id) => updateDoc(doc(db, "leads", id), { archived: true });
  const unarchiveLead = (id) => updateDoc(doc(db, "leads", id), { archived: false });
  const deleteLead = (id) => {
    deleteDoc(doc(db, "leads", id));
    setDoc(doc(db, "meta", "deletedImports"), { leadIds: arrayUnion(id) }, { merge: true }).catch((err) => console.error("Couldn't record deletion tombstone:", err));
  };
  const [uploadingFile, setUploadingFile] = useState({});
  const uploadLeadFile = async (lead, file) => {
    if (!file) return;
    setUploadingFile((u) => ({ ...u, [lead.id]: true }));
    try {
      const path = `leads/${lead.id}/${Date.now()}-${file.name}`;
      await uploadBytes(storageRef(storage, path), file);
      const entry = { id: Date.now(), path, name: file.name, uploadedAt: today() };
      await updateDoc(doc(db, "leads", lead.id), { files: [...(lead.files || []), entry] });
    } catch (err) {
      console.error("Lead file upload failed:", err);
      alert(`Couldn't upload that file: ${err.message || err}`);
    } finally {
      setUploadingFile((u) => ({ ...u, [lead.id]: false }));
    }
  };
  const viewLeadFile = async (path) => {
    try {
      const url = await getDownloadURL(storageRef(storage, path));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Couldn't open file:", err);
      alert("Couldn't open that file.");
    }
  };
  const removeLeadFile = (lead, fileId) => {
    updateDoc(doc(db, "leads", lead.id), { files: (lead.files || []).filter((f) => f.id !== fileId) });
  };

  // Writes to a "mail" collection — a Cloud Function (sendQueuedEmail, in functions/index.js)
  // watches this collection and sends through Resend, then writes a status ("sent" or
  // "error") back onto the same document. If sending isn't working, that document's status
  // field is the fastest way to see why — not something visible from here in the app.
  // Once the "Sign-up link" template is created in Resend, paste its Template ID here —
  // switches sendForm over to using it (with the same personalisation) instead of the raw
  // HTML below. Leave as null and nothing changes from how it works right now.
  const SIGNUP_EMAIL_TEMPLATE_ID = null;
  const sendForm = async (lead) => {
    const email = emailDrafts[lead.id];
    if (!email) return;
    const link = `https://signup.oshe.co.nz/${lead.id}`;
    try {
      await setDoc(doc(collection(db, "mail")), {
        to: [email],
        ...(SIGNUP_EMAIL_TEMPLATE_ID
          ? { template: { id: SIGNUP_EMAIL_TEMPLATE_ID, variables: { COMPANY: lead.company, CONTACT_NAME: lead.contact || "there", SIGNUP_LINK: link } } }
          : {
              message: {
                subject: `${lead.company} — complete your OSHE sign-up`,
                html: `<p>Hi ${lead.contact || "there"},</p><p>Thanks for choosing OSHE. Please complete your sign-up using the link below:</p><p><a href="${link}">${link}</a></p><p>If you have any questions, just reply to this email.</p>`,
              },
            }),
      });
      updateDoc(doc(db, "leads", lead.id), { formEmail: email, formStatus: "sent" });
    } catch (err) {
      console.error("Couldn't queue sign-up email:", err);
      alert(`Couldn't send the email: ${err.message || err}. You can still copy the link below and send it manually.`);
      updateDoc(doc(db, "leads", lead.id), { formEmail: email, formStatus: "sent" });
    }
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

  const getDraft = (leadId) => noteDrafts[leadId] || { type: "Note", text: "", dueDate: "", assignee: TEAM[0] };
  const setDraftField = (leadId, field, value) => setNoteDrafts((d) => ({ ...d, [leadId]: { ...getDraft(leadId), [field]: value } }));

  // Notes/reminders/touchpoints logged against a lead aren't just sales-stage scratch —
  // they're the start of this client's history, so they need a real type on them (not just
  // free text) so convertLeadToClient can file each one into the right place on the client
  // record (reminders vs notes) once the lead signs up, instead of the history evaporating.
  const addNote = (leadId) => {
    const draft = getDraft(leadId);
    if (!draft.text || !draft.text.trim()) return;
    if (draft.type === "Reminder" && !draft.dueDate) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const entry = { id: Date.now(), type: draft.type, text: draft.text.trim(), date: today() };
    if (draft.type === "Reminder") { entry.dueDate = draft.dueDate; entry.assignee = draft.assignee; }
    updateDoc(doc(db, "leads", leadId), { notes: [...lead.notes, entry] });
    setNoteDrafts((d) => ({ ...d, [leadId]: { type: "Note", text: "", dueDate: "", assignee: draft.assignee } }));
  };
  const noteTypeMeta = {
    Note: { icon: StickyNote, color: T.slate, bg: T.paperAlt },
    Reminder: { icon: Bell, color: T.amber, bg: "#FBF1E3" },
    Touchpoint: { icon: MessageCircle, color: T.tealDark, bg: "#E4F8F5" },
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddLead((v) => !v)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: T.charcoal, color: T.teal }}>
            <Plus size={16} /> Add lead
          </button>
          <button onClick={() => setShowArchived((v) => !v)} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>
            {showArchived ? "Show active pipeline" : `Show archived (${leads.filter((l) => l.archived).length})`}
          </button>
        </div>
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

      <Card style={{ padding: "12px 16px" }}>
        <button onClick={() => setShowSummary((v) => !v)} className="w-full flex items-center justify-between text-left">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>
            Pipeline summary, active leads ({leads.filter((l) => !l.archived).length})
          </span>
          <ChevronDown size={14} color={T.slateLight} style={{ transform: showSummary ? "rotate(180deg)" : "none" }} />
        </button>
        {showSummary && (
          <div className="flex flex-col gap-1 mt-3">
            {[...leads.filter((l) => !l.archived)]
              .sort((a, b) => (a.followUpDate || "9999").localeCompare(b.followUpDate || "9999"))
              .map((l) => {
                const latestNote = [...(l.notes || [])].reverse().find((n) => n.type === "Note" || n.type === "Touchpoint");
                return (
                  <div key={l.id} className="grid items-center text-xs py-1.5" style={{ gridTemplateColumns: "1.6fr 1fr 1.4fr 1fr", borderBottom: `1px solid ${T.border}` }}>
                    <span className="font-medium truncate" style={{ color: T.ink }}>{l.company}</span>
                    <Pill color={stageMeta[l.stage]?.color || T.slateLight} bg={T.paperAlt}>{l.stage}</Pill>
                    <span className="truncate" style={{ color: T.slate }}>{latestNote ? latestNote.text : "Nothing logged yet"}</span>
                    {l.followUpDate ? (
                      <span className="flex items-center gap-1 justify-end" style={{ color: urgencyColor(l.followUpDate) }}>
                        <Calendar size={10} /> {fmtDate(l.followUpDate)}{l.followUpAssignee ? ` (${l.followUpAssignee})` : ""}
                      </span>
                    ) : (
                      <span className="text-right" style={{ color: T.slateLight }}>No follow-up set</span>
                    )}
                  </div>
                );
              })}
            {leads.filter((l) => !l.archived).length === 0 && <div className="text-xs text-center py-3" style={{ color: T.slateLight }}>Nothing in the pipeline right now.</div>}
          </div>
        )}
      </Card>

      <div className="flex flex-1 gap-4 overflow-x-auto min-h-0">
        {stageOrder.map((stage) => {
          const items = leads.filter((l) => l.stage === stage && Boolean(l.archived) === showArchived);
          const meta = stageMeta[stage];
          if (items.length === 0) {
            return (
              <div key={stage} className="w-11 shrink-0 flex flex-col items-center gap-2 rounded-lg py-3" style={{ background: meta.bg }}>
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ color: meta.color, background: T.card }}>0</span>
                <span className="text-xs font-semibold whitespace-nowrap" style={{ color: meta.color, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{stage}</span>
              </div>
            );
          }
          return (
            <div key={stage} className="w-72 shrink-0 flex flex-col gap-3">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: meta.bg }}>
                <div className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color }} /><span className="text-sm font-semibold" style={{ color: meta.color }}>{stage}</span></div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: meta.color, background: T.card }}>{items.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto">
                {items.map((l) => (
                  <Card key={l.id} style={{ padding: 12, borderTop: `4px solid ${meta.color}`, borderTopLeftRadius: 10, borderTopRightRadius: 10, boxShadow: "0 1px 3px rgba(21,36,35,0.06)" }}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold" style={{ color: T.ink }}>{l.company}</div>
                      <div className="flex items-center gap-1.5">
                        <select value={l.stage} onChange={(e) => setStage(l.id, e.target.value)}
                          className="text-[11px] px-1.5 py-1 rounded-md outline-none" style={{ border: `1px solid ${T.border}`, color: T.slate, background: T.paperAlt }}>
                          {stageOrder.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {l.archived ? (
                          <button onClick={() => unarchiveLead(l.id)} title="Unarchive lead"><Archive size={13} color={T.tealDark} /></button>
                        ) : (
                          <button onClick={() => archiveLead(l.id)} title="Archive lead"><Archive size={13} color={T.slateLight} /></button>
                        )}
                        <ConfirmButton onConfirm={() => deleteLead(l.id)} title="Delete lead" iconSize={13} />
                      </div>
                    </div>
                    <input value={l.contact || ""} onChange={(e) => updateDoc(doc(db, "leads", l.id), { contact: e.target.value })} placeholder="Contact name"
                      className="text-xs mt-0.5 w-full outline-none bg-transparent" style={{ color: T.slate }} />
                    <input value={l.formEmail || ""} onChange={(e) => updateDoc(doc(db, "leads", l.id), { formEmail: e.target.value })} placeholder="Email"
                      className="text-xs w-full outline-none bg-transparent" style={{ color: T.slate }} />
                    <div className="text-xs font-bold mt-1.5" style={{ color: T.tealDark }}>{l.value}</div>

                    <div className="flex items-center gap-1.5 mt-2 pt-2" style={{ borderTop: `1px solid ${T.border}` }}>
                      <ArrowUpRight size={11} color={T.slateLight} className="shrink-0" />
                      <input type="date" value={l.followUpDate || ""} onChange={(e) => updateDoc(doc(db, "leads", l.id), { followUpDate: e.target.value })}
                        title="Follow-up date, shows up in that person's My Tasks and the Follow Up tab"
                        className="text-[11px] px-1.5 py-1 rounded-md outline-none flex-1" style={{ border: `1px solid ${T.border}`, color: l.followUpDate ? urgencyColor(l.followUpDate) : T.slateLight }} />
                      <select value={l.followUpAssignee || ""} onChange={(e) => updateDoc(doc(db, "leads", l.id), { followUpAssignee: e.target.value })}
                        className="text-[11px] px-1.5 py-1 rounded-md outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                        <option value="">Who?</option>
                        {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>

                    {stage === "Won" && l.formStatus === "none" && (
                      <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${T.border}` }}>
                        <input placeholder="Client email for sign-up form" value={emailDrafts[l.id] ?? l.formEmail ?? ""} onChange={(e) => setEmailDrafts({ ...emailDrafts, [l.id]: e.target.value })}
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
                        <div className="text-[11px]" style={{ color: T.slateLight }}>Sends via Resend once queued — copy the link below as a backup either way, in case anything's still being set up on that end.</div>
                        <button onClick={() => convertLeadToClient(l)} className="flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>
                          <ArrowUpRight size={12} /> Simulate form completed
                        </button>
                      </div>
                    )}

                    <button onClick={() => setExpandedNotes({ ...expandedNotes, [l.id]: !expandedNotes[l.id] })}
                      className="flex items-center gap-1.5 text-[11px] font-semibold mt-3 pt-2" style={{ color: T.slate, borderTop: `1px solid ${T.border}` }}>
                      <StickyNote size={12} /> {l.notes.length > 0 ? `${l.notes.length} entr${l.notes.length > 1 ? "ies" : "y"}` : "Add note, reminder, or touchpoint"}
                    </button>
                    {expandedNotes[l.id] && (
                      <div className="flex flex-col gap-1.5 mt-2">
                        {l.notes.map((n) => {
                          const tm = noteTypeMeta[n.type] || noteTypeMeta.Note;
                          const TypeIcon = tm.icon;
                          return (
                            <div key={n.id} className="text-xs rounded-lg p-2" style={{ background: tm.bg, color: T.ink }}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <TypeIcon size={11} color={tm.color} />
                                <span className="font-semibold" style={{ color: tm.color }}>{n.type || "Note"}</span>
                              </div>
                              {n.text}
                              <div className="text-[10px] mt-0.5" style={{ color: T.slateLight }}>
                                {n.type === "Reminder" ? `Due ${fmtDate(n.dueDate)} — ${n.assignee}` : fmtDate(n.date)}
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex flex-col gap-1.5 mt-1">
                          <div className="flex items-center gap-1.5">
                            <select value={getDraft(l.id).type} onChange={(e) => setDraftField(l.id, "type", e.target.value)}
                              className="text-[11px] px-1.5 py-1.5 rounded-lg outline-none shrink-0" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                              <option value="Note">Note</option>
                              <option value="Reminder">Reminder</option>
                              <option value="Touchpoint">Touchpoint log</option>
                            </select>
                            <input placeholder={getDraft(l.id).type === "Reminder" ? "Reminder text..." : getDraft(l.id).type === "Touchpoint" ? "What happened..." : "Note..."}
                              value={getDraft(l.id).text} onChange={(e) => setDraftField(l.id, "text", e.target.value)}
                              className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                          </div>
                          {getDraft(l.id).type === "Reminder" && (
                            <div className="flex items-center gap-1.5">
                              <input type="date" value={getDraft(l.id).dueDate} onChange={(e) => setDraftField(l.id, "dueDate", e.target.value)}
                                className="text-[11px] px-1.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                              <select value={getDraft(l.id).assignee} onChange={(e) => setDraftField(l.id, "assignee", e.target.value)}
                                className="text-[11px] px-1.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                                {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          )}
                          <button onClick={() => addNote(l.id)} className="text-[11px] font-semibold px-2 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
                        </div>

                        <div className="flex flex-col gap-1.5 mt-2 pt-2" style={{ borderTop: `1px solid ${T.border}` }}>
                          <div className="text-[11px] font-semibold" style={{ color: T.slate }}>Files & photos</div>
                          {(l.files || []).map((f) => (
                            <div key={f.id} className="flex items-center justify-between text-xs rounded-lg px-2 py-1.5" style={{ background: T.paperAlt }}>
                              <button onClick={() => viewLeadFile(f.path)} className="truncate text-left flex-1" style={{ color: T.tealDark }} title={f.name}>{f.name}</button>
                              <div className="flex items-center gap-2 shrink-0">
                                <span style={{ color: T.slateLight }}>{fmtDate(f.uploadedAt)}</span>
                                <button onClick={() => removeLeadFile(l, f.id)} title="Remove file"><Trash2 size={11} color={T.slateLight} /></button>
                              </div>
                            </div>
                          ))}
                          <label className="text-[11px] font-semibold px-2 py-1.5 rounded-lg cursor-pointer flex items-center justify-center gap-1.5" style={{ background: T.paperAlt, color: T.tealDark }}>
                            <Upload size={11} /> {uploadingFile[l.id] ? "Uploading…" : "Attach file or photo"}
                            <input type="file" className="hidden" disabled={uploadingFile[l.id]} onChange={(e) => uploadLeadFile(l, e.target.files?.[0])} />
                          </label>
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
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
  const [resellerMonth, setResellerMonth] = useState(currentMonth());
  const [downloadingResellerPdf, setDownloadingResellerPdf] = useState(false);
  // Local draft, synced from the reseller record only when the selected reseller changes —
  // typing updates this immediately so it feels responsive, while the Firestore write
  // happens in the background. Binding the input's value straight to the prop (as it was
  // before) meant the displayed text only updated once the write round-tripped back through
  // onSnapshot, which is exactly what made it feel like keystrokes weren't registering.
  const [contactDraft, setContactDraft] = useState({ email: "", phone: "", emailToClone: "" });
  useEffect(() => {
    setContactDraft({ email: reseller.contactEmail || "", phone: reseller.contactPhone || "", emailToClone: reseller.emailToClone || "" });
  }, [reseller.id]);
  const setContactField = (field, value) => {
    setContactDraft((d) => ({ ...d, [field]: value }));
    const dbField = field === "email" ? "contactEmail" : field === "phone" ? "contactPhone" : "emailToClone";
    updateReseller((r) => ({ ...r, [dbField]: value }));
  };

  const updateReseller = (fn) => {
    const updated = fn(reseller);
    const { id, ...fields } = updated;
    updateDoc(doc(db, "resellers", reseller.id), fields);
  };
  const latestUsers = (c) => c.users.log[c.users.log.length - 1]?.count ?? 0;
  const totalUsers = reseller.clients.reduce((s, c) => s + latestUsers(c), 0);
  const resellerMonthsAvailable = (() => {
    const set = new Set();
    reseller.clients.forEach((c) => (c.users.log || []).forEach((u) => set.add(u.month)));
    set.add(currentMonth());
    return [...set].sort().reverse();
  })();
  const usersForMonth = (c, monthYear) => {
    const entry = [...(c.users.log || [])].reverse().find((u) => u.month === monthYear);
    return entry ? entry.count : 0;
  };
  const downloadResellerUsagePdf = async () => {
    setDownloadingResellerPdf(true);
    try {
      await downloadResellerPdf({ reseller, monthYear: resellerMonth, usersForMonth });
    } catch (err) {
      console.error("Reseller PDF generation failed:", err);
      alert(`Couldn't generate the PDF: ${err.message || err}`);
    } finally {
      setDownloadingResellerPdf(false);
    }
  };

  const archiveReseller = (id) => updateDoc(doc(db, "resellers", id), { archived: true });
  const unarchiveReseller = (id) => updateDoc(doc(db, "resellers", id), { archived: false });
  const deleteResellerPermanently = async (id) => {
    try {
      await deleteDoc(doc(db, "resellers", id));
      if (id === reseller.id) {
        const next = resellers.find((r) => r.id !== id);
        if (next) setSelectedId(next.id);
      }
    } catch (err) {
      console.error("Reseller delete failed:", err);
      alert(`Couldn't delete this reseller: ${err.message || err}`);
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
              <select value={resellerMonth} onChange={(e) => setResellerMonth(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                {resellerMonthsAvailable.map((m) => <option key={m} value={m}>{m === currentMonth() ? "This month" : monthLabel(m)}</option>)}
              </select>
              <button onClick={downloadResellerUsagePdf} disabled={downloadingResellerPdf}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: T.paperAlt, color: T.tealDark, opacity: downloadingResellerPdf ? 0.6 : 1 }}>
                <ClipboardList size={12} /> {downloadingResellerPdf ? "Generating…" : "Download as PDF"}
              </button>
              {reseller.archived ? (
                <button onClick={() => unarchiveReseller(reseller.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.tealDark }}>Unarchive</button>
              ) : (
                <button onClick={() => archiveReseller(reseller.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>Archive</button>
              )}
              <ConfirmButton onConfirm={() => deleteResellerPermanently(reseller.id)} title="Delete permanently" iconSize={15} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Contact email</div>
              <input value={contactDraft.email} onChange={(e) => setContactField("email", e.target.value)} placeholder="Add contact email"
                className="text-sm w-full outline-none rounded-lg px-2 py-1.5" style={{ color: T.ink, border: `1px solid ${T.border}` }} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Contact phone</div>
              <input value={contactDraft.phone} onChange={(e) => setContactField("phone", e.target.value)} placeholder="Add contact phone"
                className="text-sm w-full outline-none rounded-lg px-2 py-1.5" style={{ color: T.ink, border: `1px solid ${T.border}` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: T.slate }}>Email to clone</div>
              <input value={contactDraft.emailToClone} onChange={(e) => setContactField("emailToClone", e.target.value)} placeholder="Add email"
                className="text-sm w-full outline-none rounded-lg px-2 py-1.5" style={{ color: T.ink, border: `1px solid ${T.border}` }} />
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
/* ---------- Hours (billable-work tracking, weekly + monthly) ----------
   Pulls billable hours from the same two places the Activity tab and Billing already read
   from — client.hours.log (which already includes billable workflow hours, since those get
   written straight into the log when a workflow's marked billable) and client.extras. Both
   get merged into one list of dated entries per client, then bucketed by day (weekly view)
   or summed for the month (monthly view). Visible to everyone — unlike Billing, which is
   Sophie/Vanessa only — since this is the "how are we tracking" view Jo and Judith need. */
function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
}
function getBillableEntries(client) {
  const hoursEntries = (client.hours?.log || []).map((h) => ({ date: h.date, hours: h.hours }));
  const extrasEntries = (client.extras || []).map((e) => ({ date: e.date, hours: e.hours }));
  return [...hoursEntries, ...extrasEntries];
}
function weeklyTargetFor(client) {
  return client.hours?.included > 0 ? Math.round((client.hours.included / 4.345) * 10) / 10 : null;
}

function HoursView({ clients }) {
  const [view, setView] = useState("weekly");
  const [groupBy, setGroupBy] = useState("client");
  const [weekStart, setWeekStart] = useState(startOfWeek(today()));
  const [monthYear, setMonthYear] = useState(currentMonth());
  const [expandedHoursPerson, setExpandedHoursPerson] = useState({});
  const toggleHoursPersonExpand = (person) => setExpandedHoursPerson((prev) => ({ ...prev, [person]: !prev[person] }));
  const [expandedHoursClient, setExpandedHoursClient] = useState({});
  const toggleHoursClientExpand = (key) => setExpandedHoursClient((prev) => ({ ...prev, [key]: !prev[key] }));

  // Hourly/Subscription+Hours clients are tracked regardless (that's their whole billing
  // model) — flat-fee clients don't normally need tracking here, but if hours genuinely got
  // logged against one (an ad-hoc job, a one-off), that shouldn't just be invisible on this
  // tab. included stays 0 for these, so they show up with no target rather than a false one.
  const trackedClients = clients.filter((c) => !c.archived && ((c.billingType || "FlatFee") !== "FlatFee" || (c.hours?.log || []).length > 0));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayHeaderLabel = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short" });

  // Every hours.log entry across every tracked client, in one flat list — used for the
  // "by person" breakdown, which doesn't care which client the hours were against.
  const allEntries = trackedClients.flatMap((c) => (c.hours?.log || []).map((h) => ({ ...h, clientName: c.name })));

  const monthsAvailable = (() => {
    const set = new Set();
    trackedClients.forEach((c) => (c.hours?.log || []).forEach((h) => set.add(h.date.slice(0, 7))));
    set.add(currentMonth());
    return [...set].sort().reverse();
  })();

  // Shared by both the weekly and monthly "By person" views — a person's entries for
  // whatever window is active, grouped by client with a total each, and each client
  // further expandable to the actual individual entries (date, description, hours) rather
  // than just a lump sum.
  const PersonBreakdown = ({ person, entries }) => {
    const byClient = {};
    entries.forEach((e) => { (byClient[e.clientName] = byClient[e.clientName] || []).push(e); });
    const clientRows = Object.entries(byClient)
      .map(([name, list]) => ({ name, list, total: Math.round(list.reduce((s, e) => s + e.hours, 0) * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
    return (
      <div className="px-4 pb-3" style={{ background: T.paperAlt }}>
        {clientRows.map((r) => {
          const key = `${person}::${r.name}`;
          const clientExpanded = expandedHoursClient[key];
          return (
            <div key={r.name}>
              <button onClick={() => toggleHoursClientExpand(key)} className="flex items-center justify-between w-full text-xs py-1 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>
                <span className="flex items-center gap-1.5" style={{ color: T.ink }}>
                  <ChevronDown size={10} color={T.slateLight} style={{ transform: clientExpanded ? "none" : "rotate(-90deg)" }} />
                  {r.name}
                </span>
                <span className="font-semibold" style={{ color: T.tealDark }}>{r.total}h</span>
              </button>
              {clientExpanded && (
                <div className="pl-4 py-1 flex flex-col gap-1">
                  {[...r.list].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-[11px] py-0.5">
                      <span style={{ color: T.slate }}>{fmtDate(e.date)} — {e.description || "—"}</span>
                      <span className="font-semibold shrink-0 ml-2" style={{ color: T.ink }}>{e.hours}h</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {clientRows.length === 0 && <div className="text-xs py-1" style={{ color: T.slateLight }}>Nothing logged in this window.</div>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card style={{ padding: "10px 16px" }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex rounded-lg p-1" style={{ background: T.paperAlt }}>
            <button onClick={() => setView("weekly")} className="text-xs font-semibold px-4 py-1.5 rounded-md"
              style={{ background: view === "weekly" ? T.card : "transparent", color: view === "weekly" ? T.tealDark : T.slate }}>Weekly</button>
            <button onClick={() => setView("monthly")} className="text-xs font-semibold px-4 py-1.5 rounded-md"
              style={{ background: view === "monthly" ? T.card : "transparent", color: view === "monthly" ? T.tealDark : T.slate }}>Monthly</button>
          </div>
          <div className="flex rounded-lg p-1" style={{ background: T.paperAlt }}>
            <button onClick={() => setGroupBy("client")} className="text-xs font-semibold px-4 py-1.5 rounded-md"
              style={{ background: groupBy === "client" ? T.card : "transparent", color: groupBy === "client" ? T.tealDark : T.slate }}>By client</button>
            <button onClick={() => setGroupBy("person")} className="text-xs font-semibold px-4 py-1.5 rounded-md"
              style={{ background: groupBy === "person" ? T.card : "transparent", color: groupBy === "person" ? T.tealDark : T.slate }}>By person</button>
          </div>
          {view === "weekly" ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} color={T.slate} /></button>
              <span className="text-sm font-semibold" style={{ color: T.ink }}>{fmtDate(days[0])} – {fmtDate(days[6])}</span>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} color={T.slate} /></button>
              {weekStart !== startOfWeek(today()) && (
                <button onClick={() => setWeekStart(startOfWeek(today()))} className="text-xs font-semibold ml-1" style={{ color: T.tealDark }}>This week</button>
              )}
            </div>
          ) : (
            <select value={monthYear} onChange={(e) => setMonthYear(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
              {monthsAvailable.map((m) => <option key={m} value={m}>{m === currentMonth() ? "This month" : monthLabel(m)}</option>)}
            </select>
          )}
        </div>
      </Card>

      {view === "weekly" ? (
        groupBy === "client" ? (
        <Card style={{ padding: 16, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "180px repeat(7, 72px) 96px", gap: 4, minWidth: 760 }}>
            <div />
            {days.map((d) => (
              <div key={d} className="text-center">
                <div className="text-[10px] font-semibold" style={{ color: T.slateLight }}>{dayHeaderLabel(d)}</div>
                <div className="text-[10px]" style={{ color: T.slateLight }}>{fmtDate(d).replace(/ \d{4}$/, "")}</div>
              </div>
            ))}
            <div className="text-[10px] text-center font-semibold self-center" style={{ color: T.slateLight }}>Total / target</div>

            {trackedClients.map((c) => {
              const entries = getBillableEntries(c);
              const dayTotals = days.map((d) => entries.filter((e) => e.date === d).reduce((s, e) => s + e.hours, 0));
              const weekTotal = Math.round(dayTotals.reduce((s, v) => s + v, 0) * 100) / 100;
              const target = weeklyTargetFor(c);
              const overUnder = target !== null ? Math.round((weekTotal - target) * 10) / 10 : null;
              const totalColor = overUnder === null ? T.ink : overUnder < 0 ? T.coral : T.tealDark;
              return (
                <React.Fragment key={c.id}>
                  <div className="text-xs font-medium py-2 truncate" style={{ color: T.ink }} title={c.name}>{c.name}</div>
                  {dayTotals.map((v, i) => (
                    <div key={i} className="text-xs text-center py-2" style={{ color: v > 0 ? T.ink : T.border }}>{v > 0 ? v : "—"}</div>
                  ))}
                  <div className="text-center py-2">
                    <div className="text-xs font-bold" style={{ color: totalColor }}>{weekTotal}h{target !== null ? ` / ${target}h` : ""}</div>
                    {overUnder !== null && <div className="text-[10px]" style={{ color: totalColor }}>{overUnder > 0 ? `+${overUnder}h ahead` : overUnder < 0 ? `${overUnder}h behind` : "on pace"}</div>}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {trackedClients.length === 0 && <div className="text-xs py-3" style={{ color: T.slateLight }}>No hourly or subscription+hours clients to track.</div>}
        </Card>
        ) : (
        <Card style={{ padding: 16, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px repeat(7, 72px) 80px", gap: 4, minWidth: 700 }}>
            <div />
            {days.map((d) => (
              <div key={d} className="text-center">
                <div className="text-[10px] font-semibold" style={{ color: T.slateLight }}>{dayHeaderLabel(d)}</div>
                <div className="text-[10px]" style={{ color: T.slateLight }}>{fmtDate(d).replace(/ \d{4}$/, "")}</div>
              </div>
            ))}
            <div className="text-[10px] text-center font-semibold self-center" style={{ color: T.slateLight }}>Total</div>

            {TEAM.map((person) => {
              const personEntries = allEntries.filter((e) => e.member === person && days.includes(e.date));
              const dayTotals = days.map((d) => personEntries.filter((e) => e.date === d).reduce((s, e) => s + e.hours, 0));
              const weekTotal = Math.round(dayTotals.reduce((s, v) => s + v, 0) * 100) / 100;
              const expanded = expandedHoursPerson[person];
              return (
                <React.Fragment key={person}>
                  <button onClick={() => toggleHoursPersonExpand(person)} className="text-xs font-medium py-2 truncate text-left flex items-center gap-1" style={{ color: T.ink }}>
                    <ChevronDown size={10} color={T.slateLight} style={{ transform: expanded ? "none" : "rotate(-90deg)" }} />
                    {person}
                  </button>
                  {dayTotals.map((v, i) => (
                    <div key={i} className="text-xs text-center py-2" style={{ color: v > 0 ? T.ink : T.border }}>{v > 0 ? v : "—"}</div>
                  ))}
                  <div className="text-xs text-center py-2 font-bold" style={{ color: T.tealDark }}>{weekTotal}h</div>
                  {expanded && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <PersonBreakdown person={person} entries={personEntries} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </Card>
        )
      ) : groupBy === "client" ? (
        <Card style={{ padding: 0 }}>
          <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
            <div>Client</div><div>Hours logged</div><div>Included</div><div>Over / under</div><div>Status</div>
          </div>
          {trackedClients.map((c) => {
            const logged = Math.round(getBillableEntries(c).filter((e) => e.date.slice(0, 7) === monthYear).reduce((s, e) => s + e.hours, 0) * 100) / 100;
            const included = c.hours?.included || 0;
            const diff = included > 0 ? Math.round((logged - included) * 10) / 10 : null;
            return (
              <div key={c.id} className="grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ color: T.ink }} className="font-medium">{c.name}</div>
                <div style={{ color: T.ink }}>{logged}h</div>
                <div style={{ color: T.slate }}>{included > 0 ? `${included}h` : "—"}</div>
                <div style={{ color: diff === null ? T.slateLight : diff < 0 ? T.coral : T.tealDark }}>{diff === null ? "—" : diff > 0 ? `+${diff}h` : `${diff}h`}</div>
                <div><Pill color={c.billing?.status === "Overdue" ? T.coral : T.tealDark} bg={T.paperAlt}>{c.billing?.status || "Current"}</Pill></div>
              </div>
            );
          })}
          {trackedClients.length === 0 && <div className="text-xs px-4 py-3" style={{ color: T.slateLight }}>No hourly or subscription+hours clients to track.</div>}
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
            <div>Person</div><div>Hours logged this month</div>
          </div>
          {TEAM.map((person) => {
            const monthEntries = allEntries.filter((e) => e.member === person && e.date.slice(0, 7) === monthYear);
            const logged = Math.round(monthEntries.reduce((s, e) => s + e.hours, 0) * 100) / 100;
            const expanded = expandedHoursPerson[person];
            return (
              <div key={person} style={{ borderBottom: `1px solid ${T.border}` }}>
                <button onClick={() => toggleHoursPersonExpand(person)} className="grid items-center px-4 py-3 text-sm w-full text-left" style={{ gridTemplateColumns: "2fr 1fr" }}>
                  <div style={{ color: T.ink }} className="font-medium flex items-center gap-1.5">
                    <ChevronDown size={12} color={T.slateLight} style={{ transform: expanded ? "none" : "rotate(-90deg)" }} />
                    {person}
                  </div>
                  <div style={{ color: T.tealDark }} className="font-bold">{logged}h</div>
                </button>
                {expanded && <PersonBreakdown person={person} entries={monthEntries} />}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/* ---------- Overview (first landing page — everything due this month, for everyone) ---------- */
function OverviewView({ clients, tasks, onboardings, goToClient }) {
  const thisMonth = currentMonth();
  const monthStart = `${thisMonth}-01`;
  const monthEnd = `${addMonthsToMonthYear(thisMonth, 1)}-01`;

  // One list per person — same three sources My Tasks reads from (tasks, client reminders,
  // current workflow step), just windowed to the calendar month instead of "next 14 days",
  // since this page is meant to answer "what's due this month", not "what's due soon".
  const peopleItems = TEAM.map((person) => {
    const items = [];
    tasks.filter((t) => t.assignee === person && !t.done && t.dueDate && t.dueDate >= monthStart && t.dueDate < monthEnd)
      .forEach((t) => items.push({ type: "Task", title: t.title, date: t.dueDate }));
    clients.forEach((c) => {
      (c.reminders || []).filter((r) => r.assignee === person && !r.done && r.date && r.date >= monthStart && r.date < monthEnd)
        .forEach((r) => items.push({ type: "Reminder", title: r.text, date: r.date, clientName: c.name, clientId: c.id }));
      (onboardings[c.id] || []).filter((i) => !i.completedDate).forEach((inst) => {
        const currentIdx = inst.steps.findIndex((s) => !s.done);
        if (currentIdx === -1) return;
        const step = inst.steps[currentIdx];
        if (step.owner === person && step.dueDate && step.dueDate >= monthStart && step.dueDate < monthEnd) {
          items.push({ type: "Workflow", title: step.title, date: step.dueDate, clientName: c.name, clientId: c.id });
        }
      });
    });
    items.sort((a, b) => a.date.localeCompare(b.date));
    return { person, items };
  });

  // Same underlying data as the Scheduling tab's "left to do" — just condensed to a
  // left/total count here instead of listing every task, so this stays a quick scan rather
  // than another full list to read through.
  // Same computation as the Scheduling tab's Monthly Targets section — target progress is
  // matched by targetId against this month's schedule occurrences (not against any stored
  // task list), so a deleted schedule entry or target drops out of this the moment it's
  // gone, nothing stale left to clean up separately.
  const enterpriseSummaries = clients.filter((c) => !c.archived && c.profile === "Enterprise Client").map((c) => {
    const targets = c.scheduleTargets || [];
    const visibleTargets = targets.filter((t) => t.repeat === "monthly" || t.monthYear === thisMonth);
    if (visibleTargets.length === 0) return null;
    const done = visibleTargets.reduce((sum, t) => sum + (c.reminders || []).filter((r) => r.targetId === t.id && r.done && r.date.slice(0, 7) === thisMonth).length, 0);
    const target = visibleTargets.reduce((sum, t) => sum + t.targetCount, 0);
    return { client: c, done, target };
  }).filter(Boolean);

  const typeColor = (t) => (t === "Task" ? T.tealDark : t === "Workflow" ? T.blue : "#8B6BA8");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Due this month — {monthLabel(thisMonth)}</div>
        <div className="grid grid-cols-2 gap-4">
          {peopleItems.map(({ person, items }) => (
            <Card key={person} style={{ padding: 16 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold" style={{ color: T.ink }}>{person}</div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: T.paperAlt, color: T.slate }}>{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {items.map((it, i) => (
                  <button key={i} onClick={() => it.clientId && goToClient(it.clientId, it.type === "Workflow" ? "onboarding" : "reminders")}
                    className="flex items-center justify-between text-xs py-1 text-left" style={{ borderBottom: `1px solid ${T.border}`, cursor: it.clientId ? "pointer" : "default" }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Pill color={typeColor(it.type)} bg={T.paperAlt}>{it.type}</Pill>
                      <span className="truncate" style={{ color: T.ink }}>{it.title}{it.clientName ? ` — ${it.clientName}` : ""}</span>
                    </div>
                    <span className="shrink-0 ml-2" style={{ color: urgencyColor(it.date) }}>{fmtDate(it.date)}</span>
                  </button>
                ))}
                {items.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing due this month.</div>}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {enterpriseSummaries.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-3" style={{ color: T.ink }}>Enterprise clients — monthly targets</div>
          <div className="grid grid-cols-3 gap-3">
            {enterpriseSummaries.map(({ client, done, target }) => (
              <button key={client.id} onClick={() => goToClient(client.id, "scheduling")} className="text-left">
                <Card style={{ padding: 14 }} className="flex items-center justify-between">
                  <span className="text-sm font-semibold truncate" style={{ color: T.ink }}>{client.name}</span>
                  <span className="text-xs font-bold px-2 py-1 rounded-full shrink-0 ml-2" style={{ background: T.paperAlt, color: done >= target ? T.tealDark : T.amber }}>{done}/{target}</span>
                </Card>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BillingOverview({ clients, resellers }) {
  const [showFlatFee, setShowFlatFee] = useState(false);
  const [expandedBilling, setExpandedBilling] = useState({});
  const toggleBillingExpand = (id) => setExpandedBilling((prev) => ({ ...prev, [id]: !prev[id] }));
  const removeHourFromBilling = (clientId, hourId) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    updateDoc(doc(db, "clients", clientId), { hours: { ...c.hours, log: c.hours.log.filter((h) => h.id !== hourId) } });
  };
  const [viewMonth, setViewMonth] = useState(currentMonth());
  // Just a manual "I've invoiced this one" checkbox for Vanessa to track as she works
  // through invoicing, kept separate from client.billing.status (which is the account's
  // overall Current/Overdue standing, not tied to any specific month). Stored per month so
  // ticking it for August doesn't carry over and falsely show as billed in September.
  const toggleBilled = (clientId) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const billedMonths = c.billedMonths || [];
    const next = billedMonths.includes(viewMonth) ? billedMonths.filter((m) => m !== viewMonth) : [...billedMonths, viewMonth];
    updateDoc(doc(db, "clients", clientId), { billedMonths: next });
  };
  // The $250 logo fee is a one-off, not tied to any month like the checkbox above, so it's
  // just a plain flag: once ticked, the badge disappears for good rather than resetting each
  // month, since there's nothing to re-charge once it's been invoiced.
  const markLogoFeeBilled = (clientId) => updateDoc(doc(db, "clients", clientId), { logoFeeBilled: true });
  // Every month that genuinely has hours or billable expenses logged against any client,
  // newest first, always including the current month even if nothing's logged yet.
  const monthsAvailable = (() => {
    const set = new Set();
    clients.forEach((c) => {
      (c.hours?.log || []).forEach((h) => h.date && set.add(h.date.slice(0, 7)));
      (c.billableExpenses || []).forEach((x) => x.date && set.add(x.date.slice(0, 7)));
    });
    set.add(currentMonth());
    return [...set].sort().reverse();
  })();
  const newClients = clients.filter((c) => c.billingSetupDone === false);
  const setUpClients = clients.filter((c) => c.billingSetupDone !== false);
  const hasHoursThisMonth = (c) => c.hours.log.some((h) => h.date.slice(0, 7) === viewMonth);

  const needsAttention = setUpClients.filter((c) => (c.billingType || "FlatFee") !== "FlatFee" || hasHoursThisMonth(c)).map((c) => ({
    id: c.id, name: c.name, type: c.billingType || "FlatFee", adHoc: (c.billingType || "FlatFee") === "FlatFee",
    logged: c.hours.log.filter((h) => h.date.slice(0, 7) === viewMonth).reduce((s, h) => s + h.hours, 0),
    included: c.hours.included,
    users: c.users.log[c.users.log.length - 1]?.count ?? 0,
    status: c.billing.status,
    hourItems: c.hours.log.filter((h) => h.date.slice(0, 7) === viewMonth),
    expenseItems: (c.billableExpenses || []).filter((x) => x.date && x.date.slice(0, 7) === viewMonth),
    billedForViewMonth: (c.billedMonths || []).includes(viewMonth),
    isNztg: (c.intake?.hearAboutUs || "").toLowerCase().includes("nztg"),
    logoPath: !c.logoFeeBilled ? (c.intake?.logoPath || null) : null,
    isAnnualDiscount: c.intake?.paymentFreq === "Annually (10% discount)",
    wantsMonthlyReports: Boolean(c.intake?.wantsMonthlyReports),
  }));
  const flatFeeRows = setUpClients.filter((c) => (c.billingType || "FlatFee") === "FlatFee" && !hasHoursThisMonth(c)).map((c) => ({
    id: c.id, name: c.name,
    plan: c.contract.plan,
    users: c.users.log[c.users.log.length - 1]?.count ?? 0,
    openExtras: c.extras.filter((e) => e.status !== "Done").length,
    status: c.billing.status,
    isNztg: (c.intake?.hearAboutUs || "").toLowerCase().includes("nztg"),
    logoPath: !c.logoFeeBilled ? (c.intake?.logoPath || null) : null,
    isAnnualDiscount: c.intake?.paymentFreq === "Annually (10% discount)",
    wantsMonthlyReports: Boolean(c.intake?.wantsMonthlyReports),
  }));
  const totalHours = needsAttention.reduce((s, r) => s + r.logged, 0);
  const totalUsers = [...needsAttention, ...flatFeeRows].reduce((s, r) => s + r.users, 0);

  const markBillingSetUp = (id) => updateDoc(doc(db, "clients", id), { billingSetupDone: true });

  // A reseller's client count is "how many of their clients logged a user count in the
  // viewed month", not a running total of everyone ever added.
  const billingActiveClients = (r) => r.clients.filter((c) => c.users.log.some((u) => u.month === viewMonth));
  const resellerRows = resellers.map((r) => {
    const active = billingActiveClients(r);
    return { id: r.id, name: r.name, clientCount: active.length, users: active.reduce((s, c) => s + (c.users.log[c.users.log.length - 1]?.count ?? 0), 0) };
  });
  const resellerTotalUsers = resellerRows.reduce((s, r) => s + r.users, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card style={{ padding: "10px 16px" }}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Viewing</span>
          <select value={viewMonth} onChange={(e) => setViewMonth(e.target.value)}
            className="text-sm px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
            {monthsAvailable.map((m) => <option key={m} value={m}>{m === currentMonth() ? "This month" : monthLabel(m)}</option>)}
          </select>
          {viewMonth !== currentMonth() && (
            <span className="text-xs" style={{ color: T.slateLight }}>Looking at a past month, not what's currently outstanding.</span>
          )}
        </div>
      </Card>

      {newClients.length > 0 && (
        <Card style={{ padding: 16, borderLeft: `3px solid ${T.amber}` }}>
          <div className="text-sm font-semibold mb-1" style={{ color: T.ink }}>New clients — set up for billing</div>
          <div className="text-xs mb-3" style={{ color: T.slate }}>Came through the sign-up form this month and still need adding in Xero. Everything needed to create the contact is below — clear each once it's done.</div>
          <div className="flex flex-col gap-3">
            {newClients.map((c) => {
              const phone = (c.contacts || []).find((ct) => ct.name === c.billing?.contact)?.phone || (c.contacts || [])[0]?.phone || "—";
              return (
                <div key={c.id} className="pb-3" style={{ borderBottom: `1px solid ${T.border}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold" style={{ color: T.ink }}>{c.name}</span>
                    <button onClick={() => markBillingSetUp(c.id)} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Added to Xero</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-2">
                    <div><span style={{ color: T.slateLight }}>Legal name: </span><span style={{ color: T.ink, fontWeight: 600 }}>{c.legalName || c.name}</span></div>
                    <div><span style={{ color: T.slateLight }}>Contact: </span><span style={{ color: T.ink, fontWeight: 600 }}>{c.billing?.contact || "—"}</span></div>
                    <div><span style={{ color: T.slateLight }}>Email: </span><span style={{ color: T.ink, fontWeight: 600 }}>{c.billing?.email || "—"}</span></div>
                    <div><span style={{ color: T.slateLight }}>Phone: </span><span style={{ color: T.ink, fontWeight: 600 }}>{phone}</span></div>
                    <div><span style={{ color: T.slateLight }}>Payment terms: </span><span style={{ color: T.ink, fontWeight: 600 }}>{c.billing?.terms || "—"}</span></div>
                    <div><span style={{ color: T.slateLight }}>Plan: </span><span style={{ color: T.ink, fontWeight: 600 }}>{billingTypeMeta[c.billingType || "FlatFee"].label}</span></div>
                    <div><span style={{ color: T.slateLight }}>Tier picked at sign-up: </span><span style={{ color: T.ink, fontWeight: 600 }}>{c.intake?.appUsers || "—"}</span></div>
                    {c.intake?.wantsMonthlyReports && (
                      <div className="col-span-2"><Pill color={T.amber} bg={T.paperAlt}>Add-on requested: Monthly Reports ($130+/month)</Pill></div>
                    )}
                    {c.intake?.logoPath && !c.logoFeeBilled && (
                      <div className="col-span-2 flex items-center gap-2">
                        <Pill color={T.amber} bg={T.paperAlt}>Logo uploaded at sign-up ($250 one-off fee)</Pill>
                        <button type="button" onClick={async () => {
                          try {
                            const url = await getDownloadURL(storageRef(storage, c.intake.logoPath));
                            window.open(url, "_blank");
                          } catch (err) {
                            console.error("Couldn't open logo:", err);
                            alert("Couldn't open the logo, it may not have finished uploading, or the link has expired.");
                          }
                        }} className="text-xs underline" style={{ color: T.tealDark }}>
                          View logo
                        </button>
                        <label className="flex items-center gap-1 text-xs" style={{ color: T.slate }}>
                          <input type="checkbox" onChange={() => markLogoFeeBilled(c.id)} />
                          Charged
                        </label>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: T.slateLight }}>Contract value:</span>
                      <input defaultValue={c.contract?.value || ""} placeholder="e.g. $249/month"
                        onBlur={(e) => updateDoc(doc(db, "clients", c.id), { contract: { ...c.contract, value: e.target.value } })}
                        className="text-xs font-semibold px-1.5 py-1 rounded-lg outline-none flex-1" style={{ color: T.ink, border: `1px solid ${T.border}` }} />
                    </div>
                    {c.intake?.paymentFreq === "Annually (10% discount)" && (
                      <div className="col-span-2"><Pill color={T.tealDark} bg={T.paperAlt}>Annual, 10% off</Pill></div>
                    )}
                    {c.intake?.questionnairePath && (
                      <div className="col-span-2">
                        <button type="button" onClick={async () => {
                          try {
                            const url = await getDownloadURL(storageRef(storage, c.intake.questionnairePath));
                            window.open(url, "_blank");
                          } catch (err) {
                            console.error("Couldn't open questionnaire:", err);
                            alert("Couldn't open the questionnaire PDF, it may not have finished uploading, or the link has expired.");
                          }
                        }} className="text-xs text-left underline" style={{ color: T.tealDark }}>
                          Open questionnaire
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const lines = [
                        `New client for Xero: ${c.name}`,
                        `Legal name: ${c.legalName || c.name}`,
                        `Contact: ${c.billing?.contact || "—"}`,
                        `Email: ${c.billing?.email || "—"}`,
                        `Phone: ${phone}`,
                        `Payment terms: ${c.billing?.terms || "—"}`,
                        `Plan: ${billingTypeMeta[c.billingType || "FlatFee"].label}`,
                        `Tier picked at sign-up: ${c.intake?.appUsers || "—"}`,
                        ...(c.intake?.paymentFreq === "Annually (10% discount)" ? ["Annual payment plan: 10% discount applies"] : []),
                        ...(c.intake?.wantsMonthlyReports ? ["Add-on requested: Monthly Reports ($130+/month)"] : []),
                        ...(c.intake?.logoPath && !c.logoFeeBilled ? ["Logo uploaded at sign-up: $250 one-off fee"] : []),
                        `Contract value: ${c.contract?.value || "—"}`,
                      ];
                      navigator.clipboard.writeText(lines.join("\n"))
                        .then(() => alert("Copied, paste this into Xero when creating the new contact."))
                        .catch(() => alert("Couldn't copy to clipboard, your browser may have blocked it."));
                    }}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: T.paperAlt, color: T.tealDark }}>
                    <ClipboardList size={12} /> Copy details
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Hours logged, {viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{totalHours}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Total direct app users</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{totalUsers}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Clients with hours to review</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{needsAttention.length}</div></Card>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Clients with hours to review — Hourly &amp; Subscription + Hours</div>
      <Card style={{ padding: 0 }}>
        <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1.3fr 1fr 1fr 1fr 1fr 1fr 0.7fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
          <div>Client</div><div>Type</div><div>Hours logged</div><div>Included</div><div>Over / under</div><div>Users</div><div>Status</div><div>Billed</div>
        </div>
        {needsAttention.map((r) => {
          const diff = r.included > 0 ? r.logged - r.included : null;
          const expensesTotal = r.expenseItems.reduce((s, x) => s + x.amount, 0);
          const expanded = expandedBilling[r.id];
          return (
            <div key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <div className="grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: "2fr 1.3fr 1fr 1fr 1fr 1fr 1fr 0.7fr" }}>
                <button onClick={() => toggleBillingExpand(r.id)} style={{ display: "contents" }}>
                  <div style={{ color: T.ink }} className="font-medium flex items-center gap-1.5 text-left flex-wrap">
                    <ChevronDown size={12} color={T.slateLight} style={{ transform: expanded ? "none" : "rotate(-90deg)" }} />
                    {r.name}
                    {r.isNztg && <Pill color={T.amber} bg={T.paperAlt}>NZTG</Pill>}
                    {r.logoPath && (
                      <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1">
                        <Pill color={T.amber} bg={T.paperAlt}>Logo $250</Pill>
                        <input type="checkbox" onChange={(e) => { e.stopPropagation(); markLogoFeeBilled(r.id); }} title="Tick once the $250 logo fee has been charged" />
                      </span>
                    )}
                    {r.isAnnualDiscount && <Pill color={T.tealDark} bg={T.paperAlt}>Annual, 10% off</Pill>}
                    {r.wantsMonthlyReports && <Pill color={T.amber} bg={T.paperAlt}>Monthly Reports</Pill>}
                  </div>
                  <div><Pill color={r.adHoc ? T.amber : billingTypeMeta[r.type].color} bg={T.paperAlt}>{r.adHoc ? "Flat + ad-hoc" : r.type === "Hourly" ? "Hourly" : "Sub + hours"}</Pill></div>
                  <div style={{ color: T.ink }} className="text-left">{r.logged}h{expensesTotal > 0 ? ` + $${expensesTotal}` : ""}</div>
                  <div style={{ color: T.slate }} className="text-left">{r.included > 0 ? `${r.included}h` : "—"}</div>
                  <div style={{ color: diff === null ? T.slateLight : diff > 0 ? T.coral : T.tealDark }} className="text-left">{diff === null ? "—" : diff > 0 ? `+${diff}h` : `${diff}h`}</div>
                  <div style={{ color: T.ink }} className="text-left">{r.users}</div>
                  <div className="text-left"><Pill color={r.status === "Overdue" ? T.coral : T.tealDark} bg={T.paperAlt}>{r.status}</Pill></div>
                </button>
                <label className="flex items-center gap-1.5 cursor-pointer" title={`Mark as invoiced for ${viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}`}>
                  <input type="checkbox" checked={r.billedForViewMonth} onChange={() => toggleBilled(r.id)} />
                </label>
              </div>
              {expanded && (
                <div className="px-4 pb-3" style={{ background: T.paperAlt }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide pt-2 pb-1" style={{ color: T.slateLight }}>Hours logged, {viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}</div>
                  {r.hourItems.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: `1px solid ${T.border}` }}>
                      <div><span style={{ color: T.ink }}>{h.description || "—"}</span><span className="ml-2" style={{ color: T.slateLight }}>{h.member} · {fmtDate(h.date)}</span></div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold" style={{ color: T.tealDark }}>{h.hours}h</span>
                        <ConfirmButton onConfirm={() => removeHourFromBilling(r.id, h.id)} title="Remove this hours entry" iconSize={11} />
                      </div>
                    </div>
                  ))}
                  {r.hourItems.length === 0 && <div className="text-xs py-1" style={{ color: T.slateLight }}>None logged this month.</div>}
                  {r.expenseItems.length > 0 && (
                    <>
                      <div className="text-[11px] font-semibold uppercase tracking-wide pt-3 pb-1" style={{ color: T.slateLight }}>Billable expenses, {viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}</div>
                      {r.expenseItems.map((x) => (
                        <div key={x.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: `1px solid ${T.border}` }}>
                          <div><span style={{ color: T.ink }}>{x.description || "—"}</span><span className="ml-2" style={{ color: T.slateLight }}>{x.member} · {fmtDate(x.date)}</span></div>
                          <span className="font-semibold" style={{ color: T.amber }}>${x.amount}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
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
              <div style={{ color: T.ink }} className="font-medium flex items-center gap-1.5 flex-wrap">
                {r.name}
                {r.isNztg && <Pill color={T.amber} bg={T.paperAlt}>NZTG</Pill>}
                {r.logoPath && (
                  <span className="inline-flex items-center gap-1">
                    <Pill color={T.amber} bg={T.paperAlt}>Logo $250</Pill>
                    <input type="checkbox" onChange={() => markLogoFeeBilled(r.id)} title="Tick once the $250 logo fee has been charged" />
                  </span>
                )}
                {r.isAnnualDiscount && <Pill color={T.tealDark} bg={T.paperAlt}>Annual, 10% off</Pill>}
                    {r.wantsMonthlyReports && <Pill color={T.amber} bg={T.paperAlt}>Monthly Reports</Pill>}
              </div>
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
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Reseller users, {viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{resellerTotalUsers}</div></Card>
        <Card style={{ padding: 16 }}><div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Their billing clients, {viewMonth === currentMonth() ? "this month" : monthLabel(viewMonth)}</div><div className="text-xl font-bold mt-1" style={{ color: T.ink }}>{resellerRows.reduce((s, r) => s + r.clientCount, 0)}</div></Card>
      </div>
      <Card style={{ padding: 0 }}>
        <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3" style={{ gridTemplateColumns: "2fr 1fr 1fr", color: T.slate, borderBottom: `1px solid ${T.border}` }}>
          <div>Reseller</div><div>Active clients</div><div>Users to bill</div>
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
function TasksView({ tasks, clients, onboardings, currentUser, goToClient, resellers, goToReseller, leads, goToSales }) {
  const [person, setPerson] = useState(currentUser || TEAM[0]);
  const [draft, setDraft] = useState({ title: "", priority: "Medium", clientId: "", dueDate: "", estHours: "" });

  // Nothing should sit in a task list just because it exists somewhere with a due date a
  // year out — only show it once it's actually coming up, or if it never had a due date to
  // begin with (nothing to judge "coming up" against, so those always show).
  const isComingUpOrUndated = (dueDate) => !dueDate || daysUntil(dueDate) <= 14;

  const leadFollowUps = useMemo(() => {
    const out = [];
    (leads || []).forEach((l) => {
      if (l.followUpAssignee === person && l.followUpDate && isComingUpOrUndated(l.followUpDate)) {
        out.push({ id: `lead-${l.id}`, leadId: l.id, title: `Follow up with ${l.company}`, dueDate: l.followUpDate, stage: l.stage });
      }
    });
    return out;
  }, [leads, person]);

  const resellerTasks = useMemo(() => {
    const out = [];
    resellers.forEach((r) => {
      r.tasks.filter((t) => !t.done && t.assignee === person && isComingUpOrUndated(t.date)).forEach((t) => {
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
        if (step.owner === person && isComingUpOrUndated(step.dueDate)) out.push({ id: `ob-${inst.id}-${step.id}`, title: step.title, clientId: c.id, clientName: c.name, workflowName: inst.workflowName, dueDate: step.dueDate, isOnboarding: true });
      });
    });
    return out;
  }, [clients, onboardings, person]);

  const reminderTasks = useMemo(() => {
    const out = [];
    clients.forEach((c) => {
      // A reminder a year out (e.g. an OHSMS annual review) shouldn't sit in someone's task
      // list for the next twelve months — only surface it once it's genuinely coming up.
      c.reminders.filter((r) => !r.done && r.assignee === person && isComingUpOrUndated(r.date)).forEach((r) => {
        out.push({ id: `rem-${c.id}-${r.id}`, title: r.text, clientId: c.id, clientName: c.name, dueDate: r.date });
      });
    });
    return out;
  }, [clients, person]);

  const myTasksAll = tasks.filter((t) => t.assignee === person);
  const activeTasks = myTasksAll.filter((t) => !t.done && isComingUpOrUndated(t.dueDate));
  const completedTasks = myTasksAll.filter((t) => t.done);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  const addTask = () => {
    if (!draft.title.trim()) return;
    const clientName = clients.find((c) => c.id === draft.clientId)?.name || null;
    const id = "task" + Date.now();
    setDoc(doc(db, "tasks", id), { title: draft.title, assignee: person, priority: draft.priority, done: false, clientId: draft.clientId || null, clientName, dueDate: draft.dueDate || null, estHours: draft.estHours ? Number(draft.estHours) : 0 });
    setDraft({ title: "", priority: "Medium", clientId: "", dueDate: "", estHours: "" });
  };
  const toggleDone = (id) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const nowDone = !t.done;
    // Crossing a task off is what counts as its completion date now — no separate
    // "mark complete" step, so stamp it here and clear it again if someone unticks it.
    updateDoc(doc(db, "tasks", id), { done: nowDone, completedDate: nowDone ? today() : null });
    if (nowDone) playCompletionChime();
  };
  const deleteTaskPermanently = (id) => deleteDoc(doc(db, "tasks", id));
  const setPriority = (id, priority) => updateDoc(doc(db, "tasks", id), { priority });
  const setEstHours = (id, hours) => updateDoc(doc(db, "tasks", id), { estHours: hours ? Number(hours) : 0 });

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
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>From client tasks</div>
          {reminderTasks.map((t) => (
            <Card key={t.id} onClick={() => goToClient(t.clientId, "reminders")} style={{ padding: 14, borderLeft: `3px solid ${T.amber}`, cursor: "pointer" }} className="flex items-center justify-between hover:opacity-80">
              <div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                  <span>{t.clientName}</span>
                  <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {daysUntil(t.dueDate) < 0 ? `Overdue · ${fmtDate(t.dueDate)}` : fmtDate(t.dueDate)}</span>
                </div>
              </div>
              <Pill color={T.amber} bg={T.paperAlt}>Client task</Pill>
            </Card>
          ))}
        </div>
      )}

      {leadFollowUps.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Sales follow-ups</div>
          {leadFollowUps.map((t) => (
            <Card key={t.id} onClick={() => goToSales && goToSales()} style={{ padding: 14, borderLeft: `3px solid #8B6BA8`, cursor: "pointer" }} className="flex items-center justify-between hover:opacity-80">
              <div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{t.title}</div>
                <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: T.slate }}>
                  <span>{t.stage}</span>
                  <span className="flex items-center gap-1" style={{ color: urgencyColor(t.dueDate) }}><Calendar size={10} /> {daysUntil(t.dueDate) < 0 ? `Overdue · ${fmtDate(t.dueDate)}` : fmtDate(t.dueDate)}</span>
                </div>
              </div>
              <Pill color="#8B6BA8" bg={T.paperAlt}>Follow up</Pill>
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
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input type="number" min="0" step="0.5" value={t.estHours || ""} onChange={(e) => setEstHours(t.id, e.target.value)}
                  placeholder="hrs" title="Estimated hours — counts toward Schedule workload"
                  className="w-14 text-xs px-1.5 py-1 rounded-lg outline-none text-center" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <select value={t.priority} onChange={(e) => setPriority(t.id, e.target.value)} className="text-xs font-semibold px-2.5 py-1 rounded-full outline-none border-none"
                  style={{ color: meta.color, background: meta.bg }}>
                  {Object.keys(priorityMeta).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
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
        <input type="number" min="0" step="0.5" placeholder="hrs" value={draft.estHours} onChange={(e) => setDraft({ ...draft, estHours: e.target.value })}
          title="Estimated hours — counts toward Schedule workload"
          className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
        <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
          {Object.keys(priorityMeta).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={addTask} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
      </Card>
    </div>
  );
}

/* ---------- Notifications bell ---------- */
function NotificationsBell({ notifications, dismissNotification, upcomingReminders, currentUser, goToClient }) {
  const [open, setOpen] = useState(false);
  const active = notifications.filter((n) => !n.dismissed && n.forPerson === currentUser);
  const myReminders = upcomingReminders.filter((r) => r.assignee === currentUser);
  const dismiss = (id) => dismissNotification(id);
  const openReminder = (r) => { setOpen(false); goToClient(r.clientId, "reminders"); };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: T.paperAlt }}>
        <Bell size={14} color={T.slate} />
        <span className="text-xs font-medium" style={{ color: T.ink }}>{active.length + myReminders.length} updates</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 rounded-xl z-10 max-h-96 overflow-y-auto" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide px-4 pt-3 pb-2" style={{ color: T.slate }}>Notifications for {currentUser}</div>
          {active.length === 0 && myReminders.length === 0 && <div className="text-xs px-4 pb-3" style={{ color: T.slateLight }}>Nothing waiting.</div>}
          {active.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2 px-4 py-2.5" style={{ borderTop: `1px solid ${T.border}` }}>
              <div className="text-xs" style={{ color: T.ink }}>{n.message}</div>
              <button onClick={() => dismiss(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0" style={{ background: T.paperAlt, color: T.tealDark }}>
                {n.type === "handover" ? "Added to Xero" : "Got it"}
              </button>
            </div>
          ))}
          {myReminders.length > 0 && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide px-4 pt-3 pb-1" style={{ color: T.slateLight, borderTop: active.length > 0 ? `1px solid ${T.border}` : "none" }}>
                Tasks due within 2 weeks
              </div>
              {myReminders.map((r) => (
                <button key={r.id} onClick={() => openReminder(r)} className="w-full flex items-start justify-between gap-2 px-4 py-2.5 text-left" style={{ borderTop: `1px solid ${T.border}` }}>
                  <div className="min-w-0">
                    <div className="text-xs truncate" style={{ color: T.ink }}>{r.text}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: T.slateLight }}>{r.clientName} · due {fmtDate(r.date)}</div>
                  </div>
                  <ArrowUpRight size={13} color={T.slateLight} className="shrink-0 mt-0.5" />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Workflows (onboarding templates, managed on-site) ---------- */
function WorkflowsView({ workflows }) {
  const addWorkflow = () => {
    const id = "wf-" + Date.now();
    setDoc(doc(db, "workflows", id), { name: "New Workflow", isDefault: false, steps: [{ id: "step" + Date.now(), title: "First step", owner: TEAM[0], dueDays: 3, estHours: 1 }] });
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
              <div key={step.id} className="flex flex-col gap-1.5 rounded-lg p-2" style={{ background: step.type === "email" ? T.paperAlt : "transparent" }}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs font-semibold" style={{ color: T.slateLight }}>{i + 1}</span>
                  <input value={step.title} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, title: e.target.value } : s)) }))}
                    className="flex-1 px-2 py-1.5 rounded-lg outline-none text-sm" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <select value={step.type || "task"} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, type: e.target.value } : s)) }))}
                    className="px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="An email step sends to the client instead of being a task someone ticks off">
                    <option value="task">Task</option>
                    <option value="email">Email to client</option>
                  </select>
                  <select value={step.owner} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, owner: e.target.value } : s)) }))}
                    className="px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title={step.type === "email" ? "Who's responsible for sending it" : "Owner"}>
                    {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="number" value={step.dueDays} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, dueDays: Number(e.target.value) } : s)) }))}
                    className="w-16 px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Due, days from onboarding start" />
                  <span className="text-[11px] shrink-0" style={{ color: T.slateLight }}>days</span>
                  {step.type !== "email" && (
                    <>
                      <input type="number" min="0" step="0.5" value={step.estHours ?? ""} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, estHours: e.target.value ? Number(e.target.value) : 0 } : s)) }))}
                        className="w-14 px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Estimated hours — counts toward Schedule workload" placeholder="hrs" />
                      <span className="text-[11px] shrink-0" style={{ color: T.slateLight }}>hrs</span>
                    </>
                  )}
                  <select value={step.recurring || "none"} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, recurring: e.target.value } : s)) }))}
                    className="px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Some steps need redoing on a schedule rather than being a one-time thing">
                    <option value="none">One-time</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  <button onClick={() => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.filter((s) => s.id !== step.id) }))}><Trash2 size={14} color={T.slateLight} /></button>
                </div>
                {step.type === "email" && (
                  <div className="flex flex-col gap-1.5 pl-7">
                    <input placeholder="Subject" value={step.emailSubject || ""} onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, emailSubject: e.target.value } : s)) }))}
                      className="px-2 py-1.5 rounded-lg outline-none text-xs" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                    <textarea placeholder="Email body — {{clientName}} gets replaced with the actual client name" rows={2} value={step.emailBody || ""}
                      onChange={(e) => updateWorkflow(wf.id, (w) => ({ ...w, steps: w.steps.map((s) => (s.id === step.id ? { ...s, emailBody: e.target.value } : s)) }))}
                      className="px-2 py-1.5 rounded-lg outline-none text-xs resize-y" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => updateWorkflow(wf.id, (w) => ({ ...w, steps: [...w.steps, { id: "step" + Date.now(), title: "New step", owner: TEAM[0], dueDays: 7, estHours: 1, recurring: "none", type: "task" }] }))}
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
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}
function monthLabel(m) {
  return new Date(m + "-02").toLocaleDateString("en-NZ", { month: "short" });
}
// Touchpoints = logged hours + notes for that month — the two things in the data model
// that carry a real date and represent actual client-facing activity.
function touchpointCounts(client, months, tasks = []) {
  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  (client.hours?.log || []).forEach((h) => { const m = (h.date || "").slice(0, 7); if (m in counts) counts[m]++; });
  (client.notes || []).forEach((n) => { const m = (n.date || "").slice(0, 7); if (m in counts) counts[m]++; });
  // Crossing a task off now stamps completedDate (see toggleDone), so completed tasks
  // linked to this client count as a touchpoint too.
  tasks.filter((t) => t.clientId === client.id && t.done && t.completedDate).forEach((t) => {
    const m = (t.completedDate || "").slice(0, 7);
    if (m in counts) counts[m]++;
  });
  return counts;
}

// Same three sources as touchpointCounts, but as a rolling "last N days" total instead of
// calendar-month buckets — used to check a client against their profile's touchpoint
// baseline, which cares about "lately" not "this specific month".
function recentTouchpointCount(client, days, tasks = []) {
  const cutoff = addDays(today(), -days);
  let count = 0;
  (client.hours?.log || []).forEach((h) => { if (h.date && h.date >= cutoff) count++; });
  (client.notes || []).forEach((n) => { if (n.date && n.date >= cutoff) count++; });
  tasks.filter((t) => t.clientId === client.id && t.done && t.completedDate && t.completedDate >= cutoff).forEach(() => count++);
  return count;
}

// Heatmap intensity scale for the Dashboards touchpoint grid — 0 stays a faded neutral
// (genuinely empty, not "a little teal"), then ramps through four real teal shades so the
// grid reads like a proper heatmap instead of jumping straight from grey to solid color.
function heatmapColor(n) {
  if (n === 0) return { bg: T.border, opacity: 0.45 };
  if (n === 1) return { bg: "#BEE8E1", opacity: 1 };
  if (n <= 3) return { bg: "#5FCBBB", opacity: 1 };
  if (n <= 5) return { bg: T.tealDark, opacity: 1 };
  return { bg: "#086F65", opacity: 1 };
}

function DashboardsView({ clients, tasks, touchpointBaselines, updateTouchpointBaseline }) {
  const months = useMemo(() => dashboardMonths(), []);
  const active = clients.filter((c) => !c.archived);
  const groups = CLIENT_PROFILES.map((p) => ({ profile: p, list: active.filter((c) => (c.profile || "Standard Client") === p) }));
  const [baselinesOpen, setBaselinesOpen] = useState(false);
  const PERIOD_OPTIONS = [["Monthly", 30], ["Bi-monthly", 60], ["Quarterly", 90], ["6-monthly", 180]];

  return (
    <div className="flex flex-col gap-8">
      <Card style={{ padding: "10px 16px" }}>
        <button onClick={() => setBaselinesOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Touchpoint targets by client tier</span>
          <ChevronDown size={14} color={T.slateLight} style={{ transform: baselinesOpen ? "rotate(180deg)" : "none" }} />
        </button>
        {baselinesOpen && (
          <div className="flex flex-col gap-2 mt-3">
            {CLIENT_PROFILES.map((profile) => {
              const b = touchpointBaselines[profile] || { targetCount: 1, periodDays: 30, assignee: TEAM[0] };
              return (
                <div key={profile} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold w-36 shrink-0" style={{ color: T.ink }}>{profile}</span>
                  <span className="text-xs" style={{ color: T.slateLight }}>at least</span>
                  <input type="number" min="0" value={b.targetCount} onChange={(e) => updateTouchpointBaseline(profile, { targetCount: Number(e.target.value) })}
                    className="w-14 text-xs px-2 py-1.5 rounded-lg outline-none text-center" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                  <span className="text-xs" style={{ color: T.slateLight }}>touchpoint(s) every</span>
                  <select value={b.periodDays} onChange={(e) => updateTouchpointBaseline(profile, { periodDays: Number(e.target.value) })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {PERIOD_OPTIONS.map(([label, days]) => <option key={days} value={days}>{label}</option>)}
                  </select>
                  <span className="text-xs" style={{ color: T.slateLight }}>— remind</span>
                  <select value={b.assignee} onChange={(e) => updateTouchpointBaseline(profile, { assignee: e.target.value })}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                    {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              );
            })}
            <div className="text-[11px] mt-1" style={{ color: T.slateLight }}>
              A client that falls short gets a task for the person above, in their client's Tasks tab — it clears itself automatically once they're back on track. Checked whenever the app's open, not on an overnight schedule.
            </div>
          </div>
        )}
      </Card>

      <div className="text-sm" style={{ color: T.slate }}>
        Each square is a month; darker teal means more touchpoints (hours logged + notes added + tasks crossed off) that month — a quick way to spot a client who's gone quiet.
      </div>
      <div className="flex items-center gap-4 -mt-4 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: T.slateLight }}>Touchpoints:</span>
        {[["No activity", 0], ["1", 1], ["2–3", 2], ["4–5", 4], ["6+", 6]].map(([label, n]) => {
          const c = heatmapColor(n);
          return (
            <div key={label} className="flex items-center gap-1.5">
              <div style={{ width: 14, height: 14, borderRadius: 4, background: c.bg, opacity: c.opacity }} />
              <span className="text-xs" style={{ color: T.slate }}>{label}</span>
            </div>
          );
        })}
      </div>
      {groups.map((g) => {
        const groupTotal = g.list.reduce((sum, c) => {
          const counts = touchpointCounts(c, months, tasks);
          return sum + Object.values(counts).reduce((s, v) => s + v, 0);
        }, 0);
        return (
          <div key={g.profile}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ width: 8, height: 8, borderRadius: 999, background: T.tealDark }} />
              <div className="text-sm font-bold" style={{ color: T.ink }}>
                {g.profile} <span className="font-normal" style={{ color: T.slateLight }}>({g.list.length})</span>
              </div>
              {g.list.length > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1" style={{ color: T.tealDark, background: T.paperAlt }}>
                  {groupTotal} touchpoint{groupTotal === 1 ? "" : "s"} across group
                </span>
              )}
            </div>
            <Card style={{ padding: 16, overflowX: "auto" }}>
              {g.list.length === 0 ? (
                <div className="text-xs py-3" style={{ color: T.slateLight }}>No clients with this profile yet.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "160px repeat(12, minmax(28px, 1fr)) 56px", gap: 6, minWidth: 620 }}>
                  <div />
                  {months.map((m) => <div key={m} className="text-[10px] text-center font-semibold" style={{ color: T.slateLight }}>{monthLabel(m)}</div>)}
                  <div className="text-[10px] text-center font-semibold" style={{ color: T.slateLight }}>Total</div>
                  {g.list.map((c) => {
                    const counts = touchpointCounts(c, months, tasks);
                    const total = Object.values(counts).reduce((s, v) => s + v, 0);
                    return (
                      <React.Fragment key={c.id}>
                        <div className="text-xs font-medium py-1.5 truncate" style={{ color: T.ink }}>{c.name}</div>
                        {months.map((m) => {
                          const n = counts[m];
                          const hc = heatmapColor(n);
                          return (
                            <div key={m} className="flex items-center justify-center py-1.5">
                              <div title={`${c.name} — ${monthLabel(m)}: ${n} touchpoint${n === 1 ? "" : "s"}`}
                                style={{ width: 18, height: 18, borderRadius: 5, background: hc.bg, opacity: hc.opacity }} />
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-center py-1.5">
                          <span className="text-xs font-bold" style={{ color: total > 0 ? T.tealDark : T.slateLight }}>{total}</span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        );
      })}
      <div className="text-xs text-center" style={{ color: T.slateLight }}>
        Hover a square to see the exact count. Includes hours logged, notes added, and tasks crossed off for that client.
      </div>
    </div>
  );
}

// Simplified mobile screen: search for a client, then quickly log a note or a task with a
// due date and assignee. Built for field staff who just need to jot something down between
// jobs, without wading through the full desktop client view. "Full App" always stays one tap
// away for anyone who needs the deeper functionality while on a phone.
function MobileQuickView({ clients, currentUser, goToFullApp }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("note");
  const [noteText, setNoteText] = useState("");
  const [taskText, setTaskText] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [taskAssignee, setTaskAssignee] = useState(TEAM[0]);
  const [savedFlash, setSavedFlash] = useState(false);

  const client = clients.find((c) => c.id === selectedId);
  const q = search.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  const updateSelectedClient = (fn) => {
    if (!client) return;
    const updated = fn(client);
    const { id, ...fields } = updated;
    updateDoc(doc(db, "clients", client.id), fields);
  };

  const flash = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600); };

  const saveNote = () => {
    if (!noteText.trim() || !client) return;
    updateSelectedClient((c) => ({ ...c, notes: [...(c.notes || []), { id: Date.now(), author: currentUser || "You", date: today(), text: noteText.trim(), tags: [] }] }));
    setNoteText("");
    flash();
  };

  const saveTask = () => {
    if (!taskText.trim() || !taskDate || !client) return;
    updateSelectedClient((c) => ({ ...c, reminders: [...(c.reminders || []), { id: Date.now(), text: taskText.trim(), date: taskDate, recurring: "none", done: false, assignee: taskAssignee }] }));
    setTaskText(""); setTaskDate("");
    flash();
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: T.paper }}>
      <div className="flex items-center justify-between px-4 py-4 shrink-0" style={{ background: T.charcoal }}>
        <img src="/logo.png" alt="OSHE" style={{ height: 26, width: "auto" }} />
        <button onClick={goToFullApp} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.charcoalSoft, color: "#fff" }}>
          Full App
        </button>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
        {!client ? (
          <>
            <div className="text-base font-bold" style={{ color: T.ink }}>Select a client</div>
            <div className="relative">
              <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.slate }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients…"
                autoFocus
                className="w-full pl-9 pr-3 py-3 rounded-xl text-base outline-none"
                style={{ border: `1px solid ${T.border}`, background: T.card }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              {filtered.map((c) => (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className="text-left px-4 py-3.5 rounded-xl text-sm font-semibold flex items-center justify-between"
                  style={{ background: T.card, color: T.ink, border: `1px solid ${T.border}` }}>
                  {c.name}
                  <ChevronRight size={16} style={{ color: T.slateLight }} />
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-sm px-1 py-6 text-center" style={{ color: T.slate }}>No clients match "{search}"</div>
              )}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setSelectedId(null)} className="text-xs font-semibold self-start flex items-center gap-1" style={{ color: T.tealDark }}>
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Change client
            </button>
            <div className="text-xl font-bold" style={{ color: T.ink }}>{client.name}</div>

            <div className="flex gap-2 p-1 rounded-xl" style={{ background: T.paperAlt }}>
              <button onClick={() => setMode("note")}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
                style={{ background: mode === "note" ? T.card : "transparent", color: mode === "note" ? T.ink : T.slate }}>
                <StickyNote size={15} /> Note
              </button>
              <button onClick={() => setMode("task")}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
                style={{ background: mode === "task" ? T.card : "transparent", color: mode === "task" ? T.ink : T.slate }}>
                <ListTodo size={15} /> Task
              </button>
            </div>

            {mode === "note" ? (
              <div className="flex flex-col gap-3">
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={6}
                  placeholder="What's the update?"
                  className="w-full p-3 rounded-xl text-base outline-none resize-none"
                  style={{ border: `1px solid ${T.border}`, background: T.card }} />
                <button onClick={saveNote} disabled={!noteText.trim()}
                  className="py-3.5 rounded-xl text-sm font-bold" style={{ background: T.tealDark, color: "#fff", opacity: noteText.trim() ? 1 : 0.4 }}>
                  Save Note
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <input value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="What needs doing?"
                  className="w-full p-3 rounded-xl text-base outline-none" style={{ border: `1px solid ${T.border}`, background: T.card }} />
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Due date</div>
                <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)}
                  className="w-full p-3 rounded-xl text-base outline-none" style={{ border: `1px solid ${T.border}`, background: T.card }} />
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Assignee</div>
                <select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}
                  className="w-full p-3 rounded-xl text-base outline-none" style={{ border: `1px solid ${T.border}`, background: T.card }}>
                  {TEAM.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <button onClick={saveTask} disabled={!taskText.trim() || !taskDate}
                  className="py-3.5 rounded-xl text-sm font-bold" style={{ background: T.tealDark, color: "#fff", opacity: (taskText.trim() && taskDate) ? 1 : 0.4 }}>
                  Save Task
                </button>
              </div>
            )}

            {savedFlash && (
              <div className="text-sm font-bold text-center py-2.5 rounded-xl flex items-center justify-center gap-1.5" style={{ background: "#E4F8F5", color: T.tealDark }}>
                <Check size={15} /> Saved
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


/* ---------- Monthly Report Generator (groundwork) ----------
   Compiles a monthly H&S report per client: a list of named sections, each optionally
   backed by a CSV dropped in from the OSHE app (parsed to a preview table) plus a free-text
   comment/narrative for that section — matching the shape of the real OSHE monthly reports
   (e.g. "Incidents and Near Misses" pairs a data table with an Outcome Breakdown narrative;
   "Toolbox Talks" pairs a facilitator count with a Notes paragraph).

   This is intentionally just the compiling/editing groundwork — no branded PDF export yet.
   Two starter templates are offered, mirroring the two real report shapes seen so far:
   a consultancy-style client (Highlights, Incidents & Near Misses, Hui & Meetings, Trends,
   Recommended Actions) and a construction-site client (Toolbox Talks, Permits, Site Reviews
   & Observations, Incidents & Near Misses, Task Analyses, Sign-In & Visitor Log, Corrective
   Actions). Add more templates here as real examples come in. */
// Starter data only — seeded into the "reportTemplates" Firestore collection once, the
// first time it's empty. After that, templates are edited live in the app (see the
// "Manage templates" panel in ReportsView) — this constant is never read again.
const initialReportTemplates = [
  {
    id: "tmpl-consultancy", name: "Consultancy client (e.g. Manaaki Ora Trust style)",
    sections: ["Highlights", "Incidents and Near Misses", "Hui and Health & Safety Meetings", "Trends and Observations", "Recommended Actions"],
  },
  {
    id: "tmpl-construction", name: "Construction site client (e.g. BMC style)",
    sections: ["Toolbox Talks", "Permits", "Site Reviews & Observations", "Incidents & Near Misses", "Task Analyses", "Sign-In & Visitor Log", "Corrective Actions"],
  },
  {
    id: "tmpl-weekly", name: "Weekly reporting",
    sections: ["Toolbox Talks", "Incidents & Near Misses", "Site Activity", "Actions for Next Week"],
  },
];

// Minimal dependency-free CSV parser — handles quoted fields (including embedded commas
// and escaped "" quotes) since OSHE app exports are likely to have commas inside free-text
// fields like incident descriptions.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return { headers: [], data: [] };
  const [headers, ...data] = rows;
  return { headers, data };
}

function reportKey(clientId, monthYear) { return `${clientId}__${monthYear}`; }


function currentMonthYear() { return today().slice(0, 7); }

function monthYearLabel(monthYear) { return new Date(monthYear + "-02").toLocaleDateString("en-NZ", { month: "long", year: "numeric" }); }

function truncateToWidth(text, font, size, width) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
  return t + "…";
}

// Suggested CSV column shapes for the section titles that come out of the built-in
// starter templates, keyed lowercase so custom-cased titles still match. Anything not
// in here (custom sections) just gets a generic "any CSV works" note — first row is always
// treated as headers regardless.
const SECTION_CSV_GUIDE = {
  "toolbox talks": ["Date", "Facilitator", "Topic"],
  "permits": ["Permit Type", "Date/Time", "Site", "Applicant / Company", "Description of Works"],
  "site reviews & observations": ["Date", "Site", "Reviewer", "Observation", "Action Taken"],
  "incidents & near misses": ["Date/Time", "Location", "Type", "Outcome", "Notifiable"],
  "incidents and near misses": ["Date", "Event Description", "Type", "Outcome"],
  "task analyses": ["Site", "Date", "Task Type", "Hazards Identified", "Created By"],
  "sign-in & visitor log": ["Date", "Site", "Sign-Ins", "Inductions"],
  "corrective actions": ["Action", "Assigned To", "Linked Report", "Status"],
  "hui and health & safety meetings": ["Meeting Type", "Service / Ropu", "Date", "Venue", "Next Meeting"],
  "trends and observations": ["Theme", "Description"],
  "recommended actions": ["Priority", "Recommendation", "Detail"],
  "site activity": ["Date", "Site", "Activity", "Notes"],
  "actions for next week": ["Action", "Assigned To", "Due Date"],
};
function guideForSection(title) { return SECTION_CSV_GUIDE[(title || "").trim().toLowerCase()] || null; }

// --- Chart helpers, used only by downloadMonthlyReportPdf ---
const CHART_COLORS_RGB = [
  [0.04, 0.68, 0.63], [0.06, 0.20, 0.16], [0.85, 0.62, 0.20], [0.55, 0.55, 0.58],
  [0.36, 0.78, 0.72], [0.78, 0.38, 0.38], [0.50, 0.40, 0.70], [0.32, 0.55, 0.80],
];
// Group csvData by categoryColumn's values. If valueColumn is given, sums that column's
// numbers per category (for CSVs that are already pre-aggregated, e.g. one row per
// facilitator with a "Talks" count) — otherwise just counts rows per category (for raw
// registers, e.g. one row per incident, grouped by "Type").
function computeChartData(csvData, headers, categoryColumn, valueColumn) {
  const catIdx = headers.indexOf(categoryColumn);
  if (catIdx === -1) return [];
  const valIdx = valueColumn ? headers.indexOf(valueColumn) : -1;
  const totals = {};
  csvData.forEach((row) => {
    const cat = (row[catIdx] || "").toString().trim() || "(blank)";
    let amount = 1;
    if (valIdx !== -1) {
      const n = parseFloat(String(row[valIdx] || "").replace(/[^0-9.-]/g, ""));
      amount = isNaN(n) ? 0 : n;
    }
    totals[cat] = (totals[cat] || 0) + amount;
  });
  return Object.entries(totals).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
// pdf-lib's drawSvgPath flips the path's Y axis internally (SVG is y-down, pdf-lib is
// y-up) — negating y here and always anchoring at (0,0) cancels that flip out, so path
// points can just be normal absolute PDF (y-up) coordinates like every other drawing call.
function svgPathFromPoints(points, close) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x},${-y}`).join(" ") + (close ? " Z" : "");
}
function pieSlicePoints(cx, cy, r, angleStart, angleEnd) {
  const steps = Math.max(2, Math.ceil((angleEnd - angleStart) / (Math.PI / 24)));
  const points = [[cx, cy]];
  for (let i = 0; i <= steps; i++) {
    const a = angleStart + (angleEnd - angleStart) * (i / steps);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

// Builds the branded monthly report PDF: an Executive Summary strip of big highlight
// numbers (one per section, auto-computed from that section's CSV row count unless a
// manual override was entered), then each section as a real table from its CSV data
// followed by its comment/narrative — matching the shape of the real OSHE monthly reports
// (numbers-grid header, charcoal section bars, table + narrative pairing per section).
// Builds a simple usage statement for one reseller — their clients and how many users each
// had that month — so they've got something concrete to work from for their own billing.
async function downloadResellerPdf({ reseller, monthYear, usersForMonth }) {
  reseller = { ...reseller, name: sanitizeForPdf(reseller.name), clients: (reseller.clients || []).map((c) => ({ ...c, name: sanitizeForPdf(c.name) })) };
  const { PDFDocument, StandardFonts, rgb } = await importWithReloadOnStaleChunk(() => import("pdf-lib"));
  const ink = rgb(0.08, 0.14, 0.13);
  const slate = rgb(0.36, 0.45, 0.45);
  const teal = rgb(0.04, 0.68, 0.63);
  const charcoal = rgb(0.06, 0.20, 0.16);
  const pageWidth = 595, pageHeight = 842, margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const bandHeight = 74;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const monthLbl = monthYear === currentMonth() ? monthLabel(currentMonth()) : monthLabel(monthYear);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: charcoal });
  page.drawText("RESELLER CLIENT USAGE", { x: margin, y: pageHeight - 30, size: 9, font: boldFont, color: teal });
  page.drawText(`${reseller.name} — ${monthLbl}`, { x: margin, y: pageHeight - 52, size: 16, font: boldFont, color: rgb(1, 1, 1) });

  let y = pageHeight - bandHeight - 40;
  const rows = reseller.clients.map((c) => ({ name: c.name, users: usersForMonth(c, monthYear) }));
  const totalUsers = rows.reduce((s, r) => s + r.users, 0);

  page.drawText(`${rows.length} client${rows.length === 1 ? "" : "s"} · ${totalUsers} total user${totalUsers === 1 ? "" : "s"} to bill`, { x: margin, y, size: 11, font, color: slate });
  y -= 34;

  const colWidths = [maxWidth - 140, 140];
  page.drawRectangle({ x: margin, y: y - 22, width: maxWidth, height: 22, color: rgb(0.93, 0.96, 0.95) });
  page.drawText("Client", { x: margin + 8, y: y - 16, size: 9, font: boldFont, color: teal });
  page.drawText("Users", { x: margin + colWidths[0] + 8, y: y - 16, size: 9, font: boldFont, color: teal });
  y -= 22;

  rows.forEach((r, i) => {
    if (y < margin + 40) { page = pdfDoc.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
    const rowH = 22;
    if (i % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH, width: maxWidth, height: rowH, color: rgb(0.97, 0.98, 0.98) });
    page.drawText(r.name, { x: margin + 8, y: y - rowH + 7, size: 10, font, color: ink });
    page.drawText(String(r.users), { x: margin + colWidths[0] + 8, y: y - rowH + 7, size: 10, font: boldFont, color: teal });
    page.drawLine({ start: { x: margin, y: y - rowH }, end: { x: margin + maxWidth, y: y - rowH }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
    y -= rowH;
  });

  const pageCount = pdfDoc.getPageCount();
  for (let p = 0; p < pageCount; p++) {
    const pg = pdfDoc.getPage(p);
    pg.drawText(`Prepared by OSHE Limited for ${reseller.name} — ${monthLbl}`, { x: margin, y: 24, size: 8, font, color: slate });
  }

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilenamePart(reseller.name)} Usage ${monthYear}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadMonthlyReportPdf({ client, monthYear, sections, highlights, focusNextMonth, createdBy }) {
  client = { ...client, name: sanitizeForPdf(client.name), legalName: sanitizeForPdf(client.legalName) };
  sections = (sections || []).map((s) => ({
    ...s,
    title: sanitizeForPdf(s.title),
    comment: sanitizeForPdf(s.comment),
    highlightLabel: sanitizeForPdf(s.highlightLabel),
    csvHeaders: sanitizeArrayForPdf(s.csvHeaders),
    csvData: (s.csvData || []).map((row) => sanitizeArrayForPdf(row)),
  }));
  highlights = sanitizeForPdf(highlights);
  focusNextMonth = sanitizeForPdf(focusNextMonth);
  createdBy = sanitizeForPdf(createdBy);
  const { PDFDocument, StandardFonts, rgb } = await importWithReloadOnStaleChunk(() => import("pdf-lib"));
  const ink = rgb(0.08, 0.14, 0.13);
  const slate = rgb(0.36, 0.45, 0.45);
  const teal = rgb(0.04, 0.68, 0.63);
  const charcoal = rgb(0.06, 0.20, 0.16);
  const pageWidth = 595, pageHeight = 842, margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const bandHeight = 74;
  const chartColors = CHART_COLORS_RGB.map(([r, g, b]) => rgb(r, g, b));

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await loadClientLogoImage(client, pdfDoc);
  const monthLabel = monthYearLabel(monthYear);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  const drawHeader = (pg) => {
    pg.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: charcoal });
    if (logoImage) {
      const maxLogoH = 30, maxLogoW = 100;
      const scale = Math.min(maxLogoH / logoImage.height, maxLogoW / logoImage.width, 1);
      const w = logoImage.width * scale, h = logoImage.height * scale;
      pg.drawImage(logoImage, { x: pageWidth - margin - w, y: pageHeight - bandHeight / 2 - h / 2, width: w, height: h });
    }
    pg.drawText("HEALTH & SAFETY MONTHLY REPORT", { x: margin, y: pageHeight - 30, size: 9, font: boldFont, color: teal });
    pg.drawText(`${client.name} — ${monthLabel}`, { x: margin, y: pageHeight - 52, size: 16, font: boldFont, color: rgb(1, 1, 1) });
  };
  drawHeader(page);
  let y = pageHeight - bandHeight - 30;
  const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); drawHeader(page); y = pageHeight - bandHeight - 30; };
  const ensureSpace = (needed) => { if (y - needed < margin + 20) newPage(); };

  // --- Executive Summary: a grid of big numbers, one per section that has one (auto row
  // count, or a manual override for sections where row count isn't the right metric). ---
  const highlightItems = sections.map((s) => {
    const num = (s.highlightNumber || "").trim() || (s.csvData?.length ? String(s.csvData.length) : null);
    if (num == null) return null;
    return { num, label: (s.highlightLabel || "").trim() || s.title };
  }).filter(Boolean);

  if (highlightItems.length > 0) {
    const perRow = Math.min(5, highlightItems.length);
    const cardW = maxWidth / perRow;
    const rows = Math.ceil(highlightItems.length / perRow);
    ensureSpace(46 + rows * 64);
    page.drawText("EXECUTIVE SUMMARY", { x: margin, y, size: 12, font: boldFont, color: teal });
    y -= 10;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
    y -= 30;
    const rowTop = y;
    highlightItems.forEach((h, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const cx = margin + col * cardW, cardY = rowTop - row * 64;
      const numSize = 22;
      const numW = boldFont.widthOfTextAtSize(h.num, numSize);
      page.drawText(h.num, { x: cx + (cardW - numW) / 2, y: cardY, size: numSize, font: boldFont, color: teal });
      wrapTextLines(h.label, font, 8, cardW - 10).slice(0, 2).forEach((line, li) => {
        const lw = font.widthOfTextAtSize(line, 8);
        page.drawText(line, { x: cx + (cardW - lw) / 2, y: cardY - 16 - li * 10, size: 8, font, color: slate });
      });
    });
    y = rowTop - rows * 64 - 10;
  }

  // --- Highlights / Focus for Next Month: two boxes side by side, bullet-aware text
  // (a line starting with "• " renders as a bullet), matching the real reports' two-column
  // Highlights/Focus Areas layout. Either box is skipped if it has no content. ---
  const drawBulletLines = (pg, text, x, startY, width, size) => {
    let yy = startY;
    text.split("\n").forEach((seg) => {
      if (seg.trim() === "") return;
      const isBullet = seg.trim().startsWith("• ");
      const clean = isBullet ? seg.trim().slice(2) : seg;
      const effWidth = isBullet ? width - 12 : width;
      wrapTextLines(clean, font, size, effWidth).forEach((line, i) => {
        if (isBullet && i === 0) { pg.drawText("•", { x, y: yy, size, font, color: ink }); pg.drawText(line, { x: x + 12, y: yy, size, font, color: ink }); }
        else if (isBullet) pg.drawText(line, { x: x + 12, y: yy, size, font, color: ink });
        else pg.drawText(line, { x, y: yy, size, font, color: ink });
        yy -= size + 4;
      });
    });
    return yy;
  };
  const hasHighlights = (highlights || "").trim().length > 0;
  const hasFocus = (focusNextMonth || "").trim().length > 0;
  if (hasHighlights || hasFocus) {
    const colGap = 20, boxW = hasHighlights && hasFocus ? (maxWidth - colGap) / 2 : maxWidth;
    // Measure both boxes' content height up front so they can share one boundary/ensureSpace
    // check — otherwise one box could start a fresh page while the other stays behind.
    const measureH = (text) => {
      let lines = 0;
      (text || "").split("\n").forEach((seg) => {
        if (seg.trim() === "") return;
        const isBullet = seg.trim().startsWith("• ");
        const clean = isBullet ? seg.trim().slice(2) : seg;
        lines += wrapTextLines(clean, font, 9.5, boxW - 24 - (isBullet ? 12 : 0)).length;
      });
      return 34 + lines * 13.5;
    };
    const blockH = Math.max(hasHighlights ? measureH(highlights) : 0, hasFocus ? measureH(focusNextMonth) : 0);
    ensureSpace(blockH + 10);
    const boxTop = y;
    if (hasHighlights) {
      page.drawRectangle({ x: margin, y: boxTop - blockH, width: boxW, height: blockH, color: rgb(0.96, 0.98, 0.97) });
      page.drawText("HIGHLIGHTS", { x: margin + 12, y: boxTop - 20, size: 10, font: boldFont, color: teal });
      drawBulletLines(page, highlights.trim(), margin + 12, boxTop - 38, boxW - 24, 9.5);
    }
    if (hasFocus) {
      const fx = hasHighlights ? margin + boxW + colGap : margin;
      page.drawRectangle({ x: fx, y: boxTop - blockH, width: boxW, height: blockH, color: rgb(0.96, 0.98, 0.97) });
      page.drawText(`FOCUS FOR NEXT MONTH`, { x: fx + 12, y: boxTop - 20, size: 10, font: boldFont, color: teal });
      drawBulletLines(page, focusNextMonth.trim(), fx + 12, boxTop - 38, boxW - 24, 9.5);
    }
    y = boxTop - blockH - 20;
  }

  // --- Each section: charcoal heading bar, table from its CSV (if any), then narrative. ---
  sections.forEach((s) => {
    ensureSpace(22 + 14);
    page.drawRectangle({ x: margin, y: y - 22, width: maxWidth, height: 22, color: charcoal });
    page.drawText(s.title.toUpperCase(), { x: margin + 8, y: y - 16, size: 10, font: boldFont, color: rgb(1, 1, 1) });
    y -= 22 + 14;

    const showTable = s.showTable !== false;
    if (s.csvHeaders?.length > 0 && showTable) {
      const colCount = s.csvHeaders.length;
      const colW = maxWidth / colCount;
      const rowH = 18;
      ensureSpace(rowH);
      page.drawRectangle({ x: margin, y: y - rowH, width: maxWidth, height: rowH, color: rgb(0.93, 0.96, 0.95) });
      s.csvHeaders.forEach((h, ci) => {
        page.drawText(truncateToWidth(h, boldFont, 8, colW - 8), { x: margin + ci * colW + 4, y: y - rowH + 6, size: 8, font: boldFont, color: teal });
      });
      y -= rowH;
      s.csvData.forEach((row, ri) => {
        ensureSpace(rowH);
        if (ri % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH, width: maxWidth, height: rowH, color: rgb(0.97, 0.98, 0.98) });
        row.slice(0, colCount).forEach((cell, ci) => {
          page.drawText(truncateToWidth(String(cell || ""), font, 8, colW - 8), { x: margin + ci * colW + 4, y: y - rowH + 6, size: 8, font, color: ink });
        });
        page.drawLine({ start: { x: margin, y: y - rowH }, end: { x: margin + maxWidth, y: y - rowH }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
        y -= rowH;
      });
      y -= 10;
    }

    if (s.chartType && s.chartType !== "none" && s.chartColumn && s.csvHeaders?.length > 0) {
      const counts = computeChartData(s.csvData, s.csvHeaders, s.chartColumn, s.chartValueColumn);
      if (counts.length > 0) {
        if (s.chartType === "bar") {
          const capped = counts.slice(0, 8);
          const barH = 14, gap = 8, labelW = 150;
          const barAreaW = maxWidth - labelW - 40;
          const maxCount = Math.max(...capped.map((d) => d.count), 1);
          ensureSpace(capped.length * (barH + gap) + 10);
          capped.forEach((d, i) => {
            const w = Math.max(2, (d.count / maxCount) * barAreaW);
            page.drawText(truncateToWidth(d.label, font, 8, labelW - 6), { x: margin, y: y - barH + 4, size: 8, font, color: ink });
            page.drawRectangle({ x: margin + labelW, y: y - barH, width: w, height: barH - 3, color: chartColors[i % chartColors.length] });
            page.drawText(String(d.count), { x: margin + labelW + w + 6, y: y - barH + 4, size: 8, font: boldFont, color: ink });
            y -= barH + gap;
          });
          y -= 6;
        } else if (s.chartType === "pie") {
          const r = 55;
          const capped = counts.slice(0, 7);
          const other = counts.slice(7).reduce((sum, d) => sum + d.count, 0);
          const wedges = other > 0 ? [...capped, { label: "Other", count: other }] : capped;
          const total = wedges.reduce((sum, d) => sum + d.count, 0) || 1;
          ensureSpace(r * 2 + 20);
          const cx = margin + r + 10, cyCenter = y - r - 5;
          let angle = -Math.PI / 2;
          wedges.forEach((d, i) => {
            const sweep = (d.count / total) * Math.PI * 2;
            page.drawSvgPath(svgPathFromPoints(pieSlicePoints(cx, cyCenter, r, angle, angle + sweep), true), { color: chartColors[i % chartColors.length], x: 0, y: 0, borderWidth: 0 });
            angle += sweep;
          });
          let ly = y - 6;
          const legendX = margin + r * 2 + 40;
          wedges.forEach((d, i) => {
            const pct = Math.round((d.count / total) * 100);
            page.drawRectangle({ x: legendX, y: ly - 8, width: 8, height: 8, color: chartColors[i % chartColors.length] });
            page.drawText(truncateToWidth(`${d.label} — ${d.count} (${pct}%)`, font, 8, maxWidth - (legendX - margin) - 10), { x: legendX + 14, y: ly - 8, size: 8, font, color: ink });
            ly -= 14;
          });
          y = Math.min(cyCenter - r, ly) - 14;
        }
      }
    }

    if (s.comment?.trim()) {
      wrapTextLines(s.comment.trim(), font, 9.5, maxWidth).forEach((line) => {
        ensureSpace(13);
        page.drawText(line, { x: margin, y, size: 9.5, font, color: ink });
        y -= 13;
      });
      y -= 6;
    }

    if (!(s.csvHeaders?.length > 0) && !s.comment?.trim()) {
      page.drawText("No data or notes added yet for this section.", { x: margin, y, size: 9, font, color: slate });
      y -= 16;
    }

    y -= 20;
  });

  // --- Sign-off: left is OSHE's side, filled in automatically (who built it, generation
  // date); right is the client's side, left blank for them to sign. ---
  ensureSpace(110);
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.75, color: rgb(0.85, 0.85, 0.85) });
  y -= 26;
  const colGap = 30, colW2 = (maxWidth - colGap) / 2;
  const createdX = margin, reviewedX = margin + colW2 + colGap;
  page.drawText("Created by", { x: createdX, y, size: 9, font: boldFont, color: ink });
  page.drawText(`Name  ${createdBy || ""}`, { x: createdX, y: y - 20, size: 8, font, color: slate });
  page.drawText("Title  Health & Safety Consultant", { x: createdX, y: y - 36, size: 8, font, color: slate });
  page.drawText(`Date  ${fmtDate(today())}`, { x: createdX, y: y - 52, size: 8, font, color: slate });

  page.drawText("Reviewed by", { x: reviewedX, y, size: 9, font: boldFont, color: ink });
  page.drawText("Name  _______________________________", { x: reviewedX, y: y - 20, size: 8, font, color: slate });
  page.drawText("Title  _______________________________", { x: reviewedX, y: y - 36, size: 8, font, color: slate });
  page.drawText("Date  _______________________________", { x: reviewedX, y: y - 52, size: 8, font, color: slate });

  const pageCount = pdfDoc.getPageCount();
  for (let p = 0; p < pageCount; p++) {
    const pg = pdfDoc.getPage(p);
    pg.drawText(`Prepared by OSHE Limited for ${client.name} — ${monthLabel}`, { x: margin, y: 24, size: 8, font, color: slate });
    const pageText = `Page ${p + 1} of ${pageCount}`;
    const pw = font.widthOfTextAtSize(pageText, 8);
    pg.drawText(pageText, { x: pageWidth - margin - pw, y: 24, size: 8, font, color: slate });
  }

  const bytes = await pdfDoc.save();
  const reportFilename = `${safeFilenamePart(client.name)} Monthly Report ${monthYear}.pdf`;
  saveGeneratedDocument(client, bytes, reportFilename, "Monthly Report");
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportsView({ clients, reportTemplates, addReportTemplate, renameReportTemplate, deleteReportTemplate, addTemplateSection, removeTemplateSection }) {
  const [selectedId, setSelectedId] = useState(clients[0]?.id || "");
  const client = clients.find((c) => c.id === selectedId) || clients[0];
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [sections, setSections] = useState([]);
  const [highlights, setHighlights] = useState("");
  const [focusNextMonth, setFocusNextMonth] = useState("");
  const [showHighlights, setShowHighlights] = useState(true);
  const [createdBy, setCreatedBy] = useState(TEAM[0]);
  const [loaded, setLoaded] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [csvChecklistOpen, setCsvChecklistOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateSectionDrafts, setNewTemplateSectionDrafts] = useState({});

  useEffect(() => {
    if (!client) return;
    setLoaded(false);
    const key = reportKey(client.id, monthYear);
    getDoc(doc(db, "monthlyReports", key))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : {};
        setSections(data.sections || []);
        setHighlights(data.highlights || "");
        setFocusNextMonth(data.focusNextMonth || "");
        setCreatedBy(data.createdBy || TEAM[0]);
        setShowHighlights(data.showHighlights !== false);
      })
      .catch((err) => console.error("Couldn't load monthly report:", err))
      .finally(() => setLoaded(true));
  }, [client?.id, monthYear]);

  // Generic persist: pass whichever of {sections, highlights, focusNextMonth, createdBy}
  // changed, the rest come from current state, and the whole doc gets written together so
  // nothing races.
  const persist = (patch) => {
    const nextSections = patch.sections !== undefined ? patch.sections : sections;
    const nextHighlights = patch.highlights !== undefined ? patch.highlights : highlights;
    const nextFocus = patch.focusNextMonth !== undefined ? patch.focusNextMonth : focusNextMonth;
    const nextCreatedBy = patch.createdBy !== undefined ? patch.createdBy : createdBy;
    const nextShowHighlights = patch.showHighlights !== undefined ? patch.showHighlights : showHighlights;
    if (patch.sections !== undefined) setSections(nextSections);
    if (patch.highlights !== undefined) setHighlights(nextHighlights);
    if (patch.focusNextMonth !== undefined) setFocusNextMonth(nextFocus);
    if (patch.createdBy !== undefined) setCreatedBy(nextCreatedBy);
    if (patch.showHighlights !== undefined) setShowHighlights(nextShowHighlights);
    if (!client) return;
    setDoc(doc(db, "monthlyReports", reportKey(client.id, monthYear)), {
      clientId: client.id, clientName: client.name, monthYear,
      sections: nextSections, highlights: nextHighlights, focusNextMonth: nextFocus, createdBy: nextCreatedBy, showHighlights: nextShowHighlights, updatedAt: today(),
    });
  };
  const save = (nextSections) => persist({ sections: nextSections });

  const applyTemplate = (templateId) => {
    const tmpl = reportTemplates.find((t) => t.id === templateId);
    const titles = tmpl?.sections || [];
    save(titles.map((title) => ({ id: "sec" + Date.now() + Math.random().toString(36).slice(2, 6), title, comment: "", csvFileName: null, csvHeaders: [], csvData: [], highlightNumber: "", highlightLabel: "", chartType: "none", chartColumn: "", chartValueColumn: "", showTable: true })));
  };

  const addSection = () => {
    if (!newSectionTitle.trim()) return;
    save([...sections, { id: "sec" + Date.now(), title: newSectionTitle.trim(), comment: "", csvFileName: null, csvHeaders: [], csvData: [], highlightNumber: "", highlightLabel: "", chartType: "none", chartColumn: "", chartValueColumn: "", showTable: true }]);
    setNewSectionTitle("");
  };

  const removeSection = (id) => save(sections.filter((s) => s.id !== id));
  const updateSection = (id, fields) => save(sections.map((s) => (s.id === id ? { ...s, ...fields } : s)));

  const handleCsvUpload = async (id, file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      try {
        const XLSX = await importWithReloadOnStaleChunk(() => import("xlsx"));
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
        const headers = (rows[0] || []).map((h) => String(h));
        const data = rows.slice(1)
          .filter((row) => row.some((v) => String(v ?? "").trim() !== ""))
          .map((row) => headers.map((_, i) => String(row[i] ?? "")));
        updateSection(id, { csvFileName: file.name, csvHeaders: headers, csvData: data });
      } catch (err) {
        console.error("Excel import failed:", err);
        alert(`Couldn't read that Excel file: ${err.message || err}`);
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, data } = parseCsv(String(e.target.result || ""));
      updateSection(id, { csvFileName: file.name, csvHeaders: headers, csvData: data });
    };
    reader.readAsText(file);
  };

  if (!client) return <div className="text-sm" style={{ color: T.slate }}>No clients yet — add one on the Clients tab first.</div>;
  const monthLabel = monthYearLabel(monthYear);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-y-auto">
      <Card style={{ padding: "14px 16px" }}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Client</div>
            <select value={client.id} onChange={(e) => setSelectedId(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Month</div>
            <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Created by</div>
            <select value={createdBy} onChange={(e) => persist({ createdBy: e.target.value })}
              className="text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
              {TEAM.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Start from a template</div>
            <select defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); e.target.value = ""; }}
              className="text-sm px-3 py-2 rounded-lg outline-none" style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
              <option value="">Choose a template…</option>
              {reportTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card style={{ padding: "10px 16px" }}>
        <button onClick={() => setTemplatesOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Manage templates ({reportTemplates.length})</span>
          <ChevronDown size={14} color={T.slateLight} style={{ transform: templatesOpen ? "rotate(180deg)" : "none" }} />
        </button>
        {templatesOpen && (
          <div className="flex flex-col gap-3 mt-3">
            {reportTemplates.map((t) => (
              <div key={t.id} className="rounded-lg p-3" style={{ background: T.paperAlt }}>
                <div className="flex items-center gap-2 mb-2">
                  <input value={t.name} onChange={(e) => renameReportTemplate(t.id, e.target.value)}
                    className="flex-1 text-sm font-semibold px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, background: T.card }} />
                  <ConfirmButton onConfirm={() => deleteReportTemplate(t.id)} title="Delete template" iconSize={14} />
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {t.sections.map((s) => (
                    <span key={s} className="text-xs px-2 py-1 rounded-full flex items-center gap-1.5" style={{ background: T.card, color: T.ink }}>
                      {s}
                      <button onClick={() => removeTemplateSection(t.id, s)} title="Remove section from template" style={{ color: T.slateLight }}>×</button>
                    </span>
                  ))}
                  {t.sections.length === 0 && <span className="text-xs" style={{ color: T.slateLight }}>No sections yet — add one below.</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <input value={newTemplateSectionDrafts[t.id] || ""} onChange={(e) => setNewTemplateSectionDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                    placeholder="New section name…" onKeyDown={(e) => { if (e.key === "Enter") { addTemplateSection(t.id, newTemplateSectionDrafts[t.id] || ""); setNewTemplateSectionDrafts((d) => ({ ...d, [t.id]: "" })); } }}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, background: T.card }} />
                  <button onClick={() => { addTemplateSection(t.id, newTemplateSectionDrafts[t.id] || ""); setNewTemplateSectionDrafts((d) => ({ ...d, [t.id]: "" })); }}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>Add</button>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1">
              <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="New template name…"
                onKeyDown={(e) => { if (e.key === "Enter") { addReportTemplate(newTemplateName); setNewTemplateName(""); } }}
                className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              <button onClick={() => { addReportTemplate(newTemplateName); setNewTemplateName(""); }}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0 flex items-center gap-1" style={{ background: T.tealDark, color: "#fff" }}>
                <Plus size={12} /> New template
              </button>
            </div>
          </div>
        )}
      </Card>

      {sections.length > 0 && (
        <Card style={{ padding: "10px 16px" }}>
          <button onClick={() => setCsvChecklistOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>
              Data needed for {monthLabel} ({sections.filter((s) => s.csvHeaders?.length > 0).length}/{sections.length} uploaded)
            </span>
            <ChevronDown size={14} color={T.slateLight} style={{ transform: csvChecklistOpen ? "rotate(180deg)" : "none" }} />
          </button>
          {csvChecklistOpen && (
            <div className="flex flex-col gap-1.5 mt-2">
              {sections.map((s) => {
                const guide = guideForSection(s.title);
                const has = s.csvHeaders?.length > 0;
                return (
                  <div key={s.id} className="flex items-start gap-2 text-xs py-1" style={{ borderBottom: `1px solid ${T.border}` }}>
                    {has ? <CheckCircle2 size={14} color={T.tealDark} className="shrink-0 mt-0.5" /> : <Circle size={14} color={T.slateLight} className="shrink-0 mt-0.5" />}
                    <div>
                      <span className="font-semibold" style={{ color: T.ink }}>{s.title} for {monthLabel}</span>
                      {has ? (
                        <span style={{ color: T.slateLight }}> — uploaded, {s.csvData.length} row{s.csvData.length === 1 ? "" : "s"}</span>
                      ) : (
                        <span style={{ color: T.coral }}> — needed</span>
                      )}
                      <div style={{ color: T.slateLight }}>
                        {guide ? `Suggested columns: ${guide.join(", ")}` : "Any CSV or Excel file works — the first row is treated as column headers."}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Highlights / Focus for next month</div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: T.slate }}>
          <input type="checkbox" checked={showHighlights} onChange={(e) => persist({ showHighlights: e.target.checked })} />
          {showHighlights ? "On — included in this report" : "Off — doesn't make sense for weekly reports, for example"}
        </label>
      </div>
      {showHighlights && (
        <div className="grid grid-cols-2 gap-4">
          <Card style={{ padding: 16 }}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Highlights this month</div>
            <textarea value={highlights} onChange={(e) => persist({ highlights: e.target.value })} rows={4}
              placeholder={"What went well this month? Start a line with \"• \" for a bullet point."}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          </Card>
          <Card style={{ padding: 16 }}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Focus for next month</div>
            <textarea value={focusNextMonth} onChange={(e) => persist({ focusNextMonth: e.target.value })} rows={4}
              placeholder={"What's the priority for next month? Start a line with \"• \" for a bullet point."}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
          </Card>
        </div>
      )}

      {!loaded ? (
        <div className="text-sm" style={{ color: T.slateLight }}>Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.length === 0 && (
            <Card style={{ padding: 20 }}>
              <div className="text-sm" style={{ color: T.slate }}>
                No sections yet for {client.name} — {monthYear}. Pick a template above to start, or add sections manually below.
              </div>
            </Card>
          )}
          {sections.map((s) => (
            <Card key={s.id} style={{ padding: 16 }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <input value={s.title} onChange={(e) => updateSection(s.id, { title: e.target.value })}
                  className="text-sm font-bold flex-1 outline-none px-1 py-0.5 rounded" style={{ color: T.tealDark, background: "transparent" }} />
                <button onClick={() => removeSection(s.id)} title="Remove section"><Trash2 size={15} color={T.slateLight} /></button>
              </div>

              <div className="flex items-center gap-3 mb-3">
                <label className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5" style={{ background: T.paperAlt, color: T.tealDark }}>
                  <Upload size={13} /> {s.csvFileName ? "Replace file" : "Drop in CSV or Excel"}
                  <input type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={(e) => handleCsvUpload(s.id, e.target.files?.[0])} />
                </label>
                {s.csvFileName && (
                  <span className="text-xs" style={{ color: T.slateLight }}>{s.csvFileName} — {s.csvData?.length || 0} row{s.csvData?.length === 1 ? "" : "s"}</span>
                )}
              </div>

              {s.csvHeaders?.length > 0 && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: T.slate }}>
                    <input type="checkbox" checked={s.showTable !== false} onChange={(e) => updateSection(s.id, { showTable: e.target.checked })} />
                    Show data table
                  </label>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.slateLight }}>Chart</div>
                    <select value={s.chartType || "none"} onChange={(e) => updateSection(s.id, { chartType: e.target.value })}
                      className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                      <option value="none">No chart</option>
                      <option value="bar">Bar chart</option>
                      <option value="pie">Pie chart</option>
                    </select>
                  </div>
                  {s.chartType && s.chartType !== "none" && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.slateLight }}>Column to chart</div>
                      <select value={s.chartColumn || ""} onChange={(e) => updateSection(s.id, { chartColumn: e.target.value })}
                        className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                        <option value="">Choose column…</option>
                        {s.csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  )}
                  {s.chartType && s.chartType !== "none" && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.slateLight }}>Value (optional, sums numbers)</div>
                      <select value={s.chartValueColumn || ""} onChange={(e) => updateSection(s.id, { chartValueColumn: e.target.value })}
                        className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }}>
                        <option value="">Count rows</option>
                        {s.csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.slateLight }}>Highlight number</div>
                  <input value={s.highlightNumber || ""} onChange={(e) => updateSection(s.id, { highlightNumber: e.target.value })}
                    placeholder={s.csvData?.length ? `auto: ${s.csvData.length}` : "e.g. 11"}
                    className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.slateLight }}>Highlight label</div>
                  <input value={s.highlightLabel || ""} onChange={(e) => updateSection(s.id, { highlightLabel: e.target.value })}
                    placeholder={s.title}
                    className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                </div>
              </div>

              {s.csvHeaders?.length > 0 && (
                <div className="overflow-x-auto mb-3 rounded-lg" style={{ border: `1px solid ${T.border}` }}>
                  <table className="text-xs w-full">
                    <thead>
                      <tr style={{ background: T.paperAlt }}>
                        {s.csvHeaders.map((h, i) => <th key={i} className="text-left px-2 py-1.5 font-semibold" style={{ color: T.slate }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.csvData.slice(0, 8).map((row, ri) => (
                        <tr key={ri} style={{ borderTop: `1px solid ${T.border}` }}>
                          {row.map((cell, ci) => <td key={ci} className="px-2 py-1.5" style={{ color: T.ink }}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.csvData.length > 8 && (
                    <div className="text-[11px] px-2 py-1.5" style={{ color: T.slateLight }}>+ {s.csvData.length - 8} more row{s.csvData.length - 8 === 1 ? "" : "s"}</div>
                  )}
                </div>
              )}

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: T.slate }}>Comment / narrative</div>
                <textarea value={s.comment} onChange={(e) => updateSection(s.id, { comment: e.target.value })} rows={3}
                  placeholder="What should this section say — highlights, trends, anything worth calling out?"
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              </div>
            </Card>
          ))}

          <Card style={{ padding: 14 }}>
            <div className="flex items-center gap-2">
              <input value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} placeholder="New section title (e.g. Permits)"
                onKeyDown={(e) => e.key === "Enter" && addSection()}
                className="flex-1 text-sm px-3 py-2 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
              <button onClick={addSection} className="text-xs font-semibold px-3 py-2 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>
                <Plus size={13} className="inline -mt-0.5 mr-1" /> Add section
              </button>
            </div>
          </Card>

          <div className="flex items-center justify-center gap-3 py-2">
            <button
              disabled={sections.length === 0 || downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadMonthlyReportPdf({ client, monthYear, sections, highlights: showHighlights ? highlights : "", focusNextMonth: showHighlights ? focusNextMonth : "", createdBy });
                } catch (err) {
                  console.error("Monthly report PDF generation failed:", err);
                  alert(`Couldn't build the PDF: ${err.message || err}`);
                } finally {
                  setDownloading(false);
                }
              }}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-1.5"
              style={{ background: T.tealDark, color: "#fff", opacity: (sections.length === 0 || downloading) ? 0.5 : 1 }}>
              <FileText size={14} /> {downloading ? "Generating…" : "Download as PDF"}
            </button>
          </div>
          <div className="text-xs text-center py-2" style={{ color: T.slateLight }}>
            Sections and comments save automatically. Highlight numbers default to each section's CSV row count — set a manual number + label if row count isn't the right metric. Every section — template or manually added — gets its own CSV drop, table, and chart option.
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Schedule (Jo & Judith workload capacity, out of their weekly hours) ----------
   Pulls in three sources of assigned work: Tasks (estHours field), Workflow onboarding
   steps (estHours field), and manually-booked Time Blocks (this tab). Capacity is a
   simple 40hrs × number of weeks in the chosen window — no leave/holiday accounting yet,
   that's a "later" problem. */
const SCHEDULE_PEOPLE = ["Jo", "Judith"];
// Jo works a 30hr week, Judith 40 — update here if that ever changes.
const WEEKLY_CAPACITY = { Jo: 30, Judith: 40 };
const SCHEDULE_WINDOWS = { week: { label: "1 week", days: 7 }, "2weeks": { label: "2 weeks", days: 14 }, month: { label: "1 month", days: 30 } };

// A recurring block's `date` is its anchor/first occurrence. "daily" expands to every day
// from max(start, anchor) to end; "weekly" expands to every matching weekday — so neither
// shows up in a window before it was set up, but both repeat forward indefinitely after.
function expandRecurringDates(anchorDate, start, end, repeat) {
  const dates = [];
  const anchor = new Date(anchorDate + "T00:00:00");
  const cursor = new Date(Math.max(new Date(start + "T00:00:00").getTime(), anchor.getTime()));
  if (repeat === "weekly") {
    const dow = anchor.getDay();
    while (cursor.getDay() !== dow) cursor.setDate(cursor.getDate() + 1);
    while (toLocalDateStr(cursor) < end) {
      dates.push(toLocalDateStr(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
  } else if (repeat === "daily") {
    while (toLocalDateStr(cursor) < end) {
      const dow = cursor.getDay(); // 0 = Sunday, 6 = Saturday
      if (dow !== 0 && dow !== 6) dates.push(toLocalDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return dates;
}

function gatherWorkloadItems(person, tasks, onboardings, clients, scheduleBlocks, start, end) {
  const items = [];
  tasks.filter((t) => t.assignee === person && !t.done && t.dueDate && t.dueDate >= start && t.dueDate < end).forEach((t) => {
    items.push({ type: "task", title: t.title, date: t.dueDate, hours: t.estHours || 0, clientId: t.clientId, clientName: t.clientName });
  });
  clients.forEach((c) => {
    (onboardings[c.id] || []).forEach((inst) => {
      inst.steps.forEach((step) => {
        if (step.owner === person && !step.done && step.dueDate && step.dueDate >= start && step.dueDate < end) {
          items.push({ type: "workflow", title: step.title, date: step.dueDate, hours: step.estHours || 0, clientId: c.id, clientName: c.name, workflowName: inst.workflowName });
        }
      });
    });
    (c.reminders || []).forEach((r) => {
      if (r.assignee === person && !r.done && r.date && r.date >= start && r.date < end) {
        items.push({ type: "reminder", title: r.text, date: r.date, hours: r.estHours || 0, clientId: c.id, clientName: c.name });
      }
    });
  });
  scheduleBlocks.filter((b) => b.assignee === person).forEach((b) => {
    if (b.repeat && b.repeat !== "none") {
      expandRecurringDates(b.date, start, end, b.repeat).forEach((d) => {
        items.push({ type: "block", id: b.id, title: b.note || "Booked time", date: d, hours: b.hours || 0, repeat: b.repeat });
      });
    } else if (b.date && b.date >= start && b.date < end) {
      items.push({ type: "block", id: b.id, title: b.note || "Booked time", date: b.date, hours: b.hours || 0 });
    }
  });
  return items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function ScheduleView({ tasks, clients, onboardings, scheduleBlocks, addScheduleBlock, removeScheduleBlock, goToClient }) {
  const [windowKey, setWindowKey] = useState("2weeks");
  const [drafts, setDrafts] = useState(Object.fromEntries(SCHEDULE_PEOPLE.map((p) => [p, { date: today(), hours: "", note: "", repeat: "none" }])));

  const { days } = SCHEDULE_WINDOWS[windowKey];
  const start = today();
  const end = addDays(start, days);

  const setDraftField = (person, field, value) => setDrafts((d) => ({ ...d, [person]: { ...d[person], [field]: value } }));
  const bookTime = (person) => {
    const d = drafts[person];
    if (!d.date || !d.hours) return;
    addScheduleBlock({ assignee: person, date: d.date, hours: Number(d.hours), note: d.note.trim(), repeat: d.repeat });
    setDraftField(person, "hours", "");
    setDraftField(person, "note", "");
    setDraftField(person, "repeat", "none");
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-y-auto">
      <Card style={{ padding: "12px 16px" }}>
        <div className="flex items-center gap-4">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.slate }}>Window</div>
          <div className="flex rounded-lg p-1" style={{ background: T.paperAlt }}>
            {Object.entries(SCHEDULE_WINDOWS).map(([key, w]) => (
              <button key={key} onClick={() => setWindowKey(key)} className="text-xs font-semibold px-4 py-1.5 rounded-md"
                style={{ background: windowKey === key ? T.card : "transparent", color: windowKey === key ? T.tealDark : T.slate }}>
                {w.label}
              </button>
            ))}
          </div>
          <div className="text-xs" style={{ color: T.slateLight }}>{fmtDate(start)} – {fmtDate(addDays(end, -1))}</div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {SCHEDULE_PEOPLE.map((person) => {
          const capacity = Math.round(WEEKLY_CAPACITY[person] * (days / 7));
          const items = gatherWorkloadItems(person, tasks, onboardings, clients, scheduleBlocks, start, end);
          const totalHours = items.reduce((sum, i) => sum + (i.hours || 0), 0);
          const pct = capacity > 0 ? Math.round((totalHours / capacity) * 100) : 0;
          const barColor = pct > 100 ? T.coral : pct >= 80 ? T.amber : T.tealDark;
          const draft = drafts[person];

          return (
            <Card key={person} style={{ padding: 18 }} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-base font-bold flex items-center gap-2" style={{ color: T.ink }}>
                  {person}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: T.paperAlt, color: T.slate }}>{items.length} item{items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="text-sm font-semibold" style={{ color: barColor }}>{totalHours}h / {capacity}h ({pct}%)</div>
              </div>
              <div className="w-full rounded-full h-2.5" style={{ background: T.paperAlt }}>
                <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
              </div>
              {pct > 100 && <div className="text-[11px] font-semibold" style={{ color: T.coral }}>Over capacity for this window</div>}

              <div className="flex flex-col gap-1.5 max-h-[32rem] overflow-y-auto mt-1">
                {items.length === 0 && <div className="text-xs" style={{ color: T.slateLight }}>Nothing scheduled in this window.</div>}
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg" style={{ background: T.paperAlt }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Pill color={item.type === "task" ? T.tealDark : item.type === "workflow" ? T.blue : item.type === "reminder" ? "#8B6BA8" : T.amber} bg={T.card}>
                        {item.type === "task" ? "Task" : item.type === "workflow" ? "Workflow" : item.type === "reminder" ? "Reminder" : item.repeat === "daily" ? "Daily" : item.repeat === "weekly" ? "Weekly" : "Booked"}
                      </Pill>
                      <button onClick={() => item.clientId && goToClient(item.clientId, item.type === "workflow" ? "onboarding" : item.type === "reminder" ? "reminders" : "overview")}
                        className="truncate text-left" disabled={!item.clientId} style={{ color: T.ink, cursor: item.clientId ? "pointer" : "default" }} title={item.title}>
                        {item.title}{item.clientName ? ` — ${item.clientName}` : ""}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span style={{ color: T.slateLight }}>{fmtDate(item.date)}</span>
                      <span className="font-semibold" style={{ color: T.ink }}>{item.hours}h</span>
                      {item.type === "block" && (
                        <button onClick={() => removeScheduleBlock(item.id)} title={item.repeat && item.repeat !== "none" ? `Remove this ${item.repeat} booking (removes all future occurrences)` : "Remove booking"}>
                          <Trash2 size={12} color={T.slateLight} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5 pt-2 flex-wrap" style={{ borderTop: `1px solid ${T.border}` }}>
                <input type="date" value={draft.date} onChange={(e) => setDraftField(person, "date", e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <input type="number" min="0" step="0.5" placeholder="hrs" value={draft.hours} onChange={(e) => setDraftField(person, "hours", e.target.value)}
                  className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} />
                <input placeholder="What for?" value={draft.note} onChange={(e) => setDraftField(person, "note", e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, minWidth: 100 }} />
                <select value={draft.repeat} onChange={(e) => setDraftField(person, "repeat", e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} title="Repeats forward from the date above">
                  <option value="none">Doesn't repeat</option>
                  <option value="daily">Repeats daily</option>
                  <option value="weekly">Repeats weekly</option>
                </select>
                <button onClick={() => bookTime(person)} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ background: T.tealDark, color: "#fff" }}>
                  Book
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="text-xs text-center py-2" style={{ color: T.slateLight }}>
        Workload pulls in Tasks and Workflow steps assigned to Jo/Judith (set their "hrs" when creating one) plus anything booked here directly. Capacity is Jo's 30hrs / Judith's 40hrs × weeks in the window — doesn't yet account for leave or public holidays.
      </div>
    </div>
  );
}

export default function App() {
  const [module, setModule] = useState("overview");
  // Detect a mobile-width viewport and default straight into the Quick Add screen the first
  // time — field staff on their phone want notes/tasks fast, not the full desktop layout.
  // They can still reach the full app any time via the "Full App" button, and from there
  // it won't auto-redirect them back.
  const [isMobile, setIsMobile] = useState(false);
  const hasAutoRedirected = useRef(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useEffect(() => {
    if (isMobile && !hasAutoRedirected.current) {
      hasAutoRedirected.current = true;
      setModule("mobile");
    }
  }, [isMobile]);
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
  // Billing/Xero access — Sophie and Vanessa only. Case-insensitive/trimmed since
  // currentUser comes from a Firestore lookup (see above) that could plausibly not match
  // an exact "Sophie"/"Vanessa" string (casing, whitespace, or a missing team doc falling
  // back to a raw email).
  const canSeeBilling = ["sophie", "vanessa"].includes((currentUser || "").trim().toLowerCase());
  // Clients live in Firestore — no auto-seeding happens anymore (that was removed once
  // real clients existed; see HANDOFF history if that's ever confusing).
  const [clients, setClients] = useState([]);
  // Deletion tombstone — the "add whichever of the imported batch isn't already there" checks
  // (both for clients and leads, below) can't tell "never imported" from "was imported, then
  // deliberately deleted" just by id existence. This records anything actually deleted so
  // those checks know to leave it alone instead of recreating it fresh on the next pass.
  const [deletedImportIds, setDeletedImportIds] = useState({ clientIds: [], leadIds: [] });
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "deletedImports"), (snap) => {
      setDeletedImportIds(snap.exists() ? { clientIds: snap.data().clientIds || [], leadIds: snap.data().leadIds || [] } : { clientIds: [], leadIds: [] });
    }, (err) => console.error("Deleted-imports tombstone subscription failed:", err));
    return unsub;
  }, []);
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
  // Adds the real client migration (importedClientsMigration, above) by fixed id — only
  // once the live snapshot has actually loaded, same safe pattern as the leads import:
  // never fires against a still-loading empty array, only ever adds whichever clients
  // aren't already present, never overwrites an existing client with the same id, and
  // never recreates one that was deliberately deleted (see deletedImportIds above).
  useEffect(() => {
    if (!clientsLoaded) return;
    const existingIds = new Set(clients.map((c) => c.id));
    const deletedIds = new Set(deletedImportIds.clientIds);
    importedClientsMigration.forEach((c) => {
      if (!existingIds.has(c.id) && !deletedIds.has(c.id)) {
        const { id, ...data } = c;
        setDoc(doc(db, "clients", id), data);
      }
    });
  }, [clientsLoaded, clients, deletedImportIds]);
  // Backfill: if any of the migrated clients above already got created (an earlier paste
  // of this file, before ohsmsDue/the reminder were computed for the migration), this
  // patches just that gap in — only for clients from the migration batch that have a known
  // OHSMS Last Issued date but are missing the due date, never touches anything else about
  // them, and is a no-op forever after the first time it catches up.
  useEffect(() => {
    if (!clientsLoaded) return;
    const migrationById = Object.fromEntries(importedClientsMigration.map((c) => [c.id, c]));
    clients.forEach((c) => {
      const src = migrationById[c.id];
      if (src && c.ohsmsLastIssued && !c.ohsmsDue && src.ohsmsDue) {
        updateDoc(doc(db, "clients", c.id), {
          ohsmsDue: src.ohsmsDue,
          reminders: upsertOhsmsReminder(c.reminders, src.ohsmsDue),
        });
      } else if (c.ohsmsDue) {
        // Separate, narrower backfill: this client's OHSMS reminder already exists (due
        // date was fine), but it was created before estHours: 0.5 was added to
        // ohsmsAnnualReminder — those migrated straight from the original import script,
        // which predates that field entirely. Only patches the hours on that one reminder,
        // nothing else about it (date, recurring, assignee all stay exactly as they were).
        const existing = (c.reminders || []).find((r) => r.id === "ohsms-annual-review");
        if (existing && existing.estHours === undefined) {
          updateDoc(doc(db, "clients", c.id), {
            reminders: c.reminders.map((r) => (r.id === "ohsms-annual-review" ? { ...r, estHours: 0.5 } : r)),
          });
        }
      }
    });
  }, [clientsLoaded, clients]);
  // One-time cleanup: "Simulate form completed" (Sales tab) used to invent placeholder
  // intake answers — a fixed "6 hours support requested", a fixed set of "requested
  // sections", and a fixed "no formal OHSMS in place" sentence — and show them on the
  // client's Overview tab as if the client had actually said that, which was misleading
  // since that button never asks the client anything. Only strips those three specific
  // fields, and only from a client whose intake matches the exact old placeholder values —
  // a real sign-up submission would essentially never coincidentally match all three
  // exactly, so this can't mistake genuine answers for the fake ones. Leaves
  // submittedDate/contactEmail/contactName alone either way, since those were always real.
  useEffect(() => {
    if (!clientsLoaded) return;
    const FAKE_EXISTING_WORK = "No formal OHSMS in place yet — currently relying on a basic site safety folder.";
    const FAKE_SECTIONS = JSON.stringify(["policy", "hazard", "induction", "ppe"]);
    clients.forEach((c) => {
      const intake = c.intake;
      if (!intake) return;
      const matchesFakeData = intake.supportHours === 6 && intake.existingWork === FAKE_EXISTING_WORK && JSON.stringify(intake.requestedSections) === FAKE_SECTIONS;
      if (matchesFakeData) {
        const { supportHours, existingWork, requestedSections, ...cleanIntake } = intake;
        updateDoc(doc(db, "clients", c.id), { intake: cleanIntake });
      }
    });
  }, [clientsLoaded, clients]);
  // Second, separate cleanup: the fix above only ever touched client.intake. The fake "6
  // hours support requested" also got written into client.hours.included at creation time,
  // as a completely separate field that the intake cleanup never reached, which is why
  // these clients could still show "6" long after their fake intake text was gone.
  // Detecting this safely (without risking a genuinely intentional client with 6 included
  // hours getting reset by mistake) relies on a specific signal: a client that went through
  // "Simulate form completed" always has an intake object with submittedDate/contactEmail/
  // contactName but never has appUsers/paymentFreq/requireOhsms, since those only ever get
  // set by someone actually answering the real sign-up form. A fully manual client (added
  // via "Add client") has intake: null entirely, so this never touches those either.
  useEffect(() => {
    if (!clientsLoaded) return;
    clients.forEach((c) => {
      const intake = c.intake;
      const looksSimulated = intake && !intake.appUsers && !intake.paymentFreq && !intake.requireOhsms;
      if (looksSimulated && c.hours?.included === 6) {
        updateDoc(doc(db, "clients", c.id), { hours: { ...c.hours, included: 0 } });
      }
    });
  }, [clientsLoaded, clients]);
  // Clients who want the Monthly Reports add-on need someone to actually produce and send
  // their report each month, so this makes sure a recurring reminder exists on their card
  // the moment wantsMonthlyReports is true, whether that was ticked at sign-up or turned on
  // manually later through the CRM. Fixed id per client, so this is safe to re-run on every
  // load and never creates a duplicate, and it leaves the reminder alone entirely once it
  // exists, so marking it done and it reopening next month via the normal recurring
  // mechanism (see toggleReminderDone) isn't fought by this effect recreating it.
  useEffect(() => {
    if (!clientsLoaded) return;
    clients.forEach((c) => {
      if (!c.intake?.wantsMonthlyReports) return;
      const reminderId = `monthly-report-${c.id}`;
      const alreadyExists = (c.reminders || []).some((r) => r.id === reminderId);
      if (alreadyExists) return;
      const [y, m] = currentMonth().split("-").map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const dueDate = `${nextY}-${String(nextM).padStart(2, "0")}-05`;
      const newReminder = { id: reminderId, text: "Prepare and send Monthly Report", assignee: "", estHours: 0, done: false, recurring: "monthly", date: dueDate };
      updateDoc(doc(db, "clients", c.id), { reminders: [...(c.reminders || []), newReminder] });
    });
  }, [clientsLoaded, clients]);
  // Leads now live in Firestore, same pattern as clients: live subscription plus a
  // one-time seed of the mock data using the same ids so nothing else breaks.
  const [leads, setLeads] = useState([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "leads"),
      (snap) => { setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLeadsLoaded(true); },
      (err) => console.error("Leads subscription failed:", err)
    );
    return unsub;
  }, []);
  // One-time cleanup: the app used to seed 5 fictional placeholder leads (fixed ids "1"-"5")
  // into a fresh, empty collection — since real leads have since been imported, this removes
  // any of those specific placeholders that made it in before that stopped happening. Only
  // ever touches those 5 exact ids, never anything else, and only once the real snapshot has
  // loaded (same leadsLoaded gate as the real import below, for the same reason).
  useEffect(() => {
    if (!leadsLoaded) return;
    ["1", "2", "3", "4", "5"].forEach((id) => {
      if (leads.some((l) => l.id === id)) deleteDoc(doc(db, "leads", id));
    });
  }, [leadsLoaded, leads]);
  // Adds the real imported pipeline (importedLeads, above) by fixed id — only once the
  // live snapshot has actually loaded (leadsLoaded), so this never mistakes "still
  // loading" for "doesn't exist yet" and overwrites something someone's since edited in
  // the app. Only ever adds whichever of the 36 aren't already present, never touches the
  // rest of the leads collection, and never recreates one that was deliberately deleted.
  useEffect(() => {
    if (!leadsLoaded) return;
    const existingIds = new Set(leads.map((l) => l.id));
    const deletedIds = new Set(deletedImportIds.leadIds);
    importedLeads.forEach((l) => {
      if (!existingIds.has(l.id) && !deletedIds.has(l.id)) {
        const { id, ...data } = l;
        setDoc(doc(db, "leads", id), data);
      }
    });
  }, [leadsLoaded, leads, deletedImportIds]);
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
  const [selectedClient, setSelectedClient] = useState("");
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

  // Custom emergency types added via the "Add emergency" button on the ERP tab — global,
  // like systemReviewLog, since a new emergency type (e.g. a site-specific hazard) is
  // something every client's ERP tab should be able to pick from, not just the one it was
  // added for.
  const [customErpItems, setCustomErpItems] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "customErpItems"), (snap) => setCustomErpItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Custom ERP items subscription failed:", err));
    return unsub;
  }, []);
  // One-time cleanup: "Sync from sign-up form" used to create a custom ERP item for any
  // emergency type that didn't have a proper base item yet (see SIGNUP_TO_ERP_LABELS), using
  // whatever casing the sign-up form itself used ("Vehicle accident"). Now that Vehicle
  // Accident, Confined Space Rescue, Excavation Collapse, and Violence or Aggressive
  // Behaviour are proper base items, any custom item created before that fix is a pure
  // duplicate sitting alongside the real one. This removes those specific leftovers.
  // "Serious injury or fatality" has no base item at all since it was removed from the
  // sign-up form entirely, so any custom item for it just gets deleted outright.
  useEffect(() => {
    if (customErpItems.length === 0) return;
    const NOW_HAS_BASE_ITEM = ["vehicle accident", "confined space rescue", "excavation collapse", "violence or aggressive behaviour"];
    const REMOVED_ENTIRELY = ["serious injury or fatality"];
    customErpItems.forEach((item) => {
      const lower = (item.label || "").toLowerCase();
      if (NOW_HAS_BASE_ITEM.includes(lower) || REMOVED_ENTIRELY.includes(lower)) {
        deleteDoc(doc(db, "customErpItems", item.id));
        deleteDoc(doc(db, "documentTemplates", templateKey("erp", item.label))).catch(() => {});
      }
    });
  }, [customErpItems]);
  const addCustomErpItem = (label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setDoc(doc(db, "customErpItems", "erpitem" + Date.now()), { label: trimmed, createdAt: today() });
    // Seed an empty, ready-to-write template so it shows the same "no template text yet"
    // prompt as any other item, rather than silently having nothing.
    setDoc(doc(db, "documentTemplates", templateKey("erp", trimmed)), { content: "" });
  };

  // Touchpoint baselines — how often each client profile tier should hear from someone, and
  // who gets nudged if a client falls short. One settings doc per profile.
  const [touchpointBaselines, setTouchpointBaselines] = useState({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "touchpointBaselines"), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      setTouchpointBaselines(map);
    }, (err) => console.error("Touchpoint baselines subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "touchpointBaselines"));
        if (snap.empty) {
          await Promise.all(CLIENT_PROFILES.map((p) => setDoc(doc(db, "touchpointBaselines", p), { targetCount: 1, periodDays: 30, assignee: TEAM[0] })));
        }
      } catch (err) { console.error("Touchpoint baseline seed failed:", err); }
    })();
  }, []);
  const updateTouchpointBaseline = (profile, patch) => setDoc(doc(db, "touchpointBaselines", profile), { ...(touchpointBaselines[profile] || { targetCount: 1, periodDays: 30, assignee: TEAM[0] }), ...patch });

  // Client-side reconciliation: whenever clients/tasks/baselines change while someone has
  // the app open, check each active client against their profile's baseline. Below target
  // → upsert a fixed-id reminder for the assigned person (won't duplicate — same id gets
  // reused). Back on track → auto-resolve that reminder rather than leaving it stale. This
  // only runs while the app is open in a browser, there's no backend cron doing this
  // overnight — it catches up next time anyone's looking at the app.
  //
  // Two guards on top of the basic threshold check:
  // - hasAnyHistory: a client with zero logged hours/notes ever (freshly migrated, or a
  //   brand new client nobody's touched yet) hasn't "gone quiet" — there's nothing to have
  //   gone quiet from. Only clients with at least some real history get checked.
  // - touchpointSnoozedUntil: deleting the reminder (see removeReminder) sets this 30 days
  //   out, so a deliberate dismissal actually sticks instead of being recreated on the very
  //   next pass because the underlying shortfall is still true.
  useEffect(() => {
    if (Object.keys(touchpointBaselines).length === 0) return;
    clients.filter((c) => !c.archived).forEach((client) => {
      const baseline = touchpointBaselines[client.profile || "Standard Client"];
      if (!baseline) return;
      const periodDays = baseline.periodDays || 30;
      const target = baseline.targetCount || 1;
      const count = recentTouchpointCount(client, periodDays, tasks);
      const fixedId = "touchpoint-baseline-" + client.id;
      const existing = (client.reminders || []).find((r) => r.id === fixedId);
      const hasAnyHistory = (client.hours?.log?.length > 0) || (client.notes?.length > 0);
      const snoozed = client.touchpointSnoozedUntil && client.touchpointSnoozedUntil > today();
      if (count < target && !existing && hasAnyHistory && !snoozed) {
        const reminder = {
          id: fixedId, done: false, recurring: "none", assignee: baseline.assignee || TEAM[0], estHours: 0.25,
          text: `Touchpoint check-in needed for ${client.name} — only ${count} in the last ${periodDays} days (target ${target})`,
          date: today(),
        };
        updateDoc(doc(db, "clients", client.id), { reminders: [...(client.reminders || []), reminder] });
      } else if (count >= target && existing && !existing.done) {
        updateDoc(doc(db, "clients", client.id), { reminders: client.reminders.map((r) => (r.id === fixedId ? { ...r, done: true } : r)) });
      } else if (!hasAnyHistory && existing) {
        // Cleans up any of these that got created before the hasAnyHistory guard existed —
        // e.g. the 67 freshly migrated clients, which had zero history and so should never
        // have been flagged as "gone quiet" in the first place.
        updateDoc(doc(db, "clients", client.id), { reminders: client.reminders.filter((r) => r.id !== fixedId) });
      }
    });
  }, [clients, tasks, touchpointBaselines]);


  // Manually-booked time blocks on the Schedule tab (e.g. "Tue 9am-1pm — BMC site visit")
  // — these count toward workload capacity the same as Tasks and Workflow steps, just
  // without needing a task/step to exist for them.
  const [scheduleBlocks, setScheduleBlocks] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "scheduleBlocks"), (snap) => setScheduleBlocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Schedule blocks subscription failed:", err));
    return unsub;
  }, []);
  const addScheduleBlock = (block) => setDoc(doc(db, "scheduleBlocks", "block" + Date.now()), block);
  const removeScheduleBlock = (id) => deleteDoc(doc(db, "scheduleBlocks", id));

  // One-time seed of real procedure content, condensed from OSHE's actual reference documents.
  // Never overwrites anything already written — only fills in a key if it's genuinely empty,
  // so any edits Sophie/Vanessa have already made are always safe.
  useEffect(() => {
    const realProcedureContent = {
      "Plant & Equipment Procedure": "Purpose: this procedure defines the requirements for managing plant and equipment, including the application of the risk management process to identify hazards associated with plant and equipment use, legislative and manufacturer's compliance requirements regarding testing, maintenance, installation, commissioning, use, repair, alteration, dismantling, storage and disposal, and the requirements to provide relevant information, training, and licensing to safely operate plant.\n\nScope: this procedure applies to all plant and equipment used in The Company.\n\nHazard Identification and Risk Assessment: The Company identifies and completes a risk assessment of all plant and equipment in the workplace, in consultation with workers, recording this information in The Company's Hazard Register and Plant and Equipment Register in the HARM App. Examples of plant and equipment include excavators, table saws, and powered hand tools. Hazard identification takes place when new plant and equipment are introduced, for all existing plant and equipment, before any changes are made to the system of work, before plant is used in a manner other than what it was designed for, and when new safety information becomes available.\n\nRisk Management:\n• The Company applies the hierarchy of controls to plant risks — eliminating hazards or hazardous work practices where possible.\n• Substituting the plant, or hazardous parts of it, with lower-risk alternatives.\n• Isolating workers from hazardous plant by distance or barriers.\n• Incorporating engineering controls including modifications to tools or equipment.\n• Applying administrative controls such as safe operating procedures.\n• Using PPE as the last line of defence where higher-order controls aren't practicable, or to supplement other controls.\n• Monitoring and evaluating controls for effectiveness.\n• Recommencing the risk assessment process if new hazards are identified.\n• Communicating the outcomes of the risk assessment process.\n\nIntroducing new Plant & Equipment:\n• Before new plant or equipment is introduced into service, The Company identifies and assesses associated risks and records the plant in the Plant and Equipment Register. Relevant hazards and controls are recorded in the Hazard/Risk Register where appropriate. This is informed by a pre-purchase review with relevant stakeholders including Health and Safety Representatives and the workers who will use the new plant.\n• A supplier demonstration where relevant and practicable.\n• A review of the supplier's risk assessment and the manufacturer's operating instructions.\n• A review of legislative and relevant New Zealand Standard requirements including registration, certification and licensing.\n• Identification and control of specific plant hazards such as moving parts, manual tasks, pressure, electricity, noise, or extreme temperatures.\n• Identification of requirements for installation, maintenance, inspection and storage.\n• Identification of any requirements for decommissioning or disposal of replaced plant.\n\nSafe Operating Procedures: upon release of plant or equipment, an SOP is developed and workers signed off during the competency assessment period within the induction panel of the HARM App. SOPs are reviewed periodically and whenever relevant changes to plant, equipment, processes, hazards, legislation, guidance or incident learnings indicate that review is required. The Company may seek support from H.A.R.M Limited where changes require specialist health and safety advice or amendment of OHSMS documentation.\n\nCompetence: plant and equipment is only used by trained, licensed (where applicable) and competent workers. Where a formal licence is not required, The Company determines what evidence, instruction, supervision or competency assessment is appropriate to the equipment and level of risk. The Company determines and takes action to ensure competency based on education, induction, training and experience, retaining documentation as evidence, and ensures workers maintain competence through ongoing review and annual training plans. All equipment has manufacturer's instructions on safe operation and maintenance, and a documented SOP where required. Refer: Induction & Training Process.\n\nMaintenance & Calibration: a record of inspections, calibration, and maintenance is kept for each item of plant and equipment, including scheduled maintenance, breakdown maintenance, and replacement of parts outside the scheduled program, determined in line with supplier or manufacturer recommendations. Records include the plant/equipment name, location, serial or identification number, description of work performed, completion date, and who performed the work. This register is maintained by The Company's administrative team, with service dates entered into the HARM App so alerts are sent when plant or equipment is due for service.\n\nReviewing Controls: The Company is responsible for reviewing the effectiveness of risk controls in consultation with the HSR and employees, reviewing the completed risk assessment, hazard register, and other relevant sources such as operating manuals to determine whether current controls remain appropriate. Any changes to risk controls are documented on the relevant risk assessment and the Hazard Register. Plant and equipment controls are reviewed and revised whenever the system of work changes, the plant is used in a manner other than designed, an incident occurs involving the item, or new safety information becomes available.",
      "Wellbeing Procedure": "Purpose: to promote and maintain the mental and emotional wellbeing of all employees, address stress, and prevent and manage bullying and psychosocial hazards in the workplace.\n\nScope: this procedure applies to The Company workers and, where relevant, contractors and other persons interacting with The Company workplaces.\n\nDefinitions: Wellbeing is a state of mental and emotional health where individuals feel supported and valued. Workplace bullying is repeated and unreasonable behaviour directed towards a worker or group of workers that can lead to physical or psychological harm. Psychosocial Hazards are risks arising from the interaction between work and the work environment that may affect mental health. Stress is a state of mental or emotional strain resulting from challenging or adverse circumstances.\n\nResponsibilities: Employers ensure a safe work environment, implement wellbeing initiatives, and address stress and bullying promptly. Managers/Supervisors support staff wellbeing, manage stress, model respectful behaviour, and act on reports of bullying. Employees contribute to a positive workplace culture, manage personal stress, report concerns, and seek support when needed.\n\nPsychosocial Wellbeing:\n• Support systems provide access to mental health resources such as Mates in Construction, tailored to the construction industry.\n• Workload management monitors and manages workloads to prevent excessive stress, encouraging reasonable deadlines and break times.\n• Work-life balance is promoted through practices supporting a healthy balance between work and personal life.\n\nStress Management:\n• Employees are educated about stress, its signs, and management techniques.\n• Support resources are made available such as Lifeline (0800 543 354), the Suicide Crisis Helpline (0508 828 865), and the Mental Health Foundation of New Zealand.\n• Flexible working options are provided where possible to help manage stress.\n• A supportive work environment is created that minimises stressors such as excessive workloads or unclear expectations.\n\nBullying Prevention:\n• The Company does not tolerate workplace bullying and will respond appropriately to reported or identified bullying behaviour.\n• Provides training on recognising, preventing, and addressing bullying.\n• Implements clear reporting procedures including confidential options.\n• Investigates all reports promptly and fairly.\n• Offers support to those affected, including access to counselling services.\n\nReporting and Addressing Bullying: employees initially report bullying concerns to their direct supervisor or manager. If the supervisor is involved in the issue, or the employee feels uncomfortable reporting to them, the matter is escalated directly to the Director. Reporting to the Director involves:\n• Concerns may initially be raised verbally or in writing. Where appropriate, sufficient information will be documented to enable the concern to be assessed and responded to, including relevant dates, behaviour, persons involved and available supporting information.\n• The Director handling the report with strict confidentiality, sharing information only with relevant parties as necessary.\n• Acknowledging receipt within 2 working days and outlining next steps.\n• Initiating a thorough and impartial investigation, which may involve interviewing involved parties and witnesses and reviewing documentation.\n• Determining appropriate actions based on findings, which may include disciplinary measures, mediation, or other corrective actions.\n• Providing feedback to the reporting employee about the outcome and any steps taken.\n\nReview and Improvement:\n• The effectiveness of wellbeing initiatives, stress management, and anti-bullying measures is regularly reviewed.\n• Employee feedback is sought to improve wellbeing practices and address emerging issues.\n• This procedure is revised as needed to reflect changes in legislation, workplace conditions, and best practices.",
      "Workplace Inspection Procedure": "Objective: this procedure aims to conduct regular workplace inspections to identify and address potential health and safety hazards, ensuring a safe and healthy environment for all employees.\n\nScope: this procedure applies to all areas within The Company where work is performed, involving designated personnel responsible for conducting physical inspections, identifying hazards, verifying that controls remain effective and checking compliance with applicable The Company requirements and health and safety obligations.\n\nAssignment of Responsibilities: a designated manager, supervisor or other competent person oversees the workplace inspection programme. Competent persons are assigned to undertake inspections within relevant areas of responsibility.\n\nFrequency of Inspections: inspection frequency is determined having regard to the nature of the work, level of risk, workplace conditions, project phase, previous findings, incidents and changes to work activities. Higher-risk or rapidly changing work areas are inspected more frequently.\n\nConducting the Inspection: inspectors systematically assess the workplace, focusing on machinery, equipment, work processes, and environmental conditions, documenting observed hazards and gathering feedback from employees.\n\nRisk Assessment: identified hazards are assessed to determine their level of risk, considering factors such as likelihood and severity.\n\nCorrective Actions: hazards are prioritised based on risk level, with appropriate corrective actions implemented — which may include controls, training, or procedural changes.\n\nDocumentation: records of inspection findings are maintained, including identified hazards, risk assessments, and corrective actions, with reports documented for future reference.\n\nFollow-Up and Monitoring: implemented corrective actions are followed up to ensure effectiveness, with inspection records regularly monitored to track trends and identify recurring issues.\n\nContinuous Improvement: feedback from inspections is used to improve the process, with the procedure reviewed periodically to ensure alignment with regulations and best practices. By following this procedure, The Company ensures a proactive approach to maintaining a safe and healthy workplace environment while fostering a culture of safety among its employees.",
      "Continual Improvement Procedure": "Scope: This procedure applies to all The Company operations, workplaces, projects and activities and encompasses all aspects related to health and safety management.\n\nIdentification of Improvement Opportunities: The Company continuously evaluates its health and safety performance through regular audits, inspections, incident investigations, and feedback and participation from workers and other relevant parties.\n\nSetting Objectives and Targets: Based on the identified improvement opportunities, The Company establishes specific health and safety objectives and targets that are SMART (Specific, Measurable, Achievable, Relevant, Time-bound) and applicable to all areas of operation.\n\nAction Planning: Action plans are developed to address the identified improvement areas. These plans outline clear steps, assign responsibilities, allocate resources, and set timelines for implementation.\n\nImplementation of Action Plans: The Company executes the action plans according to the established timelines and responsibilities, ensuring that improvements are implemented uniformly across all areas of operation.\n\nMonitoring and Measurement: Progress towards achieving the objectives and targets is regularly monitored and measured using relevant indicators and performance metrics.\n\nReview and Evaluation: Periodic reviews are conducted to evaluate the effectiveness of implemented actions in achieving the desired improvements. This involves analysing collected data, assessing outcomes against set objectives, and identifying lessons learned.\n\nManagement Review: The Company management periodically reviews health and safety performance, improvement actions, objectives and emerging risks to determine whether the OHSMS remains suitable, adequate and effective.\n\nCommunication and Engagement: Transparent communication channels are maintained to keep employees informed about improvement initiatives, progress, and outcomes. Employee engagement and participation are encouraged to foster a culture of continuous improvement at all levels of the company.\n\nDocumentation and Record-Keeping: Comprehensive documentation of the continual improvement process is maintained internally, including records of objectives, action plans, monitoring results, reviews, management decisions, and any relevant communication.\n\nFeedback and Adaptation: Feedback from employees, stakeholders, and external sources is actively sought and considered to refine improvement efforts. The Company remains adaptable to changing circumstances, emerging risks, and evolving best practices.",
      "Fatigue Management Procedure": "Purpose: The Company recognises that workers who are impaired by stress and fatigue are a risk to themselves and those around them. This procedure aims to improve overall safety and wellbeing, to achieve a safe working environment, in support of the Fatigue & Stress Management Policy.\n\nScope: This procedure applies to all workers who carry out work in any capacity for The Company.\n\nWhat is fatigue? Fatigue is a state of mental and/or physical exhaustion which reduces a person's ability to perform work safely and effectively. It can occur because of prolonged mental or physical activity, sleep loss, and/or disruption of the internal body clock, and can be caused by factors which may be work related, non-work related, or a combination of both, accumulating over time. Fatigue reduces alertness, which may lead to errors and an increase in workplace incidents and injuries.\n\nCommon causes of fatigue include general causes such as inadequate or poor-quality restorative sleep, including regularly obtaining less sleep than the individual needs to remain alert and fit for work, long periods of being awake (more than 17 hours), sustained mental or physical effort, disruption to the internal biological clock, and health or emotional issues; work-related causes such as poor roster design, extended hours of work, call-out requirements, second jobs, heavy workload within a standard shift, inadequate rest breaks, and a difficult work environment (noise, temperature extremes, conflict); and non-work-related causes such as family responsibilities, social or community obligations, inappropriate use of alcohol, medication or illicit drugs, financial or relationship stress, and physiological factors such as age, medical or mental health conditions and sleeping disorders.\n\nPCBU responsibilities:\n• So far as is reasonably practicable, ensure the health and safety of workers and that others are not put at risk from their work.\n• Eliminate risks that arise from work, or minimise them where elimination isn't reasonably practicable.\n• Ensure workers take regular, quality rest breaks in their working day.\n• Plan working hours, workloads, breaks, travel and recovery periods to minimise fatigue risks so far as is reasonably practicable.\n• Ensure facilities are provided to workers, with the nearest reasonable option factored into planning when not available onsite.\n• Ensure fit-for-purpose plant, machinery and equipment is provided.\n• Ensure adequate training to complete tasks.\n• Engage with workers on health and safety matters and seek their input.\n• Create a positive working environment where good relationships exist and workers are encouraged and supported.\n\nWorker responsibilities: managing fatigue is a shared responsibility. The Company must manage work-related fatigue risks so far as is reasonably practicable, while workers must take reasonable care of their own health and safety and ensure their actions do not adversely affect others. Workers are expected to:\n• Turn up in a state fit for work, having done everything possible to get a good sleep and rest.\n• Inform their manager or supervisor if a task is beyond their capabilities.\n• Recognise the signs and symptoms of fatigue, including feeling constantly tired, having little energy, feeling sluggish, excessive yawning or falling asleep at work, reduced vigilance, bad moods, forgetfulness, inability to concentrate, poor communication, poor decision-making, reduced hand-eye coordination and slower reaction times, as well as less obvious symptoms such as drowsiness, headaches, dizziness, blurred vision or impaired visual perception and a need for extended sleep on days off.\n• Communicate with their manager or supervisor if they start showing signs and symptoms of fatigue, and make managers and supervisors aware of other workers who may be fatigued.\n• Report fatigue-related incidents.\n• Comply with reasonable instructions of their employer.\n• Co-operate with any health and safety policy notified to them.\n• Ensure they are adequately trained to complete tasks and identify associated risks, including the signs and symptoms of fatigue.\n\nManagement of fatigue follows five steps: Step 1, hazard identification — identify the factors which may cause fatigue in the workplace. Step 2, risk assessment — assess the risks of injury from fatigue. Step 3, control risks — implement the most effective risk control measures reasonably practicable. Step 4, risk assessment with control measures — re-assess whether the risks of injury from fatigue are adequately controlled. Step 5, monitor and review control measures — review risk control measures to ensure they are working as planned. Workers are consulted at each step of this process, to help identify fatigue risk factors, implement effective controls, and raise awareness of the risks associated with fatigue.\n\nIdentifying factors that may cause fatigue: common contributing factors include work schedules which limit recovery time (such as shift work, night work, extended hours, or limited breaks), job demands involving extended periods of physically or mentally demanding work, the length and quality of sleep, environmental conditions such as heat, cold, vibration or noise, and non-work-related factors such as lifestyle, family responsibilities or health. Managers identify these factors by consulting with workers, reviewing timesheets and overtime data, and reviewing incident data and investigation findings.\n\nAssessing the risk: once a fatigue-related risk is identified, an assessment considers where, which and how many workers are likely to be at risk, how often fatigue is likely to occur, the degree of harm which may result, whether existing controls are effective, what action should be taken, and how urgently. Contributors to fatigue are not considered in isolation, since job demands, hours of work and environmental conditions often combine to increase risk.\n\nControlling the risk: the best way to control the health and safety risks arising from fatigue is to eliminate the causal factors at the source. Where elimination isn't reasonably practicable, the risks are minimised, with the most effective controls always identified in consultation with workers where possible.\n\nA fatigue risk checklist is used to help identify risk factors across mental and physical demands, work scheduling and planning, work time, workplace and environmental conditions, and non-work factors — if the answer to any checklist question points to a risk factor being present, fatigue risks are assessed and strategies put in place to manage it. Minimum rest break requirements follow the Employment Relations Amendment Act 2018 and Employment New Zealand's rest and meal break guidance.",
      "Health & Safety Budget Management Procedure": "Purpose: to establish a clear process for setting, approving, and managing the Health and Safety (H&S) budget, ensuring that all safety-related expenses are adequately covered and controlled.\n\nScope: this procedure applies to all activities related to the management of the Health and Safety budget within The Company.\n\nRoles and Responsibilities:\n• Health and Safety (H&S) Officer/Manager: responsible for proposing the annual H&S budget based on The Company's safety needs.\n• Business Owner/Director: reviews the proposed budget, provides final approval, and oversees any significant expenditures.\n\nBudget Setting Process:\n• The H&S Officer/Manager reviews the previous year's budget as a baseline for the current year.\n• A percentage increase is applied to account for inflation or increased safety needs (e.g., a 5% increase).\n• An amount is allocated per employee to cover essential safety needs, such as Personal Protective Equipment (PPE) and training.\n• Additional funds are allocated for upcoming projects with specific H&S requirements, ensuring comprehensive coverage.\n\nBudget Approval Process:\n• Routine Expenditures: the H&S Officer/Manager is authorised to make expenditures within the approved budget for routine safety items.\n• Large or Unexpected Expenditures: any expenditure beyond the approved budget must be submitted to the Business Owner/Director for review and approval.\n\nBudget Coverage:\n• Personal Protective Equipment (PPE): the budget covers the purchase and maintenance of PPE for all employees.\n• Training: includes costs associated with safety training programs and certifications.\n• Safety Checks and Audits: allocates funds for regular safety inspections, compliance audits, and corrective actions.\n• Safety Equipment: covers the purchase and upkeep of safety-related equipment (e.g., fire extinguishers, first aid kits).\n• Health and Safety Programs: provides funding for ongoing H&S programs, awareness campaigns, and safety improvements.\n\nAll budgets above include all necessary time element.\n\nRecord & Review: annually, an Annual Health & Safety (H&S) Budget Approval Form must be completed, and budget and objectives must be reviewed at monthly management meetings.",
      "Health & Safety Issue Resolution Procedure": "Scope: the scope of this process encompasses the formal resolution of health and safety issues that cannot be resolved through informal channels, involving relevant stakeholders, documentation of the entire process, compliance with legal requirements, and continuous improvement efforts within The Company.\n\nFormal Escalation: when an issue cannot be resolved through informal channels such as consultation and discussion, either party involved may formally escalate the matter to higher management or designated representatives.\n\nNotification: the party initiating the formal escalation notifies their immediate supervisor or manager in writing, outlining the nature of the health and safety issue, previous attempts at resolution, and reasons for escalation.\n\nReview by Management: the supervisor or manager receiving the escalation requests a meeting with relevant stakeholders, including representatives from both sides of the issue, and conducts a thorough review of the matter.\n\nMediation or Facilitation: if deemed necessary, an impartial mediator or facilitator may be appointed to assist in resolving the dispute. This mediator helps facilitate constructive dialogue between parties, identifies common ground, and explores potential solutions.\n\nConflict Resolution Meeting: a formal conflict resolution meeting is scheduled, where all parties involved present their perspectives, concerns, and proposed solutions. The meeting aims to foster open communication, mutual understanding, and agreement on a resolution.\n\nDecision Making: following the conflict resolution meeting, management carefully considers all information presented and collaboratively works with the involved parties to reach a decision that prioritizes the health and safety of employees while addressing the concerns raised.\n\nImplementation of Resolutions: once a resolution is agreed upon, management ensures that appropriate actions are taken to implement the agreed-upon solutions effectively and promptly. This may involve updating policies, procedures, or practices, as well as providing necessary resources or support.\n\nFollow-Up and Monitoring: management conducts regular follow-up and monitoring to ensure that the agreed-upon resolutions are being implemented effectively and that any remaining concerns or issues are addressed in a timely manner.\n\nDocumentation: comprehensive documentation of the formal escalation process, including meeting minutes, decisions made, and actions taken, is maintained for record-keeping and future reference.\n\nClosure and Feedback: once the issue is resolved, all parties involved are provided with closure and an opportunity to provide feedback on the resolution process. This feedback helps identify areas for improvement and strengthens future conflict resolution efforts. By following this structured health and safety issue resolution process, The Company ensures that disputes are addressed in a fair, transparent, and equitable manner, ultimately promoting a safe and healthy work environment for all employees.",
      "Annual H&S Review": "Purpose: this procedure sets out how The Company formally reviews the effectiveness of its whole health and safety management system once every 12 months, so that gaps, trends, and improvement opportunities are identified and actioned rather than left to surface only after an incident.\n\nScope: this procedure applies to the entire OHSMS, including policies, procedures, training records, incident and near miss history, hazard and risk registers, and prior corrective actions.\n\nWhen it happens: the Annual H&S Review is scheduled for the same month each year, tied to the anniversary of the system's original implementation or last full review, so it never gets missed or pushed indefinitely.\n\nWhat is reviewed: incident and near miss trends over the past 12 months, including root causes and whether corrective actions were completed and effective; results of any internal or external audits; training and competency records against current requirements; the currency of policies and procedures, checking nothing has fallen out of date with legislative or operational changes; progress against the prior year's health and safety objectives and KPIs; and worker feedback and consultation outcomes from the year.\n\nOutcome: findings are documented in an Annual Review Report, covering what worked well, what did not, and a clear list of actions for the year ahead with owners and target dates assigned. This report feeds directly into the following year's Health & Safety Planning and Objectives & KPIs.\n\nResponsibility: the Annual H&S Review is led by the person responsible for health and safety within The Company, with input gathered from supervisors, workers, and (where engaged) an external H&S consultant.",
      "Performance Monitoring": "Purpose: this procedure describes how The Company tracks health and safety performance on an ongoing basis throughout the year, rather than only at the point of an incident or the Annual H&S Review.\n\nScope: applies to all health and safety activity across The Company's operations.\n\nWhat is monitored: a mix of leading and lagging indicators is tracked. Lagging indicators include incidents, near misses, first aid treatments, and lost time injuries. Leading indicators include the number of toolbox talks or site inspections completed, hazard and near miss reports raised by workers, training completion rates, and corrective actions closed out on time.\n\nHow it is monitored: relevant data is recorded as it happens through the reporting tools already in use (incident reports, site reviews, training records), then reviewed monthly by management to spot trends before they become bigger problems, rather than waiting for the Annual H&S Review to notice them.\n\nReporting: a simple monthly summary of the key indicators is compiled and shared with management, and made available to workers through toolbox talks or noticeboards where appropriate, so performance is visible to everyone, not just kept internally.\n\nAction on trends: where monitoring identifies a negative trend, for example a rise in near misses in a particular activity or site, this is investigated and addressed promptly rather than held over until the next scheduled review.",
      "Objectives & KPIs": "Purpose: this procedure sets out how The Company sets, tracks, and reviews measurable health and safety objectives each year, so improvement is deliberate and can be demonstrated, not just assumed.\n\nScope: applies to health and safety objectives set at a company-wide level, and any site or role specific objectives set beneath them.\n\nSetting objectives: objectives are set annually, informed by the findings of the Annual H&S Review, current risk profile, and any legislative or compliance requirements (including SiteWise or Totika where applicable). Each objective follows SMART criteria: specific, measurable, achievable, relevant, and time bound. For example, rather than \"improve safety culture\", an objective might be \"increase hazard reports raised by workers by 20% by the end of Q3, measured against the prior year's total\".\n\nKPIs: each objective has one or more KPIs attached that make progress genuinely measurable, not just a general impression. KPIs are a mix of leading and lagging indicators, matching what is tracked under Performance Monitoring.\n\nTracking and review: progress against objectives and KPIs is reviewed at each Management Review meeting, not left until year end, so corrective action can be taken partway through the year if something is falling behind.\n\nCommunication: objectives and KPIs are communicated to all workers, including how their day to day work contributes to them, so they are understood as shared goals rather than a management-only exercise.",
      "Management Review": "Purpose: this procedure sets out the formal Management Review meeting, where senior management within The Company steps back from day to day operations to review the health and safety management system as a whole and make decisions about its direction.\n\nScope: applies to The Company's entire OHSMS.\n\nFrequency: Management Review meetings are held at least quarterly, with an additional review following any serious incident or notifiable event regardless of where that falls in the schedule.\n\nInputs to the review: results of the most recent Annual H&S Review (where applicable); incident, near miss, and Performance Monitoring data since the last review; progress against current Objectives & KPIs; results of any internal audits (see Internal Auditing / Monitoring); status of previous corrective actions; worker consultation and feedback; and any changes to legislation, standards, or the business itself that could affect risk (new equipment, new sites, new services).\n\nOutputs of the review: decisions and actions are recorded in meeting minutes, including any changes to policy, resourcing, or objectives, along with owners and due dates for each action. Actions from the review are tracked through to completion and are itself an input to the following review.\n\nAttendance: Management Review is attended by whoever holds overall responsibility for health and safety within The Company, along with any relevant supervisors, and an external H&S consultant where one is engaged.",
      "Health & Safety Planning": "Purpose: this procedure describes how The Company plans its health and safety activity for the year ahead, so that effort is directed deliberately rather than being purely reactive to whatever comes up.\n\nScope: covers planning at a company-wide level, informed by and feeding into the Annual H&S Review, Objectives & KPIs, and Resource Allocation.\n\nDeveloping the plan: following the Annual H&S Review, an annual Health & Safety Plan is developed setting out the key activities for the year, for example planned training, scheduled audits, toolbox talk topics, planned equipment or PPE upgrades, and any project-specific safety planning for known upcoming work.\n\nWhat the plan includes: for each planned activity, the plan records what will be done, who is responsible, the timeframe, and what resources (time, budget, people) are required, so it links directly through to Resource Allocation.\n\nReview and adjustment: the plan is a working document, reviewed at each Management Review meeting and adjusted where priorities shift during the year, for example if a new risk emerges or an incident changes what needs attention.\n\nCommunication: the plan, or the relevant parts of it, is shared with workers and supervisors so everyone understands what is planned and why, rather than health and safety activity appearing to happen without explanation.",
      "Worker Consultation (expanded)": "Purpose: this procedure sets out how The Company consults with workers on health and safety matters, going beyond one-off toolbox talks to a structured, ongoing process of genuine two-way engagement.\n\nScope: applies to all workers, including any contractors working under The Company's direction, and covers consultation on hazard identification, risk controls, incident investigations, policy and procedure changes, and planning.\n\nMechanisms for consultation: regular toolbox talks and site meetings where workers can raise concerns as well as receive information; a Health & Safety Representative (HSR) where one has been requested, acting as a channel between workers and management; hazard and near miss reporting that workers are actively encouraged to use, with feedback given on what action was taken; consultation before significant changes are made that could affect worker health or safety, for example new equipment, new work methods, or site changes; and post-incident debriefs that include the workers involved, not just management review.\n\nRemoving barriers to participation: The Company recognises that language, literacy, or fear of repercussions can discourage genuine participation, and takes steps to reduce these barriers, including plain language communication, translated material where needed, and a clear no-retaliation approach to anyone raising a genuine concern.\n\nClosing the loop: consultation is not considered complete just because workers were asked. Feedback on what was raised, what was decided, and why, is given back to workers so they can see their input genuinely influenced the outcome.\n\nRecord keeping: key consultation activity (HSR meetings, significant change consultations, formal feedback sessions) is documented, so participation can be demonstrated, not just assumed to have happened.",
      "Internal Auditing / Monitoring": "Purpose: this procedure sets out how The Company checks its own health and safety management system is actually being followed in practice, not just documented on paper.\n\nScope: covers internal audits of procedures, site conditions, and records across The Company's operations.\n\nAudit schedule: an annual internal audit schedule is set, covering all key areas of the OHSMS across the year (for example hazard and risk management, contractor management, PPE, incident reporting) rather than auditing everything at once or leaving areas unchecked.\n\nWho audits: internal audits are carried out by someone with sufficient knowledge of the relevant procedure who is not solely responsible for that area day to day, so the audit gives an honest, independent check rather than someone reviewing their own work.\n\nWhat an audit covers: whether the relevant procedure is being followed on site, whether records required by the procedure are actually being kept and are up to date, and whether workers understand the procedure well enough to explain it in their own words when asked.\n\nFindings and corrective action: audit findings are documented, including any non-conformances found, with corrective actions assigned an owner and a due date. Non-conformances are tracked through to close-out and reported at the next Management Review.\n\nRelationship to external audits: internal auditing is intended to catch and fix issues before they show up in an external audit (such as SiteWise or Totika prequalification), not to duplicate that process.",
      "Resource Allocation": "Purpose: this procedure sets out how The Company ensures adequate resources, being time, budget, people, and equipment, are actually made available to carry out its health and safety commitments, rather than health and safety competing unsuccessfully against other operational priorities.\n\nScope: covers resourcing decisions that affect the OHSMS, including training, PPE, equipment maintenance, external H&S support, and staff time allocated to health and safety activities.\n\nHow resourcing decisions are made: resource needs are identified through the Annual H&S Review, Health & Safety Planning, and Objectives & KPIs, so requests for budget or time are tied to a specific, documented need rather than raised informally.\n\nApproval: resource requests that fall within the existing Health & Safety Budget are approved by whoever holds day to day responsibility for health and safety. Requests beyond the approved budget are escalated for sign off, following the same process set out in the Health & Safety Budget Management Procedure.\n\nReview: resource allocation is reviewed at each Management Review meeting, checking whether planned activities were actually resourced and completed, and whether under-resourcing contributed to any gaps identified through Performance Monitoring or Internal Auditing.\n\nAccountability: where a planned health and safety activity does not go ahead due to lack of resourcing, this is recorded and explained at Management Review, rather than simply dropped from the plan without explanation.",
      "Health Monitoring Procedure": "1. Introduction: this procedure outlines how The Company identifies where exposure monitoring and/or health monitoring may be required and manages monitoring in accordance with the Health and Safety at Work Act 2015, applicable regulations, the Privacy Act 2020 and relevant WorkSafe New Zealand guidance. The goal is to protect the health and wellbeing of employees by identifying and mitigating risks associated with workplace hazards.\n\n2. Scope: this process applies to all employees and contractors working under The Company's control. It covers health monitoring activities related to exposure to hazardous substances, noise, and other workplace risks.\n\n3. Responsibilities\n\n3.1 Employers:\n• Determine through risk assessment whether exposure monitoring and/or health monitoring is required or appropriate for workers exposed to health hazards, and arrange monitoring where required by legislation or where reasonably necessary to assess and manage work-related health risks.\n• Provide employees with information about the health monitoring process and their rights under the Privacy Act 2020.\n• Select and engage competent health monitoring providers, including occupational nurses and other qualified health professionals.\n• Maintain records of health monitoring results securely and confidentially.\n\n3.2 Employees:\n• Participate in health monitoring programs as required.\n• Report any health concerns to their supervisor or designated health and safety representative.\n• Follow safety procedures and use personal protective equipment (PPE) as instructed.\n• Workers will be fully informed about proposed biological exposure monitoring or health monitoring and must provide written informed consent before monitoring is undertaken. A worker may decline or withdraw consent. Where this occurs, The Company will discuss the worker's concerns and determine what alternative measures are necessary to manage the relevant health risk.\n\n4. Health Monitoring Program\n\n4.1 Hazard Identification: conduct regular risk assessments to identify potential health hazards in the workplace. Document identified hazards and assess the level of risk associated with each.\n\n4.2 Health Monitoring Requirements: determine health monitoring requirements based on the identified hazards and the level of risk. Refer to WorkSafe New Zealand guidelines and relevant regulations to define specific health monitoring protocols. Include lung function tests, hearing tests, and vision tests based on risk assessments specific to each job role.\n\n4.3 Selection of Health Monitoring Providers: engage qualified and accredited health monitoring providers, including occupational nurses. Ensure providers have expertise in the specific types of health monitoring required (e.g., audiometry, lung function tests, vision tests).\n\n4.4 Health Monitoring Procedures:\n• Where health monitoring is required or determined appropriate through risk assessment, monitoring is undertaken at appropriate intervals having regard to the relevant hazard, regulatory requirements and advice from the competent health monitoring provider.\n• Inform employees of the purpose, process, and confidentiality of health monitoring, in accordance with the Privacy Act 2020.\n• Obtain written consent from employees prior to conducting health monitoring.\n• Where monitoring identifies a result requiring medical assessment or follow-up, the worker is referred to an appropriately qualified health practitioner. The worker's GP may be involved where appropriate and with the worker's consent.\n• Conduct post-critical event testing following any incident that could impact employee health.\n• Exit health monitoring may be offered or undertaken where appropriate to the worker's exposure profile, applicable regulatory requirements or advice from the occupational health provider.\n\n5. Record Keeping and Confidentiality: health monitoring and exposure monitoring records are securely and confidentially retained for the period required by the applicable legislation and regulations. Where prescribed monitoring records are required to be retained for 30 years, or for a longer period for particular exposures such as asbestos, the applicable statutory retention period will be followed. Provide employees with access to their health monitoring records upon request.\n\n6. Review and Follow-Up: review health monitoring results to identify any trends or emerging health issues. Implement corrective actions to mitigate identified health risks. Conduct follow-up monitoring if required to assess the effectiveness of implemented controls. Where monitoring identifies a result requiring medical assessment or follow-up, the worker is referred to an appropriately qualified health practitioner. The worker's GP may be involved where appropriate and with the worker's consent.\n\n7. Training and Communication: provide training to employees on the importance of health monitoring and their role in the process. Communicate the results of health monitoring (in aggregate form) to all relevant stakeholders.\n\n8. Legal Compliance: regularly review and update the health monitoring process to ensure compliance with New Zealand legislation, including the Health and Safety at Work Act 2015 and the Privacy Act 2020. Stay informed of changes to health and safety regulations that may impact health monitoring requirements.\n\n9. Continuous Improvement: seek feedback from employees and health monitoring providers to improve the health monitoring process. Implement improvements based on feedback and new best practices in health and safety.",
      "Return to Work Procedure": "Purpose: to provide a structured process for employees returning to work after an injury, in alignment with ACC (Accident Compensation Corporation) guidelines, and to ensure that employees are supported during their recovery and reintegration into the workplace.\n\nScope: this procedure applies to The Company employees who require support to safely remain at or return to work following injury or illness, whether work-related or non-work-related.\n\n1. Reporting the Injury: employees must promptly report work-related injuries and illnesses. Where a non-work injury or illness may affect an employee's ability to safely perform their duties, the employee must advise their supervisor of relevant work capacity or restrictions as soon as reasonably practicable.\n\n2. Engagement with ACC: where ACC is involved, The Company will cooperate with the employee, ACC, treatment providers and rehabilitation providers as appropriate to support a safe and sustainable return to work.\n\n3. Individual Return to Work Plan: where required, an individual return-to-work plan is developed in consultation with the employee and based on current medical certification, functional capacity and work restrictions. ACC, treatment providers or rehabilitation providers may also contribute where applicable and appropriately authorised.\n\nAssessment: an assessment discussion is undertaken with the employee and relevant The Company personnel. Information or recommendations from treatment providers, ACC or rehabilitation providers are considered where relevant and appropriately authorised.\n\nRTW Plan Development, the plan will include specific details regarding:\n• The employee's capabilities and work restrictions\n• Gradual return-to-work schedule, including hours and duties\n• Reasonable accommodations, if needed\n• Regular monitoring of progress\n• Coordination with ACC for any additional support or changes to the plan\n\n4. Supporting the Return to Work Process: The Company is committed to supporting employees throughout the return-to-work process. Support will include:\n• Modified Duties: where necessary, temporary adjustments will be made to the employee's tasks to align with their abilities while they recover.\n• Gradual Reintroduction: the company will support a gradual increase in working hours or tasks if the employee's condition requires it.\n• Ongoing Communication: regular check-ins between the employee, supervisor, and HR will be conducted to ensure the return-to-work plan is effective and adjust it as needed.\n\n5. Monitoring and Adjusting the Plan: the RTW plan will be reviewed regularly and adjusted based on the employee's recovery and feedback. If an employee requires further medical treatment or rehabilitation, the company will cooperate with ACC to modify the RTW plan accordingly.\n\n6. Confidentiality: all information regarding the employee's injury, recovery, and RTW plan will be kept confidential and only shared with relevant personnel involved in the RTW process. The company will adhere to all privacy laws and policies.\n\n7. Employee Responsibilities, employees are expected to:\n• Follow medical advice and attend all required medical appointments.\n• Actively engage with the RTW plan and communicate any concerns or issues.\n• Notify their supervisor promptly of any changes in their condition.\n\n8. Employer Responsibilities, the employer will:\n• Cooperate with ACC in developing the RTW plan.\n• Ensure a safe working environment during the employee's return to work.\n• Provide reasonable accommodations to support the employee's recovery.\n• Regularly review the RTW plan and make adjustments as necessary.\n\n9. End of Process: once the employee has returned to their substantive duties, reached an agreed sustainable work arrangement, or no further reasonable return-to-work measures are required, the RTW process will be considered complete. However, ongoing monitoring or light duties may still be available if required.",
      "Contractor Management Procedure": "The purpose of this procedure is to define how contractors at The Company are selected and managed with respect to the health and safety of workers, and the risks associated with their work. It applies to all staff who engage contractors on a contract-for-services basis, across all sites and operations of The Company.\n\nDefinitions: A Contractor is any individual or organisation providing services under a contract for services (this excludes suppliers who only supply goods or materials). A Contract Manager is The Company staff member responsible for ensuring contract obligations are met. A documented safe work method may take the form of a Task Analysis, Job Safety Analysis (JSA), Safe Work Method Statement (SWMS), Safe Operating Procedure (SOP), or another suitable risk assessment appropriate to the work. It identifies the work or task, associated hazards and risks, and the controls required. A Subcontractor provides services directly to one of The Company's contractors. Worker has the same meaning as under the Health and Safety at Work Act 2015, covering employees, contractors, subcontractors, labour hire, apprentices/trainees, and volunteers.\n\nPrequalification: Prequalifying contractors confirms they have the skills, experience, resources, and systems to work safely, for themselves, our staff, and anyone else exposed to that work. The Contract Manager is responsible for prequalification where expertise is needed to assess systems or evidence. Contractor prequalification is reviewed at least every two years, and sooner where there is a significant change to the contractor's work, health and safety systems or risk profile, or where a serious health and safety concern arises. Contractors who don't meet The Company's minimum requirements are given feedback on what's needed before they can be engaged.\n\nDocumentation: Effective contractor management depends on consultation, communication, and collaboration between businesses. The Company provides contractors with all health and safety requirements and information as part of prequalification, so appropriate planning can occur. Contracts clearly define expected performance standards, whether the site will be handed over to the contractor, and health and safety roles and responsibilities.\n\nOnboarding: All contractors receive a health and safety induction before starting work, covering at minimum: roles and responsibilities, an overview of the work, hazards and controls for the work/site, emergency procedures, incident and hazard reporting, available facilities, and site requirements. The Contract Manager is responsible for ensuring every contractor is inducted.\n\nPlan Works: The Company consults, cooperates, and coordinates activities with contractors and subcontractors — finding out who is doing what and working together so risks are managed. Beyond being an HSWA requirement, it means work is better planned with fewer incidents, delays, or cancellations. Before work commences, the contractor must provide health and safety planning appropriate to the nature and level of risk associated with the work. For work requiring documented task planning, this may include a Task Analysis, JSA, SWMS, SOP, SSSP or equivalent document. The agreed controls must be implemented throughout the work and any material changes to the planned work or controls communicated to The Company.\n\nMonitoring: The Contract Manager ensures contractor performance is monitored at a frequency and level proportionate to the risks associated with the work. Monitoring considers whether agreed controls are being implemented, work is being undertaken safely, and identified issues are appropriately addressed. Actions and improvements are agreed with the contractor, made SMART (specific, measurable, achievable, relevant, time-bound), documented, and monitored through regular meetings and site inspections.\n\nReview: All contractors are subject to a regular review process arranged by the Contract Manager, at minimum covering: safety performance (with a focus on serious incidents and learnings), what worked well, what didn't work well, and opportunities for improvement. Formal contractor performance review is completed at least every two years for ongoing contractors and, where appropriate, at completion of significant contracts. Earlier review may be triggered by a serious incident, repeated non-conformance, significant change in scope or other material health and safety concern. Reviews are documented and kept on file.\n\nRelevant Legislation: Health and Safety at Work Act 2015; Health and Safety at Work (Worker Engagement, Participation, and Representation) Regulations 2016.",
      "Hazard & Risk Management Procedure": "The purpose of this procedure is to define how hazards and risks are identified and managed with respect to the health and safety of workers, and the risks associated with their work. It applies to all staff and contractors and covers hazard and risk management throughout The Company.\n\nWhat is a hazard? A hazard is any source of potential damage, harm, or adverse health effects on something or someone under certain conditions. This includes a person's behaviour where that behaviour has the potential to cause death, injury, or illness (whether resulting from physical or mental fatigue, drugs, alcohol, traumatic shock, or another temporary condition affecting behaviour).\n\nWhat is harm? Harm can be physical damage, material damage, or actual or potential ill effects or danger. Harm can be acute, where effects are felt immediately (e.g. cutting a hand on a blade), or chronic, where effects gradually develop or worsen over time (e.g. lung disease from breathing in fine dust over many years).\n\nWhat is a risk? Risks arise from people being exposed to a hazard.\n\nIdentifying and Reporting Risks and Hazards: The Company identifies hazards that may give rise to health and safety risks. Hazards are not always obvious, so identification considers routine and non-routine activities, emergency situations, people who may be affected, the work environment, plant and substances, and planned or actual changes to the business or work. After identifying hazards and who might be affected, The Company evaluates the severity the risk may present and establishes suitable, effective controls to reduce the risk so far as is reasonably practicable.\n\nRisk Assessment: Hazards are risk-rated using the Risk Matrix. First, determine the likelihood of the identified event or exposure occurring. Second, determine the reasonably foreseeable consequence should it occur. Following both lines to where they meet gives the initial risk score; this is repeated once controls are decided to give the residual risk score. Risk levels range from Very Low (manage by routine procedures) through Low, Moderate, and High, to Critical (stop work immediately). Assessing severity requires considering the duration and frequency of exposure, the number of people affected, the competence of those exposed, the type and condition of equipment, and the availability of first aid or emergency support. Reference: Risk Assessment Form.\n\nManaging Risks and Hazards: The HSWA focuses on the management of work-related risks and hazards, and requires The Company to follow the Plan-Do-Check-Act cycle of continuous improvement.\n\nControlling Risks and Hazards: The Company will try to eliminate a risk where reasonably practicable (e.g. removing a trip hazard or faulty equipment). Where a risk cannot be eliminated, The Company works through the hierarchy of controls, minimising risk so far as is reasonably practicable by first substituting with a lower-risk activity or substance, isolating people from the hazard, or applying engineering control measures. Where risk remains after higher-order controls have been considered and implemented so far as reasonably practicable, administrative controls and PPE may be used to further minimise the residual risk. Refer: Risk Management Process & Hazard & Risk Process Training.\n\nWorker Participation: Worker involvement is a key part of hazard and risk management — workers who do the work are usually best placed to identify risks and hazards and have ideas for controlling them. Workers are also responsible for ensuring their own work doesn't become a risk or hazard to themselves or anyone else.\n\nHealth Risks/Hazards: Where workers may be exposed to health hazards, The Company determines whether exposure monitoring and/or health monitoring is required or appropriate in accordance with the Health Monitoring Procedure. If it's unclear whether exposure levels are being exceeded, exposure monitoring is undertaken, engaging a suitable Occupational Health Service (e.g. hearing and lung function testing).\n\nMonitoring: The Company periodically reviews risk assessments and re-assesses controls after any significant change to the workplace or process, after an accident or ill-health incident has occurred, or after near-misses have been reported.",
      "Hazardous Substances Procedure": "This procedure outlines requirements for the safe identification, storage, handling, use, transportation and disposal of hazardous substances in the workplace in accordance with the Health and Safety at Work Act 2015, the Health and Safety at Work (Hazardous Substances) Regulations 2017, applicable requirements under the Hazardous Substances and New Organisms Act 1996, and relevant EPA and WorkSafe New Zealand requirements and guidance. It applies to all workers, contractors, and visitors at all company-controlled sites where hazardous substances are present, covering identification, inventory, storage, segregation, spill response, decanting, transport, and emergency preparedness.\n\nResponsibilities: Management ensures resources for effective hazardous substance management, maintains an accurate inventory, implements controls identified by the Calculator, SDS, or HSNO approval, and ensures staff are trained and competent. Workers follow safe work procedures, use PPE as directed, participate in training, report unsafe conditions or incidents, and don't handle hazardous substances unless trained and authorised. Supervisors conduct regular inspections and audits of storage, review SDS accessibility, and monitor PPE use and emergency readiness.\n\nPotential Hazards and Risks: Workers are made aware of spills, skin reactions, chemical burns, environmental damage, toxic fumes or gases, manual handling injuries from container weight or awkward handling, acute or chronic exposure effects, eye injuries, and explosion or fire from chemical reactions or vapours.\n\nPersonal Protective Equipment: The Company provides all workers with appropriate PPE and ensures training in its correct selection, use, maintenance, and storage, meeting the minimum requirements on the SDS for each substance — gloves, respiratory protection, eye protection, protective clothing, and hearing protection as required, with footwear worn at all times.\n\nHazardous Substance Inventory and Calculator: The Company maintains an up-to-date hazardous substances inventory in accordance with applicable workplace hazardous substances requirements, entering each substance into the Hazardous Substances Calculator with product name, HSNO approval number or CAS number, UN class and packing group, storage type, and maximum quantity. The inventory includes the product/chemical name and UN number, maximum quantity at the workplace, physical state, container size/type, location and storage/segregation requirements, current SDS, and waste disposal requirements.\n\nIncompatible Substances: Not all hazardous substances can be stored together safely — incompatible substances (e.g. flammables like petrol and oxidisers like pool chemicals) must be stored separately to prevent mixing in a leak or spill, referring to the SDS for specific incompatibilities.\n\nStorage: The Company stores only what it needs, to reduce compliance costs and risk, with signage warning of hazards, precautions, and emergency actions where required. Spill kits and, for larger quantities, secondary containment (bunding) are in place. Containers are kept lidded to reduce vapour release and spill risk. Flammable substances are stored in accordance with their classification, quantity, Safety Data Sheet requirements and applicable hazardous substances regulations. Approved flammable-goods cabinets or other compliant storage arrangements are used where required, with adequate ventilation and ignition sources removed.\n\nDecanting: Hazardous substances are kept in their original containers where possible. Where decanting is required, workers read the SDS, wear recommended PPE, ventilate the area, use only compatible containers, ensure containers are clean, and clearly label the new container with product name and hazard pictogram/statement. Hazardous substances are never stored in food or drink containers.\n\nGas Cylinders: Cylinders (including empty ones) are stored, handled, and used upright unless designed for horizontal use, and maintained and tested at the intervals required by applicable legislation, standards and supplier requirements, using an approved test station where required. Storage locations are suitable, secure, well ventilated, and — for flammable gases — fire resistant and separated from ignition sources, with fire extinguishers available.\n\nHazardous Areas and Compliance: Hazardous areas (where flammable vapours may be present) require ignition sources to be controlled, with electrical equipment kept safe or at a safe distance. A Location Compliance Certificate is obtained where required by the applicable hazardous substances regulations, using the WorkSafe Hazardous Substances Calculator and competent specialist advice to determine the applicable requirements.This procedure outlines the requirements for the safe storage, handling, use, transportation, and disposal of hazardous substances at the workplace, ensuring compliance with the Hazardous Substances and New Organisms (HSNO) Act 1996, relevant EPA and WorkSafe New Zealand guidelines, and minimising risk to worker health, property, and the environment. It applies to all workers, contractors, and visitors at all company-controlled sites where hazardous substances are present, covering identification, inventory, storage, segregation, spill response, decanting, transport, and emergency preparedness.\n\nStorage & Inventory: Potential hazards and risks associated with hazardous substances include spills, chemical burns, fumes, exposure and health effects, and explosion or fire, as well as skin reactions, environmental damage, manual handling injuries, and eye injuries.\n\nHazardous Substance Inventory and Calculator: hazardous substances are entered into WorkSafe's online Hazardous Substances Calculator (hazardoussubstances.govt.nz/calculator), generally by product name, though the HSNO approval number or CAS number can also be used. The inventory must include the product or chemical name and UN number of each hazardous substance, the maximum amount likely to be at the workplace, its location, specific storage and segregation requirements, the current SDS (or a condensed version of its key information), and waste and waste disposal requirements. The Calculator lists the key controls that apply, including signage, segregation and area requirements, and the inventory can be printed and updated at any time using the pin provided.\n\nIncompatibles: not all hazardous substances can be stored together safely — different substances can cause a fire or explosion if they come into contact, so incompatible substances are stored separately to prevent mixing in a leak or spill. Flammables (such as petrol, turps, solvent paints and thinners) are kept away from oxidisers (such as hydrogen peroxide or pool chemicals); the SDS for each substance specifies what it must be kept away from.\n\nStore only what's needed, and store it safely:\n• Hazardous substances are kept to a minimum to make them easier to manage and reduce compliance needs and costs. Appropriate signage is used depending on the type and amount of substances present. Labelling and packaging are kept clear, up to date and correctly classified.\n• Detailed, up-to-date SDS documentation is maintained for each substance.\n• Incompatible substances are never stored together.\n• Storage requirements from each SDS are implemented and maintained.\n• Storage areas are regularly inspected.\n• Emergency response plans are established for hazardous substance storage.\n• Correct spill kits are provided for the substances being stored.\n• Adequate security measures prevent unauthorised access.\n• Accurate records of storage activities, quantities and conditions are maintained.\n\nBe prepared for a spill: measures are in place to control any hazardous substance spill or leak — a spill kit for small spills, and secondary containment (bunding) for larger amounts. Lids are kept on hazardous substance containers at all times to reduce vapour release and the chance of spills.\n\nFlammable substances are stored in smaller amounts in an approved metal cabinet complying with AS1940-2004, with up to 250 L able to be stored in an approved cabinet provided each container is under 20 L; very large amounts require a dangerous goods store or separate building. Adequate ventilation is provided wherever flammable gases or liquids are used or stored, to prevent build-up of flammable vapours, and ignition sources are removed from these areas.\n\nTransportation of hazardous substances requires:\n• Identifying and classifying the substances.\n• Accurate labelling on approved packaging aligned with HSNO regulations.\n• SDS sheets available for all transported goods.\n• A D endorsement on the driver's licence where substances are classified as dangerous goods.\n• Known emergency response plans, with all workers trained where dangerous goods are transported.\n• Appropriate spill kits available based on the substance type and amount.\n• Detailed record-keeping of transportation activities.\n\nDecanting or transferring substances:\n• Hazardous substances are kept in their original containers wherever possible. Where decanting is necessary, the SDS is read first to note the substance's hazards.\n• Recommended PPE (eye protection, breathing protection, gloves, overalls) is worn and properly fitted, with eye wash stations or safety showers available where needed.\n• Work areas are ventilated.\n• Only containers able to safely store the substance are used, checking the SDS for material incompatibilities.\n• New containers are clean and free of residue.\n• New containers are clearly labelled with the product name and correct hazard pictogram and statement.\n• Ignition sources are avoided when transferring flammable liquids.\n• Containers are correctly earthed or bonded to prevent static discharge.\n• A spill kit is kept ready during transfer. Hazardous substances are never stored in food or drink containers.\n\nGas cylinders (including empty ones) are stored and handled carefully, upright unless designed for horizontal use — most general-purpose LPG cylinders are upright-use, vehicle and forklift cylinders are designed for horizontal use, and acetylene cylinders must be used upright (or stood upright for at least an hour before use if transported horizontally) due to their acetone gas solvent. Gas cylinders are maintained and tested at the intervals required by applicable legislation, standards and supplier requirements, using an approved test station where required, since poorly maintained cylinders may leak or cause an explosion. Cylinders are stored in a location suitable for the type and quantity stored, that is secure, well ventilated, and has an emergency response plan and signage in place if required; for flammable gases, the location is also fire resistant and suitably separated from ignition sources, with fire extinguishers available.\n\nHazardous areas — where flammable vapours may be present — require special precautions to prevent ignition; their dimensions depend on the substances present and ventilation in place. Electrical equipment is kept suitable or away from these areas, generally extending 3 m from a dangerous goods cabinet or store and 1 m above, with advice sought from a registered electrical inspector where needed.\n\nA Location Compliance Certificate is obtained where required by the applicable hazardous substances regulations. The WorkSafe Hazardous Substances Calculator and competent specialist advice may be used to determine the applicable requirements, and if a certificate is needed a compliance certifier arranges a visit to the workplace. All workers handling hazardous substances complete training, recorded with their name, date trained, and signature confirming they understand the procedure.",
      "Incident Reporting & Investigation Procedure": "This procedure defines how incidents are reported and investigated within The Company, applying to all staff and contractors.\n\nReporting: all incidents, injuries, illnesses, near misses and health and safety non-conformities must be reported to the relevant supervisor or manager as soon as reasonably practicable. A formal incident report must be completed as soon as practicable and, wherever possible, within 24 hours.\n\nInvestigation: Management determines appropriate corrective actions with worker input, to be recorded, assigned, and closed out. Investigations determine whether procedures need review, and outcomes are communicated to relevant workers and PCBUs. For notifiable events, serious incidents or other incidents determined by management to warrant formal investigation, The Company may engage H.A.R.M Limited or another suitably competent person to undertake or assist with an appropriate investigation. The investigation methodology will be proportionate to the nature and seriousness of the event.\n\nNotifiable Events: where an incident is, or could reasonably be, a notifiable event, the relevant area must not be disturbed except where necessary to assist an injured person, remove a deceased person, make the site safe or minimise the risk of a further notifiable event, or as otherwise permitted by law. Management must promptly assess whether the event is notifiable. Where a notifiable event has occurred, WorkSafe New Zealand must be notified as soon as possible and the site preserved until released by an Inspector, subject to the statutory exceptions. Records of notifiable events are retained for at least five years from the date WorkSafe New Zealand is notified.",
      "Induction & Training Procedure": "Purpose: The Company is committed to ensuring all workers are inducted and trained to perform their duties safely, protecting them from injury and health risks while at work. Induction provides essential information and training to workers, contractors, labour-hire workers, volunteers, and visitors before they undertake any work and/or face any health, safety, or welfare risks.\n\nScope: this procedure outlines the induction and training process for workers, contractors, labour hire workers, volunteers and visitors, with the level of induction appropriate to the activities they will undertake and the risks to which they may be exposed on sites owned or operated by The Company, implemented prior to the commencement of any work.\n\nRoles & Responsibilities: Managers/Supervisors conduct inductions for new or transferred employees, contractors, labour hire workers, volunteers, and visitors, and maintain and update induction records according to this procedure. Workers, contractors, labour hire workers, volunteers, and visitors ensure their actions do not endanger themselves or others, actively participate in the induction process, and comply with The Company's policies and procedures.\n\nProcedure: all workers, contractors, labour hire workers, volunteers, and visitors complete an induction led by the relevant manager/supervisor before beginning work, adapted to consider the specific risks associated with the role and work environment.\n\nOnboarding Process — Day One:\n• Employment contract signed and returned.\n• Licenses and training certificates collected.\n• Bank and next-of-kin details obtained.\n• Absence and other employment policies reviewed.\n• Site security, entry and exit procedures, and attendance recording explained.\n• Workers are given the opportunity to identify any medical or emergency information relevant to their safety at work. Information voluntarily provided will be managed confidentially and shared only with appropriate personnel where reasonably necessary and with the worker's knowledge and, where required, consent.\n\nInduction & Orientation Program covers:\n• Incident and accident reporting, including notifiable events and the importance of near-miss reporting.\n• Health and safety responsibilities, ensuring a clear understanding of personal and company obligations.\n• Hazard identification and risk management training, with competency confirmed before sign-off.\n• General health and safety information including the Health & Safety Manual and Policies, worker participation and leave requirements, the buddy program, PPE issuance and training, emergency procedures, mobile phone use while driving, reporting forms and documentation, and health and safety assistance.\n\nExisting Training: upon employment, each worker's existing qualifications and experience are assessed, matched to the training register, and any additional required training is organised.\n\nCompetence: The Company determines worker competency having regard to relevant qualifications, licences, training, skills, knowledge and experience. Where required, competency is verified through observation, assessment or other appropriate evidence before the worker undertakes work unsupervised. Annual training plans support ongoing development, and workers are competency-assessed before unsupervised equipment use.\n\nSpecial Needs: The Company considers the special needs of new workers, contractors, labour hire workers, volunteers, and visitors — written materials may be translated or presented in simplified language, with further assistance provided if needed.\n\nManagement of New, Young and Other Workers Requiring Additional Support:\n• The Company provides additional guidance and supervision through a tailored induction with extra focus on workplace hazards, emergency procedures, and safety policies.\n• A buddy program assigning experienced workers to mentor young or vulnerable workers.\n• Ongoing supervision with regular manager check-ins to monitor understanding of safety practices.\n• Clear reporting mechanisms encouraging young and vulnerable workers to report concerns without hesitation.\n\nTransferring Workers: when transferring workers to new tasks or departments, they receive a specific induction covering risks associated with the new role and environment.\n\nRefresher and Planned Training: all training records are logged in the Training & Competency Register. The Company administrator monitors certification expiry dates, arranging refresher training as needed and scheduling additional training based on role requirements.\n\nRecord Maintenance: induction records for workers, contractors, labour hire workers, volunteers, and visitors are maintained for five years.",
      "PPE Procedure": "Purpose: this procedure defines the requirements, responsibilities and practices for the use of Personal Protective Equipment (PPE) whenever it has been identified as a risk control measure.\n\nScope: this procedure applies to all PPE items used in The Company.\n\nHazard Identification and Risk Assessment: The Company completes a risk assessment of all work within the workplace in consultation with workers and records this information in The Company Hazard Register. Hazard identification takes place when new plant, equipment or tasks are introduced into the workplace, for all existing plant and equipment, before any changes are made to the system of work for tasks, before plant or equipment is used in a manner other than what it was designed for, and when new information regarding task safety becomes available.\n\nRisk Management: The Company applies the hierarchy of controls to the management of risks under its control — risk from operational activities must be eliminated or, where that is not reasonably practicable, minimised using the hierarchy of controls. PPE is used where higher-order control measures do not adequately eliminate or minimise the risk, as an interim measure while more effective controls are implemented, or to supplement higher-order controls.\n\nSelection of PPE:\n• PPE must be appropriate to the task and level of risk.\n• Used in every situation where the need has been identified through a risk assessment, safe work procedure, or other relevant safety information.\n• Selected, used and maintained in accordance with relevant legislation, AS/NZS standards, codes of practice and manufacturer's instructions.\n• Selected and, where necessary, fitted to suit the individual user. Proof of compliance with the relevant AS/NZS standard is a prerequisite for the purchase of any PPE.\n\nUse of PPE: correct fit is essential and must be checked by the user before use — where RPE is issued, a quantitative fit test by a qualified external provider is arranged annually. Workers and visitors are instructed in the correct use of PPE, including the need for it, its basic design principles, application and limitations, with PPE requirements incorporated into inductions.\n\nMaintenance of PPE: all PPE is maintained, tested and stored according to manufacturer's requirements, kept in a clean, hygienic and effective condition, with damaged PPE repaired or replaced.\n\nIssuing of PPE: PPE is provided to workers, volunteers and visitors where required. Where contractors or subcontractors carry out work for The Company, arrangements for the provision of required PPE will be confirmed before work begins. PPE may be provided by The Company, another PCBU, or by the worker where they genuinely and voluntarily choose to provide their own. The Company will ensure any PPE used is suitable for the work and provides appropriate protection.\n\nReview and Evaluation:\n• Users inspect PPE for signs of deterioration, missing or damaged parts, and expiry date. PPE must not be used in a sub-standard condition.\n• Faulty, damaged or excessively worn PPE is withdrawn from use immediately and replaced.\n• The adequacy of PPE is assessed regularly to ensure personal injuries are not occurring.\n\nResponsibilities:\n• The PCBU (The Company) ensures this procedure is implemented into its activities and provides sufficient resources for all PPE.\n• Managers & Supervisors implement this procedure in their area of responsibility: select appropriate PPE compliant with the relevant AS/NZS, ensure PPE is used properly through information, training, instruction and supervision, ensure reusable PPE is kept clean, maintained and stored appropriately, schedule and carry out inspections and maintenance, ensure worn, expired or faulty PPE is replaced, and lead by example.\n• Workers avoid placing themselves or others at risk, wear and use required PPE, participate in PPE selection and training where applicable, inspect PPE before use, and promptly report any defect, damage, loss or concern. Where a worker voluntarily provides their own PPE, The Company will ensure it is suitable and provides appropriate protection.\n• Visitors and others avoid placing themselves or others at risk, wear protective clothing as required, and use and look after PPE provided.\n\nReplacement, Monitoring and Issuing of PPE: PPE requirements are reviewed annually, or sooner if an incident investigation identifies additional PPE is required, or if there is a change to work tasks or processes. All required PPE is issued to workers upon induction and recorded in the PPE register. Workers needing replacement PPE before expiry use the Request PPE form in the HARM App, with The Company Administrator arranging purchase and issue. Workers are asked weekly at toolbox meetings whether they require additional PPE, recorded on the templates or HARM App for action.\n\nHard Hats: worn by workers whenever an overhead risk exists. This is mandatory PPE for workers on site when operating plant or working around machinery.\n\nEye & Face Protection: safety glasses are available to all workers and worn when there is potential for eye injury. This is required PPE whenever workers are around objects that can cause eye or face damage, such as machinery or grinders.\n\nHearing Protection: ear muffs or plugs are available and worn where there is potential for noise-induced hearing loss. This is required PPE for any task with noise above 85 decibels.\n\nRespiratory Protection: masks or respirators are available and worn where there is potential exposure to respiratory damage. Appropriate respiratory protective equipment is selected according to the nature and level of respiratory risk. Disposable respirators are only used where they provide adequate protection for the identified contaminant and exposure level.\n\nHi-Vis Vest: worn by workers whenever working around plant and machinery or where traffic risks exist. This is mandatory PPE for all workers at all times on site.\n\nGloves: worn by workers whenever there is a risk of hand injury. This is required PPE for any task with a risk of hand injury.\n\nSafety Footwear: worn by workers whenever there is a potential foot injury. This is mandatory PPE for all workers at all times on site.",
    };

    const realSectionContent = {
      "1. Introduction": "This manual provides The Company's workers, contractors, and visitors with a clear framework for how health and safety is managed across the business, and forms the foundation of The Company's Health and Safety Management System (OHSMS).",
      "2. Purpose": "The purpose of this manual is to provide a framework to meet The Company's responsibilities under the Health and Safety at Work Act 2015 (HSWA) and all associated regulations, guidelines, codes of practice and standards in New Zealand. This framework provides a management system to manage health and safety risks, opportunities, and performance.",
      "3. Scope": "The Company has established this Health and Safety Management System (OHSMS) with support from H.A.R.M Limited to provide workers with clear health and safety processes and procedures. H.A.R.M Limited provides The Company with ongoing support and advice, as well as additional forms and templates to work alongside this system.",
      "4. Health & Safety Policy": "The Company has outlined all levels of authority and responsibility within the health and safety policy to ensure all workers are enabled and supported to fulfil their individual health and safety responsibilities.",
      "5. Leadership, Commitment, and Worker Participation": "The Officers of The Company and any person in a position of influence demonstrate their commitment to this OHSMS by following the Health and Safety Policy, which states the support, culture, leadership, responsibilities, and accountabilities within The Company. The Company takes overall responsibility to provide a safe, healthy workplace, free from risk so far as is reasonably practicable. Management ensures all policies, procedures, and objectives are in place and compatible with The Company's direction, work practices, goals, and targets. Workers at each level are responsible for the aspects of this OHSMS over which they have control, as outlined in the Health and Safety Policy.",
      "5.1 Organisational Roles, Responsibilities, Accountabilities & Authorities": "The Company's level of authority by position is outlined in its organisational structure. Position responsibilities are set out in The Company's Health and Safety Policy as commitments.",
      "5.2 Participation and Consultation": "The Company provides time, training, and resources to enable participation by workers at all levels, and communicates OHSMS information clearly and understandably. Barriers to participation — including language barriers, fear of retaliation, or discouraging practices — are minimised. Workers are actively involved in regular meetings covering risk management, competency and training, incident investigation, objectives and planning, contractor management, audit programs, continual improvement, and relevant hazards and risks. Relevant health and safety consultation, meetings, decisions and agreed actions are documented and retained as appropriate.",
      "5.3 Health & Safety Issue Resolution": "Health and safety issues may arise when a worker's concerns remain unresolved following discussion with the worker and the PCBU, often stemming from differing opinions on risk or the acceptability of controls. In this event, The Company and affected workers will follow an agreed issue-resolution process consistent with the Health and Safety at Work Act 2015 and applicable worker engagement and participation requirements.",
      "5.4 Health & Safety Representatives": "Where The Company is required to initiate an HSR election following a worker request, or otherwise elects to establish HSR representation, the applicable worker representation and election requirements will be followed. Elected HSRs will be supported, trained where applicable, and given reasonable opportunities to perform their functions. The HSR is made known to all workers including contractors, given appropriate training to fulfil their duties, and given the opportunity to actively participate in regular health and safety meetings.",
      "6. Planning": "This OHSMS prevents or reduces risk within The Company and ensures continual improvement through planning and worker participation. The Company considers the hazards and risks associated with its work on an ongoing basis, ensures legal requirements are met, and gives ample opportunity to identify and manage any temporary or significant changes.",
      "6.1 Objectives": "To achieve continuous improvement in health and safety, The Company plans objectives individually or collectively, documenting and assigning responsibility at management level, with consideration given to diversity aspects such as cultural or language barriers.",
      "7. Hazard Identification and Assessment of OHS Risks": "The Company, with worker input, actively establishes, implements, and maintains a proactive process for identifying hazards.",
      "7.1 Legal and Other Requirements": "The Company considers legal requirements to ensure compliance, utilising the WorkSafe New Zealand website for guidance and information relating to OHS.",
      "8. Risk Management": "The Company's approach to managing risk once hazards have been identified, working through appropriate controls to reduce risk so far as is reasonably practicable.",
      "8.1 Hierarchy of Controls": "The Company will try to eliminate a risk where reasonably practicable. Where a risk cannot be eliminated, The Company works through the hierarchy of controls: substituting with a lower-risk activity or substance, isolating people from the hazard, or applying engineering controls. If a risk remains, administrative controls are put in place. Finally, if a risk still remains, suitable personal protective equipment (PPE) is used — PPE is never the first or only control considered.",
      "9. Incidents and Corrective Actions": "In the event of an incident or non-conformity, all workers must notify The Company of the occurrence, and an investigation is completed to identify the root cause and evaluate current risk management. Incidents must be notified to a supervisor as soon as safe to do so, and documented via a formal report within 24 hours. Corrective actions are determined by management with worker input, recorded, assigned, and closed out. All incidents are preserved until notification has occurred, to determine whether the incident is a notifiable event — if so, the scene is frozen, the notifiable event process followed, and WorkSafe New Zealand notified.",
      "9.1 Incident Reporting": "The Company ensures incidents, injuries, illnesses and near misses relating to work health and safety are promptly reported and appropriately documented, investigated and followed through to corrective action where required.",
      "10. Plant & Equipment": "The Company ensures all plant and equipment is fit for purpose, meets standard, and is in good working order with all safety mechanisms and guards fitted. Equipment is used only by trained, licensed (if applicable), and competent workers. New plant and equipment is assessed on introduction and added to an equipment and maintenance register, with regular checks undertaken. Unsafe plant or equipment is removed from operation until repaired by a competent person.",
      "11. Contractors": "The Company follows a Contractor Pre-Qualification Process to ensure engaged contractors and sub-contractors have adequate processes and controls in place, identifying health and safety performance and systems, insurance, training and competencies, operating and emergency procedures, incident management reporting, and plant and equipment. Contractors are periodically monitored through SSSP and Contractor Evaluations, with pre-qualification completed bi-annually.",
      "12. Emergency Preparedness and Response": "The Company maintains a documented emergency response plan, including rescue plans for high-risk work where applicable, made available to all workers and visitors. Emergency arrangements are tested at planned intervals appropriate to the workplace and emergency risks, and after significant changes where required. Emergency exercises and actual emergency events are reviewed to identify improvements. Adequate first aid supplies are available at all times, with an appropriate number of workers trained in first aid.",
      "13. Personal Protective Equipment (PPE)": "The Company ensures workers are supplied with fit-for-purpose PPE, purchased by The Company, fitted to each worker, and replaced when no longer in good condition. Workers must promptly report damaged, defective or unsuitable PPE and must not use PPE that is incapable of providing the required protection. Suitable replacement PPE must be provided before the worker undertakes work requiring that protection. Training on correct use and storage is provided, with issue and replacement dates recorded on each worker's individual PPE register.",
      "14. Exposure and Health Monitoring": "The Company's risk management process determines whether workers are likely to be exposed to a health hazard or hazardous substance. Where workers may be exposed to health hazards, The Company determines whether exposure monitoring and/or health monitoring is required or appropriate. Monitoring is undertaken where required by legislation or where necessary to assess exposure, worker health or the effectiveness of controls, at The Company's cost, with results provided to workers and records kept in accordance with the Privacy Act. Health monitoring is only undertaken by an experienced occupational health practitioner.",
      "15. Hazardous Substances": "The Company identifies any substances classed as hazardous by substance classification codes. These are controlled with adequate resources, training, handling, storage, and equipment. All hazardous substances have Safety Data Sheets (SDS) available, and incompatible substances are segregated when stored.",
      "16. Training": "The Company ensures all workers are appropriately inducted and trained before undertaking work, with ongoing competence maintained throughout their employment.",
      "16.1 Induction": "The Company ensures all workers are inducted prior to commencing work, covering: The Company's induction, incident and accident reporting, health and safety responsibilities, the health and safety manual, policies and procedures, hazard ID and risk management processes, a buddy program, PPE issue and training, and emergency procedures. Competency is assessed, and workers must be deemed competent to identify and control a hazard or risk before being signed off.",
      "16.2 Competence": "The Company determines and takes action to ensure workers are competent based on education, induction, training, and experience, retaining documentation as evidence and reviewing competencies on an ongoing basis, including annual training plans.",
      "17. Reporting": "The Company reports within the app or on the templates provided. All workers are given training in reporting requirements during induction, with adequate time provided to complete this.",
      "18. Monitoring & Review": "The Company monitors and reviews its OHSMS on an ongoing basis to ensure it remains effective and continues to improve.",
      "18.1 Monitoring, Measurement, KPIs, Analysis and Evaluation": "On an annual basis, The Company reviews and evaluates current OHSMS processes and procedures, making applicable changes using the Annual Health & Safety Review form. KPIs are measured from the Annual Objectives Form, with objectives set annually to ensure continuous improvement.",
      "18.2 Corrective Actions": "The Company ensures all corrective actions are assigned and managed through to close-out, with open actions reviewed regularly and progress tracked.",
      "18.3 Document, SOP and H.A.R.M Register Review": "The Company is provided updated or additional templates upon annual review, considering legislative changes, industry learnings, incidents, or additional WorkSafe New Zealand guidance. SOP documentation is reviewed annually or when a new process, business change, or plant/equipment change arises. The Hazard/Risk Register is updated from toolbox talks, meetings, or learnings from incidents and reviews.",
      "18.4 Assessment of OHS Risks to the OHS Management System": "Annually, The Company assesses OHS risks and risks to the OHSMS itself, considering outdated information, system requirements, insufficient resources, review programmes, management responsibilities, failure to achieve expectations, planning, and OHS performance.",
      "18.5 Identification of OHS Opportunities and Other Opportunities": "The Company provides opportunities to improve OHS by eliminating hazards early, discussing OHS during planned changes, improving monotonous work, utilising new technologies, and encouraging worker participation — and improves the OHSMS itself by enhancing visibility, the incident investigation process, worker participation, benchmarks, and industry collaboration.",
      "18.6 Management of Change": "The Company completes a risk assessment to ensure changes to the business don't compromise health and safety performance, identifying potential OHS opportunities. Examples of change include organisation structure, technology, new equipment, new information, products, processes, services, and legal requirements.",
      "18.7 Management Review": "Management holds regular meetings to review actions from previous meetings, legislative or organisational changes, incidents and corrective actions, objectives, non-compliances, worker participation, audit or review findings, communication with other companies, and resource adequacy. Outcomes are communicated to workers and worker representatives as necessary.",
      "19. Support": "The Company ensures the resources and external advice needed to maintain and continually improve the OHSMS are available.",
      "19.1 Resources": "The Company determines and provides the resources needed to establish, implement, and maintain continual improvement of the OHSMS.",
      "19.2 External Advice": "The Company may seek external advice when information or knowledge is limited, ensuring advice is sourced from a competent provider with evidence to support this on request.",
      "20. Document Control": "This OHSMS has been developed for The Company by H.A.R.M Limited and is reviewed annually to ensure the document and related templates remain accurate. Any changes required before the annual review are discussed with H.A.R.M Limited. Health and safety records are retained for the period required by legislation, regulation, contractual requirements and The Company's document-retention requirements. Unless a longer period applies, core OHSMS records are retained for at least five years. Health monitoring and exposure monitoring records subject to prescribed statutory retention periods are retained for the applicable period, including longer retention periods applying to particular exposures such as asbestos.",
    };

    const realPolicyContent = {
      "Health & Safety Policy": "The Company is committed to ensuring, so far as is reasonably practicable, that its obligations under the Health and Safety at Work Act 2015, applicable Regulations, Approved Codes of Practice, Guidelines, and other relevant standards are met — and to the health, safety and wellness of workers and anyone else affected by The Company's operations. The Company is dedicated to a work environment where health, safety and wellness is of equal importance to all other business operations, and commits to:\n\nEnsuring legislative requirements are met; gaining and maintaining knowledge of work health and safety matters; understanding the business, its operations, and associated hazards and risks; ensuring resources are used to eliminate or minimise risk; having processes for receiving, communicating and considering information on incidents, hazards, and risks; responding in a timely manner to health and safety information; implementing processes and complying with duties; providing a safe and healthy work environment; preventing work-related injury, ill health, and adverse effects to mental wellbeing; providing PPE and training on its use; meeting applicable health and safety legislative requirements and striving for continual improvement; providing information, supervision, training and instruction; continually improving the Health and Safety Management System; consulting, cooperating and coordinating with contractors and other PCBUs to ensure work-related risks are effectively managed; monitoring exposure to hazardous substances; identifying hazards, controlling risks, and reviewing controls; providing workplace facilities and first aid; maintaining an emergency plan; providing safe plant, structures and systems of work; and supporting early return to work.\n\nWorkers are expected to take reasonable care for their own health and safety and that of others, comply with reasonable instructions and cooperate with policies and procedures, wear PPE provided, report incidents, hazards or risks, and participate in health and safety within The Company.\n\nManagement leads health and safety by example, promotes a positive health and safety culture, enables and encourages worker communication and participation, ensures processes are communicated and followed, ensures workers are competent for their work, and ensures policies, procedures and objectives remain compatible with The Company's direction, work practices, goals and targets.",
      "Wellbeing Policy": "Purpose: The purpose of this policy is to affirm The Company's commitment to providing a safe, positive, and mentally healthy workplace. This policy outlines our expectations, responsibilities, and principles for supporting mental wellbeing.\n\nScope: This policy applies to all employees, contractors, and any other persons who enter or work within The Company's workplaces.\n\nPolicy Statement: The Company recognises that mental wellbeing is a fundamental component of workplace health and safety. We acknowledge that anyone can experience mental distress or challenges at any stage of their lives. We are committed to building a work culture that promotes wellbeing, prevents harm, and provides appropriate support when needed.\n\nPrinciples: The Company's approach to mental wellbeing is based on the following principles — Respect and Dignity: all workers will be treated fairly, respectfully, and without discrimination. Openness and Support: we encourage open conversations about mental wellbeing, free from stigma. Confidentiality: personal information will be managed confidentially and in accordance with applicable privacy requirements. Information will only be accessed, used or disclosed where authorised or otherwise lawfully permitted. Early Support: workers will be encouraged to access support early, through internal processes or external providers such as Mates in Construction, 1737, Lifeline or a GP. Shared Responsibility: both the employer and employees contribute to creating and sustaining a mentally healthy workplace. Continuous Improvement: The Company will review and support wellbeing initiatives, such as Mental Health Awareness Week, and integrate learnings into our workplace practices.\n\nEmployer Commitments: The Company will provide a work environment that supports positive mental wellbeing; ensure managers and supervisors have the knowledge to identify and respond appropriately to mental health concerns; not tolerate bullying, harassment, or discrimination in any form; promote access to wellbeing resources and support services, including Mates in Construction; consider flexible work arrangements where reasonably practicable and appropriate; and integrate mental wellbeing considerations into health and safety planning, leadership, and decision-making.\n\nEmployee Responsibilities: Employees are expected to treat colleagues with respect and civility; contribute to a supportive, inclusive, and safe workplace culture; speak up if they experience or observe behaviour that undermines wellbeing; take reasonable steps to manage their own wellbeing at work and seek support when required; and support workmates to access help when they are struggling.",
      "Driver Statement Policy": "The Company promotes a safe driving culture by encouraging sensible and safe use of vehicles. This policy aims to outline clear responsibilities of all workers, to achieve a safer working environment.\n\nIt is the driver's responsibility to: always leave the vehicle clean and tidy; always wear their seatbelt; complete a vehicle checklist prior to using the vehicle each day; ensure the fuel gauge is above half at the end of shift, fuelling up on the way back to the yard if under half; ensure work procedures are followed while loading and unloading trucks; report any damage caused to a company vehicle immediately to their manager, followed by an incident report completed prior to the end of shift; never use a cellular phone while driving unless using a handsfree device; never exceed the legal speed limit; never admit responsibility or fault in the event of an accident — always speak to a manager first; never drive while under the influence of drugs or alcohol, including prescription drugs that may impair judgement or cause drowsiness; never smoke or use a vaping device while in any company vehicle; never drive a vehicle they are not legally qualified to drive; notify their manager of speeding tickets, crashes and breaches of traffic regulations; notify management within half an hour of any damage or incident occurring; and complete a full incident report for plant damage or incidents by the end of the shift.\n\nThe Company will: keep training and maintenance records on file; ensure regular breaks are scheduled and log-book requirements are followed; maintain all company vehicles in a safe, clean and roadworthy condition to ensure the maximum safety of drivers, occupants and other road users; and ensure WOFs and COFs are current.",
      "Environmental Policy": "The Company is committed to achieving the principles of environmental sustainability. We recognise our moral and legal responsibility to ensure our operations do not place the local community or environment at risk of harm.\n\nThe Company achieves this by: complying with applicable environmental legislation, regulations, consent conditions and other relevant requirements, and pursuing improved environmental performance where reasonably practicable; integrating sustainability considerations into all business decisions; minimising toxic emissions through the selection and use of our fleet; promoting environmental awareness among our workers and encouraging them to work in an environmentally responsible manner; reducing waste through innovative work practices and recycling; minimising waste by evaluating operations and ensuring they are as efficient as possible; and reviewing and continually improving our environmental sustainability performance.\n\nTo ensure the success of this policy, senior management will: ensure the environmental policy is implemented; comply with all relevant environmental legislation and adhere to regulatory standards; establish measurable objectives and targets aimed at eliminating waste, pollution and environmental harm; act in a socially responsible manner in regard to the management of our people, communities and resources; encourage consultation and co-operation between management, workers and stakeholders on matters affecting the environment; and provide adequate resources to meet these environmental commitments.\n\nAll workers are required to: follow all environmental policies and procedures; identify and promptly report environmental hazards, incidents, spills or other conditions that may cause environmental harm; and act in a socially responsible manner at all times while encouraging an environmentally friendly workplace.",
      "Fatigue & Stress Management Policy": "The Company recognises that workers who are impaired by stress and fatigue are a risk to themselves and those around them. This policy aims to improve overall safety and wellbeing, to achieve a safe working environment.\n\nThe Company achieves this by: as The Company's minimum fatigue-management requirements, unless a more conservative project or client requirement applies: shifts will not normally exceed 14 hours including work-related travel from home to home; average working hours will not normally exceed 60 hours per week; and workers will not undertake more than 4.5 hours of continuous work without an appropriate break; ensuring rest and meal breaks meet applicable requirements under the Employment Relations Act 2000; planning appropriate rest and meal breaks before work commences and allowing additional breaks where conditions, workload or worker fatigue indicate they are required; considering an additional 10-minute break between work periods when extreme conditions present; investigating incidents where fatigue may have been involved; providing adequate facilities and drinking water; and limiting periods of excessive mental or physical demands by managing workloads.\n\nAll workers are required to: turn up in a state fit for work, having done everything possible to get a good sleep and rest; inform their manager or supervisor if a task is beyond their capabilities; recognise the signs and symptoms of fatigue — including feeling constantly tired, having little energy, feeling sluggish, excessive yawning or falling asleep at work, reduced vigilance, bad moods, forgetfulness, inability to concentrate, poor communication, poor decision-making, reduced hand-eye coordination and slower reaction times, as well as less obvious symptoms such as drowsiness, headaches, dizziness, blurred vision or impaired visual perception and a need for extended sleep on days off; communicate with their manager or supervisor if they start showing signs and symptoms of fatigue, and make managers and supervisors aware of other workers who may be fatigued; and report fatigue-related incidents.\n\nNon-compliance with this policy may result in disciplinary action. This policy applies to all workers, including contractors and subcontractors under The Company's operational control. The Company's Officer(s) are accountable for ensuring this policy is implemented. The policy shall be reviewed annually and updated as required.",
    };

    // Emergency Response Plan content — the real per-emergency text from H.A.R.M's
    // reference ERP document, plus a numbers page pre-filled with the standard NZ
    // national/regional lines (Police/Ambulance/Fire, Hospital, WorkSafe, etc.) and a
    // blank Company Emergency Contacts page for each client's own Controller/Fire
    // Warden/First Aider names and numbers.
    const realErpContent = {
      "Emergency Contact Numbers": "Police / Ambulance / Fire: 111\n\nHospital: 07 579 8000\n\nWorkSafe: 0800 030 040\n\nEnvironment Bay of Plenty: 0800 884 880\n\nCivil Defence: 07 577 7000\n\nPoison Centre: 0800 764 766\n\nPower (including 24 hour faults): 0800 27 27 27\n\nThese are the standard NZ national/regional numbers \u2014 update the regional council and power company lines above if this client sits outside the Bay of Plenty area.",
      "Company Emergency Contacts": "Emergency Controller: Name \u2014 ___________________________ Number \u2014 ___________________________\n\nFire Warden: Name \u2014 ___________________________ Number \u2014 ___________________________\n\nFirst Aider: Name \u2014 ___________________________ Number \u2014 ___________________________\n\nFill in the names and numbers for this client's site before generating the PDF.",
      "Fire": "If you discover a fire:\n\u2022 Warn occupants in the immediate area\n\u2022 Operate the nearest fire alarm manual call point or yell FIRE FIRE FIRE\n\u2022 Evaluate the situation and determine if you can handle the fire or if an immediate call for assistance is best\n\u2022 Call the Fire Service on 111\n\u2022 Stay low and avoid inhaling toxic smoke or hazardous vapours\n\u2022 Report to the Emergency Controller at the evacuation point and pass on any relevant information about the fire\n\u2022 If the exit for evacuation is blocked, exit using an alternative route\n\u2022 Go to the assembly point\n\nIf you are warned of a fire:\n\u2022 Activate the nearest manual call point if the alarm is not already sounding\n\u2022 Assist others to evacuate if required\n\u2022 Evacuate to the assembly point\n\nYou will need to provide the following information:\n\u2022 The nature of the emergency (e.g. alarms ringing)\n\u2022 Building name, street number, street name\n\u2022 Nearest intersection, suburb and city\n\nEvacuation management team: The evacuation management team consists of an Emergency Controller, Fire Warden and first aider.\n\nAfter hours procedure: If the building is occupied outside of normal hours, anyone discovering a fire is to:\n\u2022 Warn occupants in the immediate area\n\u2022 Operate the nearest fire alarm manual call point\n\u2022 Call the Fire Service on 111\n\u2022 Evacuate the building\n\u2022 Go to the assembly point\n\u2022 Liaise with the Fire Service upon their arrival",
      "Medical Emergency": "\u2022 Danger: Assess the risk, ensure the area is safe for yourself, the patient and others in the area.\n\u2022 Response: Check for a response from the patient, ask names, squeeze shoulders. If there is no response send for help, if there is a response make comfortable, check for injuries and monitor response\n\u2022 Send for help: Call 111 or ask another person to make the call\n\u2022 Airway: Open mouth, if foreign material is present clear the airway with your fingers and place in the recovery position, open the airway by tilting head up and lifting the chin\n\u2022 Breathing: Check for normal breathing, if not breathing start CPR. If normal breathing place in recovery position, monitor breathing, manage injuries and treat for shock\n\u2022 CPR: Start CPR, 30 Chest compressions: 2 Breaths. Continue CPR until help arrives or patient recovers\n\u2022 Defibrillation: Apply defibrillators as soon as possible if available, follow voice prompts\n\u2022 Try not to move the patient unless there is imminent danger in the area or to perform life saving techniques if you feel there is any injuries to the neck/spine. If there is bleeding, apply pressure. Keep patient warm.",
      "Earthquake": "During an Earthquake:\n\u2022 Drop, cover and Hold On. Minimise your movements to a few steps to a nearby safe place and if you are indoors, stay there until the shaking has stopped and you are sure exiting is safe.\n\nIf Indoors:\n\u2022 DROP to your hands and knees.\n\u2022 COVER your head and neck with your arms. This position protects you from falling and provides some protection for vital organs. Because moving can put you in danger from the debris in your path, only move if you need to get away from the danger of falling objects. If you can move safely, crawl for additional cover under a sturdy desk or table. If there is low furniture, or an interior wall or corner nearby and the path is clear, these may also provide some additional cover. Stay away from glass, windows, outside doors and walls, and anything that could fall, such as lighting fixtures or furniture.\n\u2022 HOLD ON to any sturdy shelter until the shaking stops.\n\u2022 Stay away from glass, windows, outside doors and walls, and anything that could fall, such as lighting fixtures or furniture.\n\u2022 If you are in bed: STAY there and COVER your head and neck with a pillow. At night, hazards and debris are difficult to see and avoid; attempts to move in the dark result in more injuries than remaining in bed.\n\u2022 DO NOT get in a doorway as this does not provide protection from falling or flying objects and you likely will not be able to remain standing.\n\u2022 Stay inside until the shaking stops and it is safe to go outside. Do not exit a building during the shaking. Research has shown that most injuries occur when people inside buildings attempt to move to a different location inside the building or try to leave.\n\u2022 DO NOT use the elevators.\n\u2022 Be aware that the electricity may go out or the sprinkler systems or fire alarms may turn on.\n\nIf Outdoors:\n\u2022 If you can, move away from buildings, streetlights, and utility wires.\n\u2022 Once in the open, Drop, Cover, and Hold On. STAY THERE until the shaking stops. This might not be possible in a city, so you may need to duck inside a building to avoid falling debris.\n\nIf in a Moving Vehicle:\n\u2022 Stop as quickly as safety permits and stay in the vehicle. Avoid stopping near or under buildings, trees, overpasses, and utility wires.\n\u2022 Proceed cautiously once the earthquake has stopped. Avoid roads, bridges, or ramps that might have been damaged by the earthquake.\n\nWhen the Shaking Stops:\n\u2022 When the shaking stops, look around to make sure it is safe to move and there is a safe way out through the debris. Then exit the building.\n\u2022 Expect aftershocks. These secondary shockwaves are usually less violent than the main quake but can be strong enough to do additional damage to weakened structures and can occur in the first hours, days, weeks, or even months after the quake. Drop, Cover, and Hold On whenever you feel shaking.\n\u2022 Check for injuries and provide assistance if you have training. Assist with rescues if you can do this safely.\n\u2022 Look for and extinguish small fires. Fire is the most common hazard after an earthquake. Never use a lighter or matches near damaged areas.\n\u2022 Listen to a battery-operated radio or television for the latest emergency information.\n\u2022 Use the telephone only for emergency calls.\n\nIf Trapped Under Debris:\n\u2022 Do not light a match.\n\u2022 Do not move about or kick up dust.\n\u2022 Cover your mouth with a handkerchief or clothing.\n\u2022 Tap on a pipe or wall so rescuers can locate you. Use a whistle if one is available. Shout only as a last resort. Shouting can cause you to inhale dangerous amounts of dust.",
      "Tsunami": "During a tsunami:\n\u2022 Move immediately to the nearest higher ground, or as far inland as you can. If evacuation maps are present, follow the routes shown.\n\u2022 Walk or bike if possible and drive only if essential. If driving, keep going once you are well outside the evacuation zone to allow room for others behind you.\n\u2022 If you cannot escape the tsunami, go to an upper storey of a sturdy building or climb onto a roof or up a tree, or grab a floating object and hang on until help arrives.\n\u2022 Never go to the shore to watch for a tsunami. Stay away from at-risk areas until the official all-clear is given.\n\u2022 Listen to your local radio stations as emergency management officials will be broadcasting the most appropriate advice for your community and situation.\n\nAfter a tsunami:\n\u2022 Continue to listen to the radio for civil defence advice and do not return to the evacuation zones until authorities have given the all-clear.\n\u2022 Be aware that there may be more than one wave and it may not be safe for up to 24 hours, or longer. The waves that follow the first one may also be bigger.\n\u2022 Check yourself for injuries and get first aid if needed. Help others if you can.\n\u2022 When re-entering homes or buildings, use extreme caution as floodwaters may have damaged buildings. Look for, and report, broken utility lines to appropriate authorities.\n\u2022 If your property is damaged, take notes and photographs for insurance purposes. If you rent your property, contact your landlord and your contents insurance company as soon as possible.",
      "Cyclone / Severe Storm": "\u2022 Stay informed on weather updates. Listen to your local radio stations as civil defence authorities will be broadcasting the most appropriate advice for your community and situation.\n\u2022 Secure, or move indoors, all items that could get blown about and cause harm in strong winds.\n\u2022 Close windows, external and internal doors. Pull curtains and drapes over unprotected glass areas to prevent injury from shattered or flying glass.\n\u2022 If the wind becomes destructive, stay away from doors and windows and shelter further inside the house.\n\u2022 Water supplies can be affected so it is a good idea to store drinking water in containers and fill bathtubs and sinks with water.\n\u2022 Don't walk around outside and avoid driving unless absolutely necessary.\n\u2022 Power cuts are possible in severe weather. Unplug small appliances which may be affected by electrical power surges. If power is lost unplug major appliances to reduce the power surge and possible damage when power is restored.\n\u2022 Listen to your local radio stations as emergency management officials will be broadcasting the most appropriate advice for your community and situation.\n\u2022 Check for injuries and help others if you can, especially people who require special assistance.\n\u2022 Look for and report broken utility lines to appropriate authorities.",
      "Tornado": "\u2022 Tornadoes sometimes occur during thunderstorms in some parts of New Zealand. A tornado is a narrow, violently rotating column of air extending downwards to the ground from the base of a thunderstorm. Warning signs include a long, continuous roar or rumble or a fast-approaching cloud of debris which can sometimes be funnel shaped.\n\u2022 Alert others if you can.\n\u2022 Take shelter immediately. A basement offers the greatest safety. If underground shelter is not available, move to an interior room without windows on the lowest floor. Get under sturdy furniture and cover yourself with a mattress or blanket.\n\u2022 If caught outside, get away from trees if you can. Lie down flat in a nearby gully, ditch or low spot and protect your head.\n\u2022 If in a car, get out immediately and look for a safe place to shelter. Do not try to outrun a tornado or get under the vehicle for shelter.",
      "Explosion / Structural Damage": "\u2022 Remain calm\n\u2022 Be prepared for possible further explosions\n\u2022 Crawl under a table or desk\n\u2022 Stay away from windows, mirrors, overhead fixtures, filing cabinets, bookcases and electrical equipment\n\u2022 If evacuation is ordered, proceed to one of the designated exits\n\u2022 Do not move seriously injured persons unless they are in obvious immediate danger (of fire, building collapse, etc.)\n\u2022 Open doors carefully \u2014 watch for falling objects\n\u2022 If requested, accompany and assist persons with disabilities who appear to need direction or assistance\n\u2022 Do not use matches or lighters\n\u2022 Avoid using telephones unless to an emergency service",
      "Electric Shock": "DO NOT TOUCH THE PERSON BEING ELECTROCUTED\n\n\u2022 Disconnect power at source if possible\n\u2022 If power cannot be turned off, use an insulated object \u2014 wood, rubber \u2014 to break the connection from person to power\n\u2022 Dial 111\n\u2022 Proceed with First Aid\n\u2022 Even if the person feels okay afterwards, seek medical attention",
      "Spill Response": "IF you discover a spill:\n\u2022 Raise the alarm (switching on the fire alarm, shouting).\n\u2022 Evacuate people, if necessary.\n\u2022 Identify spilt material. Consult Safety Data Sheet (SDS).\n\u2022 Use appropriate personal protective equipment depending on the spill material, such as suitable gloves, protective eyewear, suitable protective clothing.\n\u2022 Stop or shut off the source of the spill immediately, if it safe to do so.\n\u2022 Remove sources of ignition if a flammable substance has been spilled.\n\u2022 If the spill involves a flammable substance, move away from the spill before using a mobile or cordless phone.\n\u2022 Notify spill contact person & any other emergency contact(s): owner, manager, etc.\n\u2022 Do not walk through the spill if you can avoid it and keep the contaminated area as small as possible\n\u2022 Pump liquid spills into a safe container, absorb them with appropriate materials or mix with a compatible solid so it can be swept up for disposal.\n\u2022 Use absorbent materials, such as absorbent pads, booms or kitty litter to contain spills that are relatively small in nature and where the spilled substance and its hazardous properties have been properly identified and assessed.\n\u2022 Cover/block any drains/catch basins in the spill area to prevent material from entering into the storm water system, sanitary sewer system or septic system.\n\u2022 Cover powder spills to stop them blowing around or dampen them where it is safe to do so.\n\u2022 Sweep or vacuum up powder spills and put them in a safe container.\n\u2022 Collect absorbent materials and treat as hazardous waste. Dispose of contaminated materials, clean-up equipment or clothing as a waste or ask your waste disposal contractor to dispose of it for you.\n\u2022 Replace any containment equipment or PPE immediately and complete a spill report to find out how and why the spill occurred.\n\u2022 If the spill is large or otherwise uncontrollable or poses a potential immediate hazard to human health and safety, call Bay of Plenty Regional Council Pollution Hotline 0800 884 883.\n\u2022 If the spill exposes workers or any other person to a serious risk to their health and safety, call WorkSafe 0800 030 040.",
      "Chainsaw Accident": "\u2022 Turn off the machine immediately\n\u2022 Raise the alarm that someone has been injured\n\u2022 Assist with first aid and stop the bleeding (if applicable)\n\u2022 To stop bleeding, place a large bandage or something very absorbent directly over the wound and apply firm pressure\n\u2022 If direct pressure will not stop the bleeding and it is in a limb, you can try using an improvised tourniquet by wrapping a belt tightly around the limb to slow down the blood flow\n\u2022 Ring 111 and ask for ambulance assistance",
      "Plant Roll Over": "\u2022 Turn off the machine if it is safe to do so\n\u2022 Account for all people known to be in the area\n\u2022 Assist anyone hurt if you can without putting yourself in danger\n\u2022 Check for breathing and heart function \u2014 if either has stopped, immediate resuscitation procedures should be conducted. Control bleeding (if any) and administer other required first aid. Psychological reassurance and physical warmth can also improve a victim's survival chances\n\u2022 Contact other people as necessary and appropriate (owners, managers, employees, neighbours, Ambulance, Fire Brigade etc.) for additional assistance\n\u2022 If the ground is soft, it may be possible to dig the victim out from under the plant \u2014 always block or crib the machine to prevent it from tipping and causing further injuries\n\u2022 Upon arrival of emergency response personnel, direct them to the location of the injured person(s) that require their attention and services",
      "Service Strike": "All strikes:\n\u2022 Do not attempt repairs.\n\u2022 Inform utility supplier/service owner as soon as possible.\n\u2022 Report all damage, even if leaks or loss of power are not evident.\n\u2022 Inform service users.\n\u2022 Inform owners of adjacent services if there is a risk of gas or water ingress or contamination.\n\u2022 Keep members of the public away and post warning signs.\n\nGas strikes:\n\u2022 Call national emergency number 0800 111999.\n\u2022 Evacuate workers and others to a safe distance.\n\u2022 Warn local residents and businesses.\n\u2022 No smoking or naked flames.\n\u2022 Keep vehicles and members of the public away from the area.\n\u2022 Warn service users if a service connection has been disturbed as this may result in a leak within the building.\n\u2022 Co-operate with and assist gas supply company, police and fire authority.\n\nElectrical Cable Strike:\n\u2022 Avoid all contact.\n\u2022 Do not try to disentangle cables from excavator buckets.\n\u2022 Do not attempt to leave the excavator involved unless assured that the cable is no longer live.\n\u2022 Evacuate workers and others to a safe distance.\n\u2022 Keep vehicles and members of the public away from the area.\n\u2022 Contact service owner and emergency services as appropriate.\n\u2022 Co-operate with and assist cable owner and emergency services.",
      "Ladder Rescue Plan (Harness Use)": "\u2022 If the fallen worker is suspended from a lifeline, move the worker (if possible) to an area that rescuers can access safely with a ladder.\n\u2022 Set up the appropriate ladder(s) to reach the fallen worker.\n\u2022 Rig separate lifelines for rescuers to use while carrying out the rescue from the ladder(s).\n\u2022 If the fallen worker is not conscious or cannot reliably help with the rescue, at least two rescuers may be needed.\n\u2022 If the fallen worker is suspended directly from a lanyard or a lifeline, securely attach a separate lowering line to the harness.\n\u2022 Other rescuers on the ground (or closest work surface) should lower the fallen worker while the rescuer on the ladder guides the fallen worker to the ground (or work surface).\n\u2022 Once the fallen worker has been brought to a safe location, administer first aid and treat the person for suspension trauma and any other injury.\n\u2022 Arrange transportation to hospital if required.",
      "Elevated Work Platform Rescue (Harness Use)": "\u2022 Bring the EWP to the accident site and use it to reach the suspended worker.\n\u2022 Ensure that rescue workers are wearing full-body harnesses attached to appropriate anchors in the EWP.\n\u2022 Ensure that the EWP has the load capacity for both the rescuer(s) and the fallen worker.\n\u2022 If the fallen worker is not conscious, two rescuers will probably be needed to safely handle the weight of the fallen worker.\n\u2022 Position the EWP platform below the worker and disconnect the worker\u2019s lanyard when it is safe to do so. When the worker is safely on the EWP, reattach the lanyard to an appropriate anchor point on the EWP if possible.\n\u2022 Lower the worker to a safe location and administer first aid. Treat the worker for suspension trauma and any other injury.\n\u2022 Arrange transportation to hospital if required.",
      "Elevated Work Platforms (EWP)": "If EWP Touches Powerlines:\n\u2022 Anyone in the EWP should stay there and warn any others nearby to stay clear. If it is safe to do so, operate the controls to break contact\n\u2022 If it is not safe to break contact - call for help, warning everyone to keep well clear of the machine\n\u2022 Stay put until the power company can de-energise the line and advise that it is safe to get off the EWP\n\u2022 If help is not immediately available, electrical contact cannot be broken and there is an urgent reason to get off the EWP (such as fire):\n\u2022 Switch off the motor and \u2013 where applicable \u2013 apply brakes > remove any loose clothing\n\u2022 Climb to a point on the EWP where you can safely jump to the ground about 1 metre above the ground\n\u2022 Jump so that you are well clear of the platform before any part of you touches the ground\n\nFall away from the EWP and not towards it:\n\u2022 Do not touch the EWP until the power company advises it is safe to do so\n\nPlatform Stuck at Height or A Medical Emergency:\n\u2022 Wherever possible, a trained person should do the rescue using the machine\u2019s ground controls or secondary lowering system. If this is not possible, use another EWP to carry out the rescue\n\u2022 The rescue machine needs to be placed so the people doing the rescue are not put at risk\n\u2022 The work platforms of both machines need to be next to each other with as little gap as possible between them > switch off the engines on both machines during the transfer\n\u2022 Where practicable, the person being rescued, and the rescuer should wear full body harnesses with adjustable lanyards. Attach lanyards to certified anchor points on the rescue machine before starting the transfer\n\nCall emergency services if:\n\u2022 There is an injury, illness or risk of exposure to toxic substances\n\u2022 Someone has been hanging for any length of time \u2013 they might be suffering from suspension trauma\n\u2022 The operators on the work platform cannot communicate with rescuers on the ground",
      "Lone Workers": "\u2022 It is important that a check-in procedure be in place. A verbal and visual check-in is adequate while other workers are at the yard in the same area.\n\u2022 The cell phone will be the main source of contact. Ensure this is fully charged before leaving the Office. If a cell phone is unreliable in your area, be sure to have alternative methods of communication available (such as use of public telephones)\n\u2022 When working alone, the operator should know the following details:\n\u2022 Pre-agreed intervals of regular contact arranged between the lone worker and the delegated contact person\n\u2022 A secondary Worker will be assigned to escort the lone worker if at any time they feel there could be a risk to safety\n\u2022 Have the contact person call the lone employee periodically if possible to make sure he/she is okay\n\u2022 Pick out a code word to be used to identify or confirm that help is needed\n\u2022 If the lone employee does not check-in when he is supposed to then the contact person shall arrange a visual check on employee. That contact person will then carry out rescue procedures if applicable.",
      "Vehicle Accident": "\u2022 Stop the vehicle safely and turn on hazard lights. Do not move an injured person unless they are in immediate danger (fire, oncoming traffic).\n\u2022 Check yourself and others for injuries. Call 111 immediately if anyone is injured or if the road is blocked.\n\u2022 If safe to do so, set up warning triangles or cones to protect the scene from oncoming traffic.\n\u2022 Do not admit fault or discuss blame at the scene. Exchange names, contact details, registration numbers and insurance details with any other party involved.\n\u2022 Take photos of the vehicles, the scene, and any damage if it is safe to do so.\n\u2022 Notify your manager as soon as possible and complete a full incident report before the end of shift.\n\u2022 If the vehicle is a company vehicle, do not attempt to drive it away if it is not safe to do so. Arrange a tow instead.\n\u2022 A breath and drug test may be required following any workplace vehicle incident, in line with company policy.",
      "Confined Space Rescue": "\u2022 Do not enter the confined space to attempt a rescue. The majority of confined space deaths are rescuers who entered without the right training, equipment, or atmospheric testing, and were themselves overcome.\n\u2022 Raise the alarm immediately and call 111, stating clearly that it is a confined space rescue.\n\u2022 If a standby person is in place, they should attempt to communicate with the worker and, if trained and equipped to do so, retrieve them using a mechanical retrieval system from outside the space, without entering it.\n\u2022 Ventilate the space if it is safe to do so from outside, and continue atmospheric monitoring.\n\u2022 Only enter if you are trained, wearing appropriate breathing apparatus, and are following a documented confined space entry and rescue procedure with a retrieval line attached.\n\u2022 Keep all other workers and bystanders well clear of the entry point.\n\u2022 Once emergency services arrive, brief them on what is known: how long the worker has been in the space, what the space contains, and what has been tried so far.",
      "Excavation Collapse": "\u2022 Do not enter the excavation. A second collapse is common and can bury or injure would-be rescuers.\n\u2022 Call 111 immediately and clearly state it is a trench or excavation collapse with a person buried or trapped.\n\u2022 Evacuate all other workers from the immediate area and keep plant and vehicles well back from the edge. Vibration and extra load can trigger further collapse.\n\u2022 If any part of the person is visible and it is safe to do so without entering the excavation, try to keep them talking and reassured while waiting for emergency services.\n\u2022 Do not attempt to dig the person out by hand or machine. This must be left to trained emergency services with proper shoring equipment.\n\u2022 Identify and inform emergency services of any underground services (gas, electrical, water) in the area.\n\u2022 Once the incident is over, the excavation must be assessed by a competent person before any work resumes.",
      "Violence or Aggressive Behaviour": "\u2022 Your safety comes first. Do not put yourself at risk trying to protect property or resolve the situation yourself.\n\u2022 Stay calm, keep your voice low and steady, and avoid actions that could be seen as threatening (raised voice, sudden movements, pointing).\n\u2022 Where possible, keep a clear exit route between yourself and the door. Do not let yourself become trapped in a corner or small room.\n\u2022 If you feel unsafe, remove yourself from the situation and get to a safe area. Do not attempt to physically restrain or engage with an aggressive person.\n\u2022 Alert other workers using an agreed code word or the site's duress alarm if one is available.\n\u2022 Call 111 if there is a weapon involved, a physical assault, or you believe anyone is in danger.\n\u2022 Once safe, report the incident to your manager immediately and complete an incident report. Include a description of the person, what was said or done, and any witnesses.\n\u2022 Support is available afterwards. Speak to your manager about accessing EAP or other support services if you've been affected.",
    };
    // Real, verified regional emergency numbers for the ERP's per-region Emergency Contact
    // Numbers pages (client.erpRegion picks which one a client uses). National numbers
    // (Police/Fire/Ambulance, WorkSafe, Poisons Centre, Healthline) are included in every
    // region's box, with the region-specific power, Civil Defence, environmental/pollution,
    // hospital and gas leak lines set per region.
    const realRegionalNumbers = {
      "Emergency Contact Numbers (Northland)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Northpower 0800 104 040. Far North / Top Energy 0800 867 363.\n\nCivil Defence: 0800 002 004\n\nEnvironmental / Pollution: Northland Regional Council 0800 504 639, 24/7\n\nMain Hospital: Whangarei Hospital 09 430 4100\n\nGas Leak: Firstgas: residential 0800 802 332. Damaged/leaking pipe 0800 734 567.",
      "Emergency Contact Numbers (Auckland)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Vector 0508 832 867. Counties Power 0800 100 202.\n\nCivil Defence: Auckland Emergency Management 0800 22 22 00\n\nEnvironmental / Pollution: Auckland Council Pollution Hotline 09 377 3107, 24/7\n\nMain Hospital: Auckland City Hospital 09 367 0000\n\nGas Leak: Vector Gas 0800 764 764",
      "Emergency Contact Numbers (Waikato)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: WEL Networks 0800 800 935. Powerco areas 0800 27 27 27.\n\nCivil Defence: Contact the relevant local council / Waikato CDEM. For regional assistance Waikato Regional Council 0800 800 401.\n\nEnvironmental / Pollution: Waikato Regional Council 0800 800 401, 24/7\n\nMain Hospital: Waikato Hospital 0800 276 216 or 07 839 8899\n\nGas Leak: Firstgas 0800 802 332 / leaking pipe 0800 734 567. Powerco gas areas 0800 111 848.",
      "Emergency Contact Numbers (Bay of Plenty)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Powerco 0800 27 27 27. Other network providers may apply by district.\n\nCivil Defence: Emergency Management Bay of Plenty 0800 884 880\n\nEnvironmental / Pollution: BOP Regional Council Pollution Hotline 0800 884 883\n\nMain Hospital: Tauranga Hospital 07 579 8000\n\nGas Leak: Firstgas 0800 802 332 / leaking pipe 0800 734 567. Powerco network 0800 111 848.",
      "Emergency Contact Numbers (Gisborne)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Firstlight Network 0800 206 207, 24/7\n\nCivil Defence: Tairawhiti Civil Defence / Gisborne District Council 0800 653 800, 24/7\n\nEnvironmental / Pollution: Gisborne District Council 0800 653 800, 24/7\n\nMain Hospital: Gisborne Hospital 0800 800 620 or 06 869 0500\n\nGas Leak: Firstgas 0800 802 332 / leaking pipe 0800 734 567.",
      "Emergency Contact Numbers (Hawke's Bay)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Unison 0800 2 UNISON, 0800 286 476. Wairoa / Firstlight 0800 206 207.\n\nCivil Defence: Hawke's Bay Emergency Management 06 835 9200 for general contact. Immediate threat: 111.\n\nEnvironmental / Pollution: Hawke's Bay Regional Council 0800 108 838, 24/7\n\nMain Hospital: Hawke's Bay Hospital 06 878 8109\n\nGas Leak: Powerco gas network 0800 111 848. Firstgas transmission/damaged pipeline 0800 734 567.",
      "Emergency Contact Numbers (Taranaki)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Powerco 0800 27 27 27\n\nCivil Defence: Taranaki Civil Defence 0800 900 049\n\nEnvironmental / Pollution: Taranaki Regional Council 0800 736 222\n\nMain Hospital: Taranaki Base Hospital 06 753 6139\n\nGas Leak: Powerco Gas 0800 111 848",
      "Emergency Contact Numbers (Manawatu-Whanganui)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Powerco 0800 27 27 27. Other networks include Electra, Centralines, Scanpower and The Lines Company depending on location.\n\nCivil Defence: Manawatu-Whanganui CDEM / Horizons 0508 800 800\n\nEnvironmental / Pollution: Horizons Regional Council 0508 800 800, 24/7\n\nMain Hospital: Palmerston North Hospital ED 06 350 8750. Main hospital 06 356 9169.\n\nGas Leak: Powerco Gas 0800 111 848. Firstgas transmission/damaged pipeline 0800 734 567.",
      "Emergency Contact Numbers (Wellington)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Wellington Electricity 0800 248 148. Other networks apply in Kapiti/Wairarapa.\n\nCivil Defence: WREMO 04 830 4279\n\nEnvironmental / Pollution: Greater Wellington Environmental Hotline 0800 496 734\n\nMain Hospital: Wellington Regional Hospital 04 385 5999\n\nGas Leak: Powerco gas network 0800 111 848. Firstgas network including Kapiti 0800 802 332 / damaged pipe 0800 734 567.",
      "Emergency Contact Numbers (Tasman-Nelson)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Network Tasman 0800 508 100, 24/7\n\nCivil Defence: Nelson Tasman Emergency Management 03 543 7290. After hours 03 546 0200 or 03 543 8400.\n\nEnvironmental / Pollution: Nelson 0800 NO POLLUTE, 0800 667 655883. Tasman 03 543 8400, 24/7.\n\nMain Hospital: Nelson Hospital 03 546 1800\n\nGas Leak: No reticulated natural gas network. For LPG emergencies contact the LPG supplier and call 111 where there is immediate danger.",
      "Emergency Contact Numbers (Marlborough)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Marlborough Lines 03 577 7007, 24/7\n\nCivil Defence: Marlborough CDEM / Marlborough District Council 03 520 7400, 24/7\n\nEnvironmental / Pollution: Marlborough District Council 03 520 7400, 24/7\n\nMain Hospital: Wairau Hospital 03 520 9999\n\nGas Leak: No reticulated natural gas network. LPG supplier / 111 for immediate danger.",
      "Emergency Contact Numbers (West Coast)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Westpower 0800 768 241, 24/7\n\nCivil Defence: West Coast Emergency Management 03 769 9323\n\nEnvironmental / Pollution: West Coast Regional Council 0508 800 118, 24/7\n\nMain Hospital: Te Nikau Hospital 03 769 7400\n\nGas Leak: No reticulated natural gas network. LPG supplier / 111 for immediate danger.",
      "Emergency Contact Numbers (Canterbury)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Orion 0800 363 9898. North Canterbury MainPower 0800 30 90 80. Other networks, including Alpine Energy, apply further south.\n\nCivil Defence: Canterbury CDEM / Environment Canterbury general 0800 324 636. Immediate danger 111.\n\nEnvironmental / Pollution: Environment Canterbury urgent environmental incident 0800 765 588, 24/7\n\nMain Hospital: Christchurch Hospital 03 364 0640. ED patient enquiries 03 364 0600.\n\nGas Leak: No reticulated natural gas network. LPG supplier / 111 for immediate danger.",
      "Emergency Contact Numbers (Otago)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: Aurora Energy 0800 22 00 05. PowerNet 0800 808 587 in parts of Central Otago/Queenstown Lakes.\n\nCivil Defence: Emergency Management Otago 0800 474 082\n\nEnvironmental / Pollution: Otago Regional Council Pollution Hotline 0800 800 033, 24/7\n\nMain Hospital: Dunedin Hospital 03 474 0999\n\nGas Leak: No reticulated natural gas network. LPG supplier / 111 for immediate danger.",
      "Emergency Contact Numbers (Southland)": "Police / Ambulance / Fire: 111\n\nWorkSafe New Zealand: 0800 030 040\n\nNational Poisons Centre: 0800 764 766\n\nHealthline: 0800 611 116\n\nPower / Electrical Fault: PowerNet 0800 808 587, 24/7\n\nCivil Defence: Emergency Management Southland 0800 76 88 45 or 03 211 5115\n\nEnvironmental / Pollution: Environment Southland Pollution Hotline 0800 76 88 45, 24/7\n\nMain Hospital: Southland Hospital 03 218 1949\n\nGas Leak: No reticulated natural gas network. LPG supplier / 111 for immediate danger.",
    };
    (async () => {
      try {
        // Sections and Policies: only fill in if genuinely empty, so any edits already made
        // are never touched.
        const conditionalContent = [
          ...Object.entries(realSectionContent).map(([label, content]) => ["sections", label, content]),
          ...Object.entries(realPolicyContent).map(([label, content]) => ["policies", label, content]),
          ...Object.entries(realErpContent).map(([label, content]) => ["erp", label, content]),
          ...Object.entries(realRegionalNumbers).map(([label, content]) => ["erp", label, content]),
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
        // Sections and Policies specifically touched by the 2026 OHSMS change list: these
        // already had content sitting in Firestore from the original seed, so the
        // conditional "only if empty" write above would never actually apply the corrected
        // wording. Force-overwriting just these specific keys (not the whole sections/
        // policies set) gets today's changes live without touching anything else that may
        // have been customised separately.
        const forceOverwriteKeys = [
          ["sections", "3. Scope"],
          ["sections", "5.2 Participation and Consultation"],
          ["sections", "5.3 Health & Safety Issue Resolution"],
          ["sections", "5.4 Health & Safety Representatives"],
          ["sections", "7.1 Legal and Other Requirements"],
          ["sections", "9. Incidents and Corrective Actions"],
          ["sections", "9.1 Incident Reporting"],
          ["sections", "12. Emergency Preparedness and Response"],
          ["sections", "13. Personal Protective Equipment (PPE)"],
          ["sections", "14. Exposure and Health Monitoring"],
          ["sections", "18.3 Document, SOP and H.A.R.M Register Review"],
          ["sections", "20. Document Control"],
          ["policies", "Health & Safety Policy"],
          ["policies", "Environmental Policy"],
          ["policies", "Fatigue & Stress Management Policy"],
          ["policies", "Wellbeing Policy"],
        ];
        const contentByKey = { ...realSectionContent, ...realPolicyContent };
        await Promise.all(
          forceOverwriteKeys.map(([catKey, label]) => {
            const content = contentByKey[label];
            if (!content) return Promise.resolve();
            return setDoc(doc(db, "documentTemplates", templateKey(catKey, label)), { content });
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

  // Report templates — same "collection of named, editable lists" shape as workflows, just
  // for the Reports tab's "Start from a template" picker. Editable live in the app now
  // (see ReportsView's "Manage templates" panel) instead of being hardcoded.
  const [reportTemplates, setReportTemplates] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "reportTemplates"), (snap) => setReportTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("Report templates subscription failed:", err));
    return unsub;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "reportTemplates"));
        if (snap.empty) await Promise.all(initialReportTemplates.map((t) => { const { id, ...data } = t; return setDoc(doc(db, "reportTemplates", id), data); }));
      } catch (err) { console.error("Report template seed failed (likely a Firestore permissions issue):", err); }
    })();
  }, []);
  const addReportTemplate = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDoc(doc(db, "reportTemplates", "tmpl" + Date.now()), { name: trimmed, sections: [] });
  };
  const renameReportTemplate = (id, name) => updateDoc(doc(db, "reportTemplates", id), { name });
  const deleteReportTemplate = (id) => {
    deleteDoc(doc(db, "reportTemplates", id));
  };
  const addTemplateSection = (id, sectionName) => {
    const trimmed = sectionName.trim();
    if (!trimmed) return;
    const t = reportTemplates.find((x) => x.id === id);
    if (!t || t.sections.includes(trimmed)) return;
    updateDoc(doc(db, "reportTemplates", id), { sections: [...t.sections, trimmed] });
  };
  const removeTemplateSection = (id, sectionName) => {
    const t = reportTemplates.find((x) => x.id === id);
    if (!t) return;
    updateDoc(doc(db, "reportTemplates", id), { sections: t.sections.filter((s) => s !== sectionName) });
  };

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
    // This button never actually asks the client anything — it's a manual shortcut to
    // fast-track a lead into a client without them filling out the real sign-up form. It
    // used to invent placeholder answers here ("6 hours support requested", "no formal
    // OHSMS in place", etc.) and show them as if the client had genuinely said that, which
    // was misleading. Only what's actually known from the sales pipeline gets carried
    // through now — everything else is left for whoever's setting the client up to fill in
    // properly, rather than presenting a guess as fact.
    const intake = { submittedDate: today(), contactEmail: lead.formEmail, contactName: lead.contact };
    // Carry the sales-stage history through rather than starting the client record blank —
    // Reminder entries become real client reminders (still due, still assigned); Notes and
    // Touchpoint logs both become client notes (touchpointCounts() on the Dashboards tab
    // already counts any note by date, so a "Touchpoint" entry counts the same way once
    // it's here — the type label is kept in the text so it's still visible which was which).
    const carriedNotes = (lead.notes || [])
      .filter((n) => n.type !== "Reminder")
      .map((n) => ({ id: n.id, author: "Sales", date: n.date, text: n.type === "Touchpoint" ? `[Touchpoint] ${n.text}` : n.text, tags: [] }));
    const carriedReminders = (lead.notes || [])
      .filter((n) => n.type === "Reminder")
      .map((n) => ({ id: n.id, text: n.text, date: n.dueDate || today(), recurring: "none", done: false, assignee: n.assignee || TEAM[0] }));
    const newClient = {
      name: lead.company, legalName: lead.company, logo: null,
      contract: { start: today(), renewal: addDays(today(), 365), value: lead.value + " / yr", plan: "New client — plan to confirm" },
      billing: { contact: lead.contact, email: lead.formEmail, terms: "TBC", status: "Current" },
      billingType: "FlatFee", billingSetupDone: false, profile: "Standard Client",
      notes: carriedNotes, reminders: carriedReminders, contacts: [], ohsmsLastIssued: null, ohsmsDue: addDays(today(), 90),
      extras: [], hours: { included: 0, log: [] }, users: { log: [] }, intake,
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

  const upcomingReminders = useMemo(() => clients
    .flatMap((c) => (c.reminders || []).map((r) => ({ ...r, clientId: c.id, clientName: c.name })))
    .filter((r) => !r.done && daysUntil(r.date) <= 14)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")), [clients]);

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

  if (module === "mobile") {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <MobileQuickView clients={clients} currentUser={currentUser} goToFullApp={() => setModule("clients")} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full" style={{ background: T.paper, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="w-56 shrink-0 flex flex-col p-4 gap-1" style={{ background: T.charcoal }}>
        <div className="px-3 py-3 mb-3">
          <img src="/logo.png" alt="OSHE" style={{ height: 36, width: "auto" }} />
        </div>
        <NavItem icon={LayoutDashboard} label="Overview" active={module === "overview"} onClick={() => setModule("overview")} />
        <NavItem icon={Smartphone} label="Quick Add" active={false} onClick={() => setModule("mobile")} />
        <NavItem icon={Users} label="Clients" active={module === "clients"} onClick={() => setModule("clients")} />
        <NavItem icon={Layers} label="Systems" active={module === "systems"} onClick={() => setModule("systems")} />
        <NavItem icon={TrendingUp} label="Sales" active={module === "sales"} onClick={() => setModule("sales")} />
        <NavItem icon={Clock} label="Hours" active={module === "hours"} onClick={() => setModule("hours")} />
        {canSeeBilling && <NavItem icon={ClipboardList} label="Billing" active={module === "billing"} onClick={() => setModule("billing")} />}
        <NavItem icon={PieChart} label="Dashboards" active={module === "dashboards"} onClick={() => setModule("dashboards")} />
        <NavItem icon={Store} label="Resellers" active={module === "resellers"} onClick={() => setModule("resellers")} />
        <NavItem icon={ListChecks} label="Workflows" active={module === "workflows"} onClick={() => setModule("workflows")} />
        <NavItem icon={ListTodo} label="My Tasks" active={module === "tasks"} onClick={() => setModule("tasks")} />
        <NavItem icon={FileText} label="Reports" active={module === "reports"} onClick={() => setModule("reports")} />
        <NavItem icon={CalendarClock} label="Schedule" active={module === "schedule"} onClick={() => setModule("schedule")} />
        <div className="flex-1" />
        <div className="px-3 pb-2">
          <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "#5C7274" }}>Logged in as</div>
          <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: T.charcoalSoft, color: "#fff" }}>
            {currentUser || "…"}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-8 py-5" style={{ borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div className="text-xl font-bold" style={{ color: T.ink }}>
              {{ overview: "Overview", clients: "Clients", systems: "Systems", sales: "Sales", billing: "Billing", workflows: "Workflows", resellers: "Resellers", tasks: "My Tasks", dashboards: "Dashboards", reports: "Reports", schedule: "Schedule", hours: "Hours" }[module]}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell notifications={notifications} dismissNotification={dismissNotification} upcomingReminders={upcomingReminders} currentUser={currentUser} goToClient={goToClient} />
            <button onClick={() => signOut(auth)} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: T.paperAlt, color: T.slate }}>
              Sign out
            </button>
          </div>
        </div>

        <div className="flex-1 p-8 min-h-0">
          {module === "clients" && (
            <ClientsView clients={clients} selectedId={selectedClient} setSelectedId={setSelectedClient}
              onboardings={onboardings} updateOnboardingsForClient={updateOnboardingsForClient} workflows={workflows}
              pushNotification={pushNotification} goToWorkflows={() => setModule("workflows")} tabRequest={clientTabRequest} currentUser={currentUser} />
          )}
          {module === "systems" && <SystemsView clients={clients} selectedId={selectedClient} setSelectedId={setSelectedClient} documentTemplates={documentTemplates} saveDocumentTemplate={saveDocumentTemplate} systemReviewLog={systemReviewLog} addSystemReviewLogEntry={addSystemReviewLogEntry} customErpItems={customErpItems} addCustomErpItem={addCustomErpItem} />}
          {module === "sales" && <SalesView leads={leads} convertLeadToClient={convertLeadToClient} />}
          {module === "overview" && (
            <ErrorBoundary>
              <OverviewView clients={clients} tasks={tasks} onboardings={onboardings} goToClient={goToClient} />
            </ErrorBoundary>
          )}
          {module === "hours" && <HoursView clients={clients} />}
          {module === "billing" && canSeeBilling && <BillingOverview clients={clients} resellers={resellers} />}
          {module === "dashboards" && <DashboardsView clients={clients} tasks={tasks} touchpointBaselines={touchpointBaselines} updateTouchpointBaseline={updateTouchpointBaseline} />}
          {module === "workflows" && <WorkflowsView workflows={workflows} />}
          {module === "resellers" && <ResellersView resellers={resellers} selectedId={selectedReseller} setSelectedId={setSelectedReseller} />}
          {module === "tasks" && <TasksView tasks={tasks} clients={clients} onboardings={onboardings} currentUser={currentUser} goToClient={goToClient} resellers={resellers} goToReseller={goToReseller} leads={leads} goToSales={() => setModule("sales")} />}
          {module === "reports" && <ReportsView clients={clients} reportTemplates={reportTemplates} addReportTemplate={addReportTemplate} renameReportTemplate={renameReportTemplate} deleteReportTemplate={deleteReportTemplate} addTemplateSection={addTemplateSection} removeTemplateSection={removeTemplateSection} />}
          {module === "schedule" && <ScheduleView tasks={tasks} clients={clients} onboardings={onboardings} scheduleBlocks={scheduleBlocks} addScheduleBlock={addScheduleBlock} removeScheduleBlock={removeScheduleBlock} goToClient={goToClient} />}
        </div>
      </div>
    </div>
  );
}
