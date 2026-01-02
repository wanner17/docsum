"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();

  const itemClass = (href: string) =>
    `block rounded-lg px-3 py-2 text-sm ${
      pathname === href
        ? "bg-black text-white"
        : "hover:bg-black/5"
    }`;

  return (
    <aside className="w-56 border-r p-4">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">DocSum</h1>
        <p className="text-xs opacity-60">Document Summary</p>
      </div>

      <nav className="space-y-1">
        <Link href="/" className={itemClass("/")}>
          ➕ New Summary
        </Link>
        <Link href="/history" className={itemClass("/history")}>
          📚 History
        </Link>
      </nav>
    </aside>
  );
}
