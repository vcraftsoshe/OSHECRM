// Shared OHSMS builder logic. Keep in sync with functions/index.js (the Cloud Function
// has its own copy since it's a separate Node runtime and can't import this file directly)
// and with ohsms-builder-logic.md.
//
// SECTION_ITEMS mirrors the real Manual's actual heading/subheading structure and numbering
// (from the reference Manual document), in the correct real-document order. Conditional
// items (Plant & Equipment, Contractors, PPE, etc.) sit in their real numeric position
// (10-15) rather than being tacked on at the end, so a generated document reads in proper
// order. "Document Review History" (21 in the real manual) is deliberately excluded — that's
// handled separately by the Review Log feature, not printed on the document itself.
//
// SiteWise/Totika compliance-scheme items live entirely under Procedures now, not Manual
// Sections — several of them (Management of Change, Management Review) duplicated content
// already covered by the Manual's own Monitoring & Review subsections (18.x), so they were
// pulled out of the Manual and run as their own standalone documents instead. Items that are
// genuinely fillable forms (budget forms, audit schedules, meeting minutes) are excluded
// entirely — those live inside the OSHE App itself, not as documents this builder generates.

export const SECTION_ITEMS = [
  { label: "1. Introduction", always: true },
  { label: "2. Purpose", always: true },
  { label: "3. Scope", always: true },
  { label: "4. Health & Safety Policy", always: true },
  { label: "5. Leadership, Commitment, and Worker Participation", always: true },
  { label: "5.1 Organisational Roles, Responsibilities, Accountabilities & Authorities", always: true },
  { label: "5.2 Participation and Consultation", always: true },
  { label: "5.3 Health & Safety Issue Resolution", always: true },
  { label: "5.4 Health & Safety Representatives", always: true },
  { label: "6. Planning", always: true },
  { label: "6.1 Objectives", always: true },
  { label: "7. Hazard Identification and Assessment of OHS Risks", always: true },
  { label: "7.1 Legal and Other Requirements", always: true },
  { label: "8. Risk Management", always: true },
  { label: "8.1 Hierarchy of Controls", always: true },
  { label: "9. Incidents and Corrective Actions", always: true },
  { label: "9.1 Incident Reporting", always: true },
  { label: "10. Plant & Equipment", key: "plant" },
  { label: "11. Contractors", key: "contractors" },
  { label: "12. Emergency Preparedness and Response", key: "erp" },
  { label: "13. Personal Protective Equipment (PPE)", key: "ppe" },
  { label: "14. Exposure and Health Monitoring", key: "healthMonitoring" },
  { label: "15. Hazardous Substances", key: "hazardousSubstances" },
  { label: "16. Training", always: true },
  { label: "16.1 Induction", always: true },
  { label: "16.2 Competence", always: true },
  { label: "17. Reporting", always: true },
  { label: "18. Monitoring & Review", always: true },
  { label: "18.1 Monitoring, Measurement, KPIs, Analysis and Evaluation", always: true },
  { label: "18.2 Corrective Actions", always: true },
  { label: "18.3 Document, SOP and H.A.R.M Register Review", always: true },
  { label: "18.4 Assessment of OHS Risks to the OHS Management System", always: true },
  { label: "18.5 Identification of OHS Opportunities and Other Opportunities", always: true },
  { label: "18.6 Management of Change", always: true },
  { label: "18.7 Management Review", always: true },
  { label: "19. Support", always: true },
  { label: "19.1 Resources", always: true },
  { label: "19.2 External Advice", always: true },
  { label: "20. Document Control", always: true },
  // These aren't in the base Manual's own numbering — they're additional sections that get
  // switched on by their own trigger question, layered on top of the core document.
  { label: "Driving for Work", key: "vehicles" },
  { label: "Workplace Monitoring", key: "physicalWorkplace" },
  { label: "Environmental Management", key: "environmental" },
  { label: "Wellbeing", key: "wellbeing" },
  { label: "Fitness for Work", key: "drugAlcohol" },
  { label: "Continual Improvement", key: "continualImprovement" },
];

export const ALWAYS_PROCEDURES = ["Incident Reporting & Investigation Procedure", "Hazard & Risk Management Procedure"];

export const CONDITIONAL_PROCEDURES = [
  { key: "contractors", label: "Contractor Management Procedure" },
  { key: "plant", label: "Plant & Equipment Procedure" },
  { key: "ppe", label: "PPE Procedure" },
  { key: "hazardousSubstances", label: "Hazardous Substances Procedure" },
  { key: "healthMonitoring", label: "Health Monitoring Procedure" },
  { key: "erp", label: "Emergency Response Plan" },
  { key: "physicalWorkplace", label: "Workplace Inspection Procedure" },
  { key: "workers", label: "Induction & Training Procedure" },
  { key: "continualImprovement", label: "Continual Improvement Procedure" },
  { key: "wellbeing", label: "Wellbeing Procedure" },
];

export const COMPLIANCE_EXTRA_PROCEDURES = [
  "Health & Safety Budget Management Procedure",
  "Health & Safety Issue Resolution Procedure",
  "Annual H&S Review",
  "Performance Monitoring",
  "Objectives & KPIs",
  "Management Review",
  "Health & Safety Planning",
  "Worker Consultation (expanded)",
  "Internal Auditing / Monitoring",
  "Resource Allocation",
];

export const ALWAYS_POLICIES = ["Health & Safety Policy"];

export const CONDITIONAL_POLICIES = [
  { key: "drugAlcohol", label: "Drug & Alcohol Policy" },
  { key: "wellbeing", label: "Wellbeing Policy" },
  { key: "vehicles", label: "Driver Statement Policy" },
  { key: "environmental", label: "Environmental Policy" },
];

export function computeOhsmsPack(t) {
  const complianceForced = t.compliance === true;

  const sections = SECTION_ITEMS.filter((item) => {
    if (item.always) return true;
    if (item.key === "continualImprovement") return t.continualImprovement || complianceForced;
    return Boolean(t[item.key]);
  }).map((item) => item.label);

  const procedures = [...ALWAYS_PROCEDURES];
  CONDITIONAL_PROCEDURES.forEach((p) => {
    const on = p.key === "continualImprovement" ? (t.continualImprovement || complianceForced) : t[p.key];
    if (on) procedures.push(p.label);
  });
  if (complianceForced) procedures.push(...COMPLIANCE_EXTRA_PROCEDURES);

  const policies = [...ALWAYS_POLICIES];
  CONDITIONAL_POLICIES.forEach((p) => { if (t[p.key]) policies.push(p.label); });

  return { sections, procedures, policies, forms: [] };
}
