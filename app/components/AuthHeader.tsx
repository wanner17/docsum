"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AuthHeader() {
  const router = useRouter();

  return (
    <div className="mb-6 flex items-center justify-between">
      <Link href="/" className="text-sm font-semibold">
        DocSum
      </Link>

      <button
        type="button"
        onClick={() => router.back()}
        className="rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5"
      >
        뒤로
      </button>
    </div>
  );
}
