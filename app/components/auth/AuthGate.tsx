"use client";

import React from "react";
import LimitReachedModal from "./LimitReachedModal";

export default function AuthGate({
  canProceed,
  open,
  onOpen,
  onClose,
  children,
  loginHref,
}: {
  canProceed: boolean; // true면 통과
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode; // 실제 버튼
  loginHref?: string;
}) {
  return (
    <>
      <span
        onClick={(e) => {
          // 버튼 클릭을 가로채서 모달로 유도
          if (!canProceed) {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }
        }}
      >
        {children}
      </span>

      <LimitReachedModal open={open} onClose={onClose} loginHref={loginHref} />
    </>
  );
}
