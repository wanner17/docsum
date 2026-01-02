"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSignup = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabaseBrowser.auth.signUp({
        email,
        password,
      });
      if (error) throw error;

      // signUp 직후 session이 바로 안 오는 설정도 있음.
      // 그래도 대부분은 session이 오거나, email confirmation 쓰면 여기서 안내 필요.
      const token = data.session?.access_token;

      if (token) {
        await fetch("/api/migrate-anon", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        router.push("/history");
      } else {
        // 이메일 인증 켜져있으면 여기로 안내
        setMsg("가입 완료! 이메일 인증 후 로그인해주세요.");
      }
    } catch (e: any) {
      setMsg(e?.message ?? "회원가입 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">회원가입</h1>

      <div className="mt-4 space-y-3">
        <input
          className="w-full rounded-lg border px-3 py-2"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border px-3 py-2"
          placeholder="password (min 6)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="w-full rounded-lg bg-black px-3 py-2 text-white disabled:opacity-50"
          onClick={onSignup}
          disabled={loading}
        >
          {loading ? "가입 중..." : "회원가입"}
        </button>

        <button
          className="w-full rounded-lg border px-3 py-2"
          onClick={() => router.push("/login")}
        >
          로그인으로
        </button>

        {msg && <p className="text-sm text-zinc-700">{msg}</p>}
      </div>
    </div>
  );
}
