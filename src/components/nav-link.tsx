"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${active ? "bg-white/15 font-semibold text-white" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </Link>
  );
}
