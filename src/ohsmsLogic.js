// Shared OHSMS builder logic. Keep in sync with functions/index.js (the Cloud Function
// has its own copy since it's a separate Node runtime and can't import this file directly)
// and with ohsms-builder-logic.md.

export const ALWAYS_SECTIONS = ["Introduction", "Purpose", "Scope", "Health & Safety Policy", "Leadership & Commitment", "Roles & Responsibilities", "Worker Participation", "Planning", "Hazard & Risk Management", "Incident Management", "Training & Competency", "Reporting", "Monitoring & Review", "Support", "Document Control"];

export const CONDITIONAL_SECTIONS = [
  { key: "contractors", label: "Contractor Management" },
  { key: "plant", label: "Plant & Equipment" },
  { key: "ppe", label: "PPE" },
  { key: "healthMonitoring", label: "Exposure & Health Monitoring" },
  { key: "hazardousSubstances", label: "Hazardous Substances" },
  { key: "erp", label: "Emergency Preparedness" },
  { key: "vehicles", label: "Driving for Work" },
  { key: "physicalWorkplace", label: "Workplace Monitoring" },
  { key: "environmental", label: "Environmental Management" },
  { key: "wellbeing", label: "Wellbeing" },
  { key: "drugAlcohol", label: "Fitness for Work" },
  { key: "continualImprovement", label: "Continual Improvement" },
];

export const COMPLIANCE_EXTRA_SECTIONS = ["Performance Monitoring", "Objectives & KPIs", "Management Review", "Health & Safety Planning", "Worker Consultation (expanded)", "Internal Auditing / Monitoring", "Resource Allocation"];

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

export const COMPLIANCE_EXTRA_PROCEDURES = ["Health & Safety Budget Management Procedure", "Health & Safety Issue Resolution Procedure", "Annual Health & Safety Budget Form", "Management Review Form", "Annual Objectives & Action Plan", "Internal Audit Schedule", "Internal Audit Report", "Annual H&S Review", "Annual Management Review Minutes"];

export const ALWAYS_POLICIES = ["Health & Safety Policy"];

export const CONDITIONAL_POLICIES = [
  { key: "drugAlcohol", label: "Drug & Alcohol Policy" },
  { key: "wellbeing", label: "Wellbeing Policy" },
  { key: "vehicles", label: "Driver Statement Policy" },
  { key: "environmental", label: "Environmental Policy" },
];

export function computeOhsmsPack(t) {
  const complianceForced = t.compliance === true;
  const sections = [...ALWAYS_SECTIONS];
  CONDITIONAL_SECTIONS.forEach((s) => {
    const on = s.key === "continualImprovement" ? (t.continualImprovement || complianceForced) : t[s.key];
    if (on) sections.push(s.label);
  });
  if (complianceForced) sections.push(...COMPLIANCE_EXTRA_SECTIONS);

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
