"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onLogin = async () => {
    setLoading(true);
    setMsg(null);

    try {
      // ✅ anon 쿠키 보장(없으면 발급)
      await fetch("/api/anon", {
        method: "POST",
        credentials: "include",
      }).catch(() => {});

      const { data, error } = await supabaseBrowser.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      const token = data.session?.access_token;

      // ✅ 로그인 성공 후 자동 이관(있으면 1회 시도, 없으면 noop)
      if (token) {
        await fetch("/api/migrate-anon", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }).catch(() => {});
      }

      router.push("/history");
    } catch (e: any) {
      setMsg(e?.message ?? "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h1 className="text-xl font-semibold text-slate-900">로그인</h1>
      <p className="mt-1 text-sm text-slate-600">
        히스토리 저장 및 추가 기능을 사용하려면 로그인하세요.
      </p>

      <div className="mt-4 space-y-3">
        <input
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="email"
          value={email}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="w-full rounded-xl bg-black px-3 py-2 text-white disabled:opacity-50"
          onClick={onLogin}
          disabled={loading}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        <button
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 hover:bg-slate-50"
          onClick={() => router.push("/signup")}
        >
          회원가입
        </button>

        {msg && <p className="text-sm text-rose-600">{msg}</p>}
      </div>
    </div>
  );
}
