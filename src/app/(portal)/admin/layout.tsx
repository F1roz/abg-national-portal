import { requireActor, denied } from "@/lib/session";
import { NavTabs } from "@/components/nav-tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActor();
  const full = actor.isMCP || actor.system.has("system_admin") || actor.system.has("im_admin");
  const templates = full || actor.system.has("recruitment_admin") || actor.system.has("mx_admin");
  if (!templates) denied();
  const tabs = [
    ...(full ? [{ href: "/admin", label: "Overview" }, { href: "/admin/terms", label: "Terms" }, { href: "/admin/structure", label: "Structure" }, { href: "/admin/users", label: "Users" }, { href: "/admin/roles", label: "Roles & approvals" }] : []),
    { href: "/admin/templates", label: "Templates" },
    ...(full ? [{ href: "/admin/outbox", label: "Email outbox" }, { href: "/admin/audit", label: "Audit log" }, { href: "/admin/automation", label: "Automation" }] : []),
  ];
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">⚙️ Administration</h1>
      <p className="mb-4 text-sm text-gray-500">Configure terms, structure, people, templates and automation without changing code. Every change is audited.</p>
      <NavTabs tabs={tabs} />
      {children}
    </>
  );
}
