import { escapeHtml } from "./util";

export const TEMPLATE_VARIABLES = [
  "candidate_name", "preferred_name", "position", "department", "lc_name", "term", "start_date", "reporting_manager",
  "selection_date", "offer_expiry_date", "candidate_id", "offer_id", "portal_link", "offer_link", "onboarding_link", "name",
] as const;

/** {{var}} substitution with escaping. Unknown variables are left visible so mistakes are noticed. */
export function fillVars(text: string, vars: Record<string, string | null | undefined>, escape = true): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return m;
    return escape ? escapeHtml(v) : v;
  });
}

/**
 * Renders an admin-authored template to safe HTML.
 * Supported formatting: "# " / "## " headings, "- " bullets, **bold**, blank-line paragraphs.
 * The template text is escaped first, so a template can never inject markup or scripts.
 */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  const escaped = escapeHtml(body);
  const filled = fillVars(escaped, vars, true);
  const blocks = filled.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      }
      if (block.startsWith("## ")) return `<h3>${inline(block.slice(3))}</h3>`;
      if (block.startsWith("# ")) return `<h2>${inline(block.slice(2))}</h2>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("\n");
}

function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function plainSubject(subject: string, vars: Record<string, string | null | undefined>): string {
  return fillVars(subject, vars, false).replace(/[\r\n]/g, " ");
}
