"use client";

import { useEffect } from "react";

export default function AnonInit() {
  useEffect(() => {
    fetch("/api/anon", { method: "POST" });
  }, []);

  return null;
}
