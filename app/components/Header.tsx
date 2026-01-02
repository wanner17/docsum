"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function Header() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const onLogout = async () => {
    await supabaseBrowser.auth.signOut();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* Left: Logo */}
        <Link href="/" className="font-semibold">
          DocSum
        </Link>

        {/* Right */}
        {!loading && (
          <div className="flex items-center gap-3 text-sm">
            {!user ? (
              <>
                <Link
                  href="/login"
                  className="rounded-md px-3 py-1.5 hover:bg-zinc-100"
                >
                  로그인
                </Link>
                <Link
                  href="/signup"
                  className="rounded-md bg-black px-3 py-1.5 text-white hover:bg-black/90"
                >
                  회원가입
                </Link>
              </>
            ) : (
              <>
                <button
                  onClick={onLogout}
                  className="rounded-md px-3 py-1.5 hover:bg-zinc-100"
                >
                  로그아웃
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
