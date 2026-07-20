const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket("oshe-895ad.firebasestorage.app");

function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------- OHSMS builder logic — keep in sync with SignupForm.jsx and ohsms-builder-logic.md ---------- */
const ALWAYS_SECTIONS = ["Introduction", "Purpose", "Scope", "Health & Safety Policy", "Leadership & Commitment", "Roles & Responsibilities", "Worker Participation", "Planning", "Hazard & Risk Management", "Incident Management", "Training & Competency", "Reporting", "Monitoring & Review", "Support", "Document Control"];
const CONDITIONAL_SECTIONS = [
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
const COMPLIANCE_EXTRA_SECTIONS = ["Performance Monitoring", "Objectives & KPIs", "Management Review", "Health & Safety Planning", "Worker Consultation (expanded)", "Internal Auditing / Monitoring", "Resource Allocation"];
const ALWAYS_PROCEDURES = ["Incident Reporting & Investigation Procedure", "Hazard & Risk Management Procedure"];
const CONDITIONAL_PROCEDURES = [
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
const COMPLIANCE_EXTRA_PROCEDURES = ["Health & Safety Budget Management Procedure", "Health & Safety Issue Resolution Procedure"];
const ALWAYS_POLICIES = ["Health & Safety Policy"];
const CONDITIONAL_POLICIES = [
  { key: "drugAlcohol", label: "Drug & Alcohol Policy" },
  { key: "wellbeing", label: "Wellbeing Policy" },
  { key: "vehicles", label: "Driver Statement Policy" },
  { key: "environmental", label: "Environmental Policy" },
];
const COMPLIANCE_EXTRA_FORMS = ["Annual Health & Safety Budget Form", "Management Review Form", "Annual Objectives & Action Plan", "Internal Audit Schedule", "Internal Audit Report", "Annual H&S Review", "Annual Management Review Minutes"];

function computeOhsmsPack(t) {
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

  const forms = complianceForced ? [...COMPLIANCE_EXTRA_FORMS] : [];

  return { sections, procedures, policies, forms };
}

/* ---------- T&Cs text — keep in sync with SignupForm.jsx ---------- */
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

/* ---------- PDF generation ---------- */
function wrapText(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generateSignedPdf({ companyName, contactName, submittedDate, signaturePngBytes }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 14;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };
  const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };
  const drawLine = (text, opts = {}) => {
    const { size = 10, bold = false, gap = lineHeight } = opts;
    ensureSpace(gap);
    page.drawText(text, { x: margin, y, size, font: bold ? boldFont : font, color: rgb(0.08, 0.16, 0.14) });
    y -= gap;
  };

  drawLine("OSHE Limited — Terms & Conditions", { size: 16, bold: true, gap: 24 });
  drawLine(`Client: ${companyName}`, { size: 11, bold: true, gap: 16 });
  drawLine(`Signed by: ${contactName}     Date: ${submittedDate}`, { size: 10, gap: 22 });

  for (const section of termsSections) {
    ensureSpace(20);
    drawLine(section.title, { size: 12, bold: true, gap: 16 });
    for (const para of section.body) {
      const lines = wrapText(para, font, 10, maxWidth);
      for (const line of lines) drawLine(line, { size: 10, gap: lineHeight });
      y -= 4;
    }
  }

  ensureSpace(160);
  y -= 10;
  drawLine("Signature:", { size: 11, bold: true, gap: 18 });
  if (signaturePngBytes) {
    const sigImage = await pdfDoc.embedPng(signaturePngBytes);
    const sigDims = sigImage.scale(0.35);
    ensureSpace(sigDims.height + 10);
    page.drawImage(sigImage, { x: margin, y: y - sigDims.height, width: sigDims.width, height: sigDims.height });
    y -= sigDims.height + 10;
  }

  return pdfDoc.save();
}

/* ---------- Main function ---------- */
exports.submitSignup = onCall({ cors: true }, async (request) => {
  const data = request.data || {};
  const { leadId, form, triggers, emergencies, emergencyOther, logoDataUrl, signatureDataUrl, existingFiles } = data;

  if (!form || !form.company || !form.email || !form.contactName || !form.phone) {
    throw new HttpsError("invalid-argument", "Missing required company details.");
  }
  if (!signatureDataUrl) {
    throw new HttpsError("invalid-argument", "A signature is required.");
  }

  const clientId = "c" + Date.now();
  const submittedDate = today();

  // Default workflow for onboarding
  const workflowsSnap = await db.collection("workflows").where("isDefault", "==", true).limit(1).get();
  const wfDoc = workflowsSnap.empty ? (await db.collection("workflows").limit(1).get()).docs[0] : workflowsSnap.docs[0];
  const wf = wfDoc ? { id: wfDoc.id, ...wfDoc.data() } : null;

  // Logo upload (optional)
  let logoPath = null;
  if (logoDataUrl && logoDataUrl.startsWith("data:image")) {
    const base64 = logoDataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");
    const file = bucket.file(`logos/${clientId}/logo.png`);
    await file.save(buffer, { metadata: { contentType: "image/png" } });
    logoPath = file.name;
  }

  // Any existing documents the client attached, uploaded as-is for OSHE to work into their system
  const existingFilePaths = [];
  if (Array.isArray(existingFiles)) {
    for (const f of existingFiles) {
      if (!f || !f.dataUrl || !f.name) continue;
      const match = f.dataUrl.match(/^data:(.*?);base64,(.*)$/);
      if (!match) continue;
      const [, contentType, base64] = match;
      const buffer = Buffer.from(base64, "base64");
      const safeName = f.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const file = bucket.file(`existing-files/${clientId}/${safeName}`);
      await file.save(buffer, { metadata: { contentType } });
      existingFilePaths.push({ name: f.name, path: file.name });
    }
  }

  // Signature upload
  const sigBase64 = signatureDataUrl.split(",")[1];
  const sigBuffer = Buffer.from(sigBase64, "base64");
  const sigFile = bucket.file(`signatures/${clientId}/signature.png`);
  await sigFile.save(sigBuffer, { metadata: { contentType: "image/png" } });

  // Signed T&Cs PDF
  const pdfBytes = await generateSignedPdf({
    companyName: form.company,
    contactName: form.contactName,
    submittedDate,
    signaturePngBytes: sigBuffer,
  });
  const pdfFile = bucket.file(`signed-terms/${clientId}.pdf`);
  await pdfFile.save(Buffer.from(pdfBytes), { metadata: { contentType: "application/pdf" } });

  // OHSMS pack, computed server-side from the trigger answers (not trusted blindly from the client)
  const wantsOhsms = form.requireOhsms === "Yes";
  const pack = wantsOhsms && triggers ? computeOhsmsPack(triggers) : null;

  const intake = {
    submittedDate,
    contactEmail: form.email,
    accountsEmail: form.accountsEmail || null,
    contactName: form.contactName,
    phone: form.phone,
    address: form.address || null,
    startDate: form.startDate || null,
    workTasks: form.workTasks || null,
    appUsers: form.appUsers || null,
    paymentFreq: form.paymentFreq || null,
    requireOhsms: form.requireOhsms || null,
    triggers: triggers || null,
    emergencies: emergencies || [],
    emergencyOther: emergencyOther || null,
    ohsmsPack: pack,
    signedTermsPath: pdfFile.name,
    existingFiles: existingFilePaths,
    logoPath,
  };

  const newClient = {
    name: form.company,
    legalName: form.company,
    logo: logoPath,
    contract: { start: submittedDate, renewal: addDays(submittedDate, 365), plan: "New client — plan to confirm" },
    billing: { contact: form.contactName, email: form.accountsEmail || form.email, terms: "TBC", status: "Current" },
    billingType: "FlatFee",
    billingSetupDone: false,
    profile: "Standard Client",
    archived: false,
    contacts: [{ id: Date.now(), name: form.contactName, role: "Primary Contact", email: form.email, phone: form.phone }],
    notes: [],
    reminders: [],
    extras: [],
    hours: { included: 0, log: [] },
    users: { log: [] },
    ohsmsLastIssued: null,
    ohsmsDue: addDays(submittedDate, 90),
    intake,
  };

  await db.collection("clients").doc(clientId).set(newClient);

  if (wf) {
    await db.collection("onboardings").doc(clientId).set({
      list: [{
        id: "ob" + Date.now(),
        workflowId: wf.id,
        workflowName: wf.name,
        startedDate: submittedDate,
        completedDate: null,
        steps: (wf.steps || []).map((s) => ({ ...s, done: false, dueDate: addDays(submittedDate, s.dueDays) })),
      }],
    });
  }

  if (leadId) {
    await db.collection("leads").doc(leadId).delete().catch(() => {});
  }

  return { clientId };
});
