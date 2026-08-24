const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { Resend } = require("resend");

const resendApiKey = defineSecret("RESEND_API_KEY");

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

/* ---------- OHSMS builder logic, keep in sync with SignupForm.jsx and ohsms-builder-logic.md ---------- */
const SECTION_ITEMS = [
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
];
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
const COMPLIANCE_EXTRA_PROCEDURES = [
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
const ALWAYS_POLICIES = ["Health & Safety Policy"];
const CONDITIONAL_POLICIES = [
  { key: "drugAlcohol", label: "Drug & Alcohol Policy" },
  { key: "wellbeing", label: "Wellbeing Policy" },
  { key: "vehicles", label: "Driver Statement Policy" },
  { key: "environmental", label: "Environmental Policy" },
];

function computeOhsmsPack(t) {
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

/* ---------- T&Cs text, keep in sync with SignupForm.jsx ---------- */
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
  // Split on newlines first. A raw "\n" character passed straight into page.drawText()
  // is what was crashing this: pdf-lib's WinAnsi encoder can't render it, and any free-text
  // form answer with a line break in it (someone just pressing Enter in a textarea) would
  // trigger that immediately. Blank lines (someone pressing Enter twice) are preserved as
  // empty lines rather than silently disappearing.
  const paragraphs = text.split("\n");
  const lines = [];
  paragraphs.forEach((para) => {
    if (para === "") { lines.push(""); return; }
    const words = para.split(" ");
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
  });
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

  drawLine("OSHE Limited: Terms & Conditions", { size: 16, bold: true, gap: 24 });
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

// A plain record of what they actually answered on the sign-up form, separate from the
// T&Cs PDF (which is the legal agreement itself). Company/contact details, the plan and
// safety questions, which emergencies they flagged, and, where relevant, the OHSMS pack
// those answers worked out to (the same sections/procedures/policies list shown in the app),
// so there's a standalone document of "this is what they told us" to keep on file.
async function generateQuestionnairePdf({ form, submittedDate, emergencies, emergencyOther, pack }) {
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
  const newPage = () => { page = pdfDoc.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };
  const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };
  const drawLine = (text, opts = {}) => {
    const { size = 10, bold = false, gap = lineHeight, indent = 0 } = opts;
    ensureSpace(gap);
    page.drawText(text, { x: margin + indent, y, size, font: bold ? boldFont : font, color: rgb(0.08, 0.16, 0.14) });
    y -= gap;
  };
  const drawWrapped = (text, opts = {}) => {
    const { size = 10, gap = lineHeight, indent = 0 } = opts;
    wrapText(text, font, size, maxWidth - indent).forEach((line) => drawLine(line, { size, gap, indent }));
  };
  const drawField = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    ensureSpace(lineHeight + 4);
    page.drawText(label, { x: margin, y, size: 9, font: boldFont, color: rgb(0.36, 0.45, 0.45) });
    y -= 12;
    drawWrapped(String(value), { size: 10, gap: lineHeight });
    y -= 8;
  };

  drawLine("OSHE Limited: Sign-Up Questionnaire", { size: 16, bold: true, gap: 24 });
  drawLine(`Client: ${form.company}`, { size: 12, bold: true, gap: 18 });
  drawLine(`Submitted: ${submittedDate}`, { size: 9, gap: 22 });

  drawLine("Company & Contact", { size: 12, bold: true, gap: 18 });
  drawField("Contact name", form.contactName);
  drawField("Email", form.email);
  drawField("Accounts email", form.accountsEmail);
  drawField("Phone", form.phone);
  drawField("Address", form.address);
  drawField("Start date", form.startDate);

  ensureSpace(20);
  y -= 6;
  drawLine("Plan & Safety Details", { size: 12, bold: true, gap: 18 });
  drawField("General work tasks", form.workTasks);
  drawField("App tier selected", form.appUsers);
  drawField("Payment frequency", form.paymentFreq);
  drawField("Requires an OHSMS", form.requireOhsms);
  drawField("Monthly Reports add-on requested", form.wantsMonthlyReports ? "Yes" : "No");
  drawField("Where they heard about us", form.hearAboutUs);

  if (Array.isArray(emergencies) && emergencies.length > 0) {
    ensureSpace(20);
    y -= 6;
    drawLine("Emergencies Identified", { size: 12, bold: true, gap: 18 });
    emergencies.forEach((e) => drawLine(`•  ${e}`, { size: 10, gap: lineHeight, indent: 8 }));
    if (emergencyOther) drawLine(`•  Other: ${emergencyOther}`, { size: 10, gap: lineHeight, indent: 8 });
    y -= 8;
  }

  if (pack) {
    ensureSpace(20);
    y -= 6;
    drawLine("OHSMS Pack (from these answers)", { size: 12, bold: true, gap: 18 });
    const drawPackList = (title, list) => {
      if (!list || list.length === 0) return;
      drawLine(title, { size: 10, bold: true, gap: 14, indent: 4 });
      list.forEach((item) => drawLine(`•  ${item}`, { size: 9.5, gap: 13, indent: 12 }));
      y -= 6;
    };
    drawPackList("Manual Sections", pack.sections);
    drawPackList("Procedures", pack.procedures);
    drawPackList("Policies", pack.policies);
  }

  return pdfDoc.save();
}

/* ---------- Main function ---------- */
exports.submitSignup = onCall({ cors: true, memory: "512MiB" }, async (request) => {
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

  // A record of the actual sign-up answers themselves, separate from the signed T&Cs PDF.
  const questionnaireBytes = await generateQuestionnairePdf({ form, submittedDate, emergencies, emergencyOther, pack });
  const questionnaireFile = bucket.file(`questionnaires/${clientId}.pdf`);
  await questionnaireFile.save(Buffer.from(questionnaireBytes), { metadata: { contentType: "application/pdf" } });

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
    hearAboutUs: form.hearAboutUs || null,
    wantsMonthlyReports: Boolean(form.wantsMonthlyReports),
    triggers: triggers || null,
    emergencies: emergencies || [],
    emergencyOther: emergencyOther || null,
    ohsmsPack: pack,
    signedTermsPath: pdfFile.name,
    questionnairePath: questionnaireFile.name,
    existingFiles: existingFilePaths,
    logoPath,
  };

  const newClient = {
    name: form.company,
    legalName: form.company,
    logo: logoPath,
    contract: { start: submittedDate, renewal: addDays(submittedDate, 365), plan: "New client, plan to confirm" },
    billing: { contact: form.contactName, email: form.accountsEmail || form.email, terms: "20th of following month", status: "Current" },
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

/* ---------- Email sending (Resend) ----------
   App.jsx writes a doc to the "mail" collection whenever it needs to send something,
   either { to: [...], message: { subject, html } } for raw content, or
   { to: [...], template: { id, variables } } to use a Resend Template instead. This
   function fires automatically the moment a new doc lands there, sends it through Resend,
   and writes the outcome back onto the same document so it's visible in the Firestore
   console if anything ever needs checking. */
exports.sendQueuedEmail = onDocumentCreated(
  { document: "mail/{mailId}", secrets: [resendApiKey] },
  async (event) => {
    const snap = event.data;
    const data = snap.data();
    if (!data || !data.to || (!data.message && !data.template)) return;

    const resend = new Resend(resendApiKey.value());
    try {
      const payload = {
        // Must be a verified sending domain in Resend (or onboarding@resend.dev for testing
        // before oshe.co.nz is verified there). See the setup notes for this part.
        from: "OSHE Limited <hello@oshe.co.nz>",
        to: data.to,
      };
      if (data.template && data.template.id) {
        payload.template = { id: data.template.id, variables: data.template.variables || {} };
      } else {
        payload.subject = data.message.subject;
        payload.html = data.message.html;
      }
      await resend.emails.send(payload);
      await snap.ref.update({ status: "sent", sentAt: today() });
    } catch (err) {
      console.error("Resend send failed:", err);
      await snap.ref.update({ status: "error", error: String(err.message || err) });
    }
  }
);
