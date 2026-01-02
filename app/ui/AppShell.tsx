"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "../components/Header";


const NAV = [
  { href: "/", label: "업로드" },
  { href: "/history", label: "히스토리" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="mt-4 space-y-1">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={[
              "block rounded-lg px-3 py-2 text-sm",
              active ? "bg-black/5 font-medium" : "hover:bg-black/5",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // 페이지 이동 시 모바일 드로어 자동 닫기(UX)
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ESC로 닫기
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      {/* Desktop sidebar */}
      <aside className="hidden border-r sm:fixed sm:inset-y-0 sm:flex sm:w-64 sm:flex-col sm:px-4 sm:py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold">
            DocSum
          </Link>
          {/* <span className="text-xs text-zinc-500">MVP</span> */}
        </div>
        <NavLinks />
        <div className="mt-auto pt-4 text-xs text-zinc-500">
          익명 히스토리(anon_id)
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b bg-white px-4 py-3 text-zinc-900 sm:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5"
          aria-label="Open menu"
        >
          ☰
        </button>
        <Link href="/" className="text-sm font-semibold">
          DocSum
        </Link>
        <div className="ml-auto text-xs text-zinc-500">MVP</div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">메뉴</div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5"
                aria-label="Close menu"
              >
                닫기
              </button>
            </div>
            <div className="px-4 py-4">
              <NavLinks onNavigate={() => setOpen(false)} />
              <div className="mt-6 text-xs opacity-60">
                익명 히스토리(anon_id)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="sm:pl-64">
      {/* Desktop Header */}
      <div className="hidden sm:block sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6">
        <Header />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
