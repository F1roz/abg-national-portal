"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map((t) => {
        const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t.label}</Link>;
      })}
    </nav>
  );
}
