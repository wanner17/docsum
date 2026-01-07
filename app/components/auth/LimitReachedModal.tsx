"use client";

import Link from "next/link";

export default function LimitReachedModal({
  open,
  onClose,
  limit = 3,
  loginHref = "/login?from=limit",
}: {
  open: boolean;
  onClose: () => void;
  limit?: number;
  loginHref?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="text-lg font-semibold">
          지금까지 만든 요약을 저장할 수 있어요
        </div>

        <div className="mt-2 text-sm text-slate-600">
          벌써 {limit}개의 문서를 요약했어요 ✨
          <br />
          지금 로그인하면:
        </div>

        <ul className="mt-3 space-y-1 text-sm">
          <li>• 지금까지 만든 요약이 모두 저장되고</li>
          <li>• 다른 기기에서도 다시 볼 수 있고</li>
          <li>• 바로 요약을 계속할 수 있어요</li>
        </ul>

        <div className="mt-5 space-y-2">
          <Link
            href={loginHref}
            className="block w-full rounded-xl bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
          >
            로그인하고 요약 저장하기
          </Link>

          <button
            type="button"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={onClose}
          >
            지금은 안 할래요
          </button>

          <div className="pt-1 text-center text-[11px] text-slate-400">
            ※ 로그인하지 않으면 새 요약은 만들 수 없어요
          </div>
        </div>
      </div>
    </div>
  );
}
