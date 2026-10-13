/**
 * Tracker templates. Every body gets a tracker from the template matching its department or type
 * when it is created (or when a term's structure is cloned). Admins can add columns afterwards.
 */
import type { BodyType, TrackerColumn, TrackerRollup } from "@/db/schema";

export type TrackerTemplate = {
  key: string;
  name: string;
  description: string;
  columns: TrackerColumn[];
  rollups: TrackerRollup[];
  /** KPIs to create alongside, bound to a rollup by index */
  kpis?: { name: string; rollupIndex: number; target: number; metricKey: string; unit?: string }[];
};

const OWNER: TrackerColumn = { key: "owner", label: "Owner", type: "user" };
const FUNNEL = ["Lead", "Applied", "Accepted", "Approved", "Realised", "Finished", "Lost"];

export const TRACKER_TEMPLATES: Record<string, TrackerTemplate> = {
  OGX: {
    key: "OGX", name: "oGX pipeline", description: "Outgoing exchange participants from lead to finish.",
    columns: [
      { key: "name", label: "EP name", type: "text", required: true },
      { key: "product", label: "Product", type: "select", options: ["Global Volunteer", "Global Talent", "Global Teacher"] },
      { key: "country", label: "Country", type: "text" },
      { key: "stage", label: "Stage", type: "select", options: FUNNEL, required: true },
      OWNER,
      { key: "next_follow_up", label: "Next follow-up", type: "date" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    rollups: [
      { label: "Applications", agg: "count", where: { column: "stage", in: ["Applied", "Accepted", "Approved", "Realised", "Finished"] } },
      { label: "Approvals", agg: "count", where: { column: "stage", in: ["Approved", "Realised", "Finished"] } },
      { label: "Realisations", agg: "count", where: { column: "stage", in: ["Realised", "Finished"] } },
    ],
    kpis: [
      { name: "Applications", rollupIndex: 0, target: 60, metricKey: "ogx.applications" },
      { name: "Approvals", rollupIndex: 1, target: 20, metricKey: "ogx.approvals" },
      { name: "Realisations", rollupIndex: 2, target: 12, metricKey: "ogx.realisations" },
    ],
  },
  ICX: {
    key: "ICX", name: "iCX pipeline", description: "Incoming exchange participants, opportunities and arrival logistics.",
    columns: [
      { key: "name", label: "Participant / opportunity", type: "text", required: true },
      { key: "project", label: "Project", type: "text" },
      { key: "stage", label: "Stage", type: "select", options: ["Open", "Applied", "Accepted", "Approved", "Visa", "Arrived", "Realised", "Finished", "Lost"], required: true },
      { key: "partner", label: "Partner", type: "text" },
      { key: "accommodation", label: "Accommodation", type: "select", options: ["Pending", "Arranged", "N/A"] },
      OWNER,
      { key: "arrival", label: "Arrival date", type: "date" },
    ],
    rollups: [
      { label: "Approvals", agg: "count", where: { column: "stage", in: ["Approved", "Visa", "Arrived", "Realised", "Finished"] } },
      { label: "Realisations", agg: "count", where: { column: "stage", in: ["Realised", "Finished"] } },
    ],
    kpis: [
      { name: "Approvals", rollupIndex: 0, target: 15, metricKey: "icx.approvals" },
      { name: "Realisations", rollupIndex: 1, target: 10, metricKey: "icx.realisations" },
    ],
  },
  BD: {
    key: "BD", name: "Partner CRM", description: "Partnership pipeline: lead → contacted → meeting → proposal → negotiation → won/lost.",
    columns: [
      { key: "organization", label: "Organisation", type: "text", required: true },
      { key: "contact", label: "Contact person", type: "text" },
      { key: "industry", label: "Industry", type: "text" },
      { key: "type", label: "Partnership type", type: "select", options: ["Financial", "In-kind", "Media", "University", "Exchange (iCX)", "Event"] },
      { key: "stage", label: "Stage", type: "select", options: ["Lead", "Contacted", "Meeting", "Proposal", "Negotiation", "Won", "Lost"], required: true },
      { key: "value", label: "Potential value (BDT)", type: "currency" },
      OWNER,
      { key: "next_follow_up", label: "Next follow-up", type: "date" },
      { key: "renewal", label: "MoU renewal", type: "date" },
    ],
    rollups: [
      { label: "Partnerships won", agg: "count", where: { column: "stage", in: ["Won"] } },
      { label: "Revenue won (BDT)", agg: "sum", column: "value", where: { column: "stage", in: ["Won"] } },
    ],
    kpis: [
      { name: "Partnerships won", rollupIndex: 0, target: 10, metricKey: "bd.partnerships" },
      { name: "Revenue won", rollupIndex: 1, target: 500000, metricKey: "bd.revenue", unit: "BDT" },
    ],
  },
  MKT: {
    key: "MKT", name: "Campaign tracker", description: "Campaigns, content, reach and leads generated.",
    columns: [
      { key: "campaign", label: "Campaign / content", type: "text", required: true },
      { key: "platform", label: "Platform", type: "select", options: ["Facebook", "Instagram", "LinkedIn", "TikTok", "Campus", "Email", "Other"] },
      { key: "status", label: "Status", type: "select", options: ["Planned", "In production", "Live", "Done"] },
      { key: "reach", label: "Reach", type: "number" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "budget", label: "Budget (BDT)", type: "currency" },
      OWNER,
      { key: "publish_date", label: "Publish date", type: "date" },
    ],
    rollups: [
      { label: "Leads generated", agg: "sum", column: "leads" },
      { label: "Total reach", agg: "sum", column: "reach" },
    ],
    kpis: [{ name: "Leads generated", rollupIndex: 0, target: 1500, metricKey: "mkt.leads" }],
  },
  FNL: {
    key: "FNL", name: "Finance ledger", description: "Income, expenses, receivables and payables.",
    columns: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "item", label: "Item", type: "text", required: true },
      { key: "type", label: "Type", type: "select", options: ["Income", "Expense", "Receivable", "Payable"], required: true },
      { key: "amount", label: "Amount (BDT)", type: "currency", required: true },
      { key: "status", label: "Status", type: "select", options: ["Planned", "Pending", "Paid", "Received", "Overdue"] },
      { key: "reference", label: "Reference", type: "text" },
    ],
    rollups: [
      { label: "Income (BDT)", agg: "sum", column: "amount", where: { column: "type", in: ["Income"] } },
      { label: "Expenses (BDT)", agg: "sum", column: "amount", where: { column: "type", in: ["Expense"] } },
      { label: "Open receivables (BDT)", agg: "sum", column: "amount", where: { column: "type", in: ["Receivable"] } },
    ],
    kpis: [{ name: "Income", rollupIndex: 0, target: 800000, metricKey: "fnl.income", unit: "BDT" }],
  },
  MX: {
    key: "MX", name: "Member experience tracker", description: "Engagement, education and retention of members.",
    columns: [
      { key: "member", label: "Member", type: "user", required: true },
      { key: "engagement", label: "Engagement", type: "select", options: ["High", "Medium", "Low", "At risk", "Left"] },
      { key: "education_done", label: "Education modules done", type: "number" },
      { key: "last_one_on_one", label: "Last 1:1", type: "date" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    rollups: [
      { label: "Members tracked", agg: "count" },
      { label: "At-risk members", agg: "count", where: { column: "engagement", in: ["Low", "At risk"] } },
    ],
  },
  IM: {
    key: "IM", name: "Information management log", description: "Data quality issues, dashboards and access requests.",
    columns: [
      { key: "item", label: "Item", type: "text", required: true },
      { key: "kind", label: "Kind", type: "select", options: ["Data quality", "Dashboard", "Access request", "System issue", "Report"] },
      { key: "status", label: "Status", type: "select", options: ["Open", "In progress", "Resolved"] },
      OWNER,
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [{ label: "Open items", agg: "count", where: { column: "status", in: ["Open", "In progress"] } }],
  },
  OD: {
    key: "OD", name: "Organisational development tracker", description: "Policies, structures, succession and culture initiatives.",
    columns: [
      { key: "initiative", label: "Initiative", type: "text", required: true },
      { key: "area", label: "Area", type: "select", options: ["Policy", "Structure", "Succession", "Culture", "Governance", "Performance"] },
      { key: "status", label: "Status", type: "select", options: ["Planned", "In progress", "Done", "Paused"] },
      OWNER,
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [{ label: "Initiatives done", agg: "count", where: { column: "status", in: ["Done"] } }],
  },
  EWA: {
    key: "EWA", name: "Alumni engagement tracker", description: "Alumni contacts, engagement and support.",
    columns: [
      { key: "alumnus", label: "Alumnus", type: "text", required: true },
      { key: "engagement", label: "Engagement", type: "select", options: ["Mentor", "Speaker", "Donor", "Partner intro", "Event", "Contacted"] },
      { key: "organization", label: "Organisation", type: "text" },
      OWNER,
      { key: "last_contact", label: "Last contact", type: "date" },
    ],
    rollups: [{ label: "Engaged alumni", agg: "count" }],
  },
  oc: {
    key: "oc", name: "OC tracker", description: "Event logistics, budget lines and delegate management.",
    columns: [
      { key: "item", label: "Item", type: "text", required: true },
      { key: "function", label: "Function", type: "select", options: ["Logistics", "Delegate experience", "Finance", "Partnerships", "Marketing", "Programme", "IM"] },
      { key: "status", label: "Status", type: "select", options: ["Not started", "In progress", "Done", "Blocked"] },
      { key: "budget", label: "Budget (BDT)", type: "currency" },
      OWNER,
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [
      { label: "Items done", agg: "count", where: { column: "status", in: ["Done"] } },
      { label: "Budget planned (BDT)", agg: "sum", column: "budget" },
    ],
  },
  project: {
    key: "project", name: "Project milestones", description: "Milestones, owners and status.",
    columns: [
      { key: "milestone", label: "Milestone", type: "text", required: true },
      { key: "status", label: "Status", type: "select", options: ["Not started", "On track", "At risk", "Delayed", "Done"] },
      OWNER,
      { key: "due", label: "Due", type: "date" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    rollups: [{ label: "Milestones done", agg: "count", where: { column: "status", in: ["Done"] } }],
  },
  synergy: {
    key: "synergy", name: "Synergy tracker", description: "Shared goals between departments and who contributes what.",
    columns: [
      { key: "goal", label: "Shared goal / action", type: "text", required: true },
      { key: "side", label: "Contributing side", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["Planned", "In progress", "Done", "Blocked"] },
      { key: "result", label: "Result", type: "number" },
      OWNER,
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [{ label: "Result total", agg: "sum", column: "result" }],
  },
  governance: {
    key: "governance", name: "Compliance tracker", description: "Compliance checks, findings and follow-ups.",
    columns: [
      { key: "item", label: "Item", type: "text", required: true },
      { key: "area", label: "Area", type: "select", options: ["Finance", "Elections", "Constitution", "Policy", "Audit", "Other"] },
      { key: "status", label: "Status", type: "select", options: ["Open", "Under review", "Compliant", "Non-compliant", "Closed"] },
      OWNER,
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [{ label: "Open findings", agg: "count", where: { column: "status", in: ["Open", "Under review", "Non-compliant"] } }],
  },
  risk: {
    key: "risk", name: "Risk register", description: "Entity-level risks, probability, impact and mitigation.",
    columns: [
      { key: "risk", label: "Risk", type: "text", required: true },
      { key: "probability", label: "Probability", type: "select", options: ["Low", "Medium", "High"] },
      { key: "impact", label: "Impact", type: "select", options: ["Low", "Medium", "High", "Critical"] },
      { key: "mitigation", label: "Mitigation", type: "text" },
      OWNER,
      { key: "status", label: "Status", type: "select", options: ["Open", "Mitigating", "Closed"] },
      { key: "due", label: "Deadline", type: "date" },
    ],
    rollups: [{ label: "Open high/critical risks", agg: "count", where: { column: "impact", in: ["High", "Critical"] } }],
  },
  team: {
    key: "team", name: "Team tracker", description: "Weekly goals and actions of the team.",
    columns: [
      { key: "action", label: "Action", type: "text", required: true },
      OWNER,
      { key: "status", label: "Status", type: "select", options: ["Planned", "In progress", "Done", "Blocked"] },
      { key: "result", label: "Result", type: "number" },
      { key: "due", label: "Due", type: "date" },
    ],
    rollups: [{ label: "Actions done", agg: "count", where: { column: "status", in: ["Done"] } }],
  },
};

export function templateFor(bodyType: BodyType, departmentKey: string | null): TrackerTemplate | null {
  if (bodyType === "oc" || bodyType === "project" || bodyType === "synergy" || bodyType === "governance") return TRACKER_TEMPLATES[bodyType]!;
  if ((bodyType === "department" || bodyType === "team") && departmentKey && TRACKER_TEMPLATES[departmentKey]) {
    return bodyType === "team" && !["OGX", "ICX", "BD", "MKT"].includes(departmentKey) ? TRACKER_TEMPLATES.team! : TRACKER_TEMPLATES[departmentKey]!;
  }
  if (bodyType === "team") return TRACKER_TEMPLATES.team!;
  if (bodyType === "support") return TRACKER_TEMPLATES.team!;
  return null;
}
