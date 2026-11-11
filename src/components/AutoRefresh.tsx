"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page every few seconds while the case is changing. */
export default function AutoRefresh({ active, intervalMs = 2500, maxMs = 180_000 }: { active: boolean; intervalMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > maxMs) return clearInterval(t);
      router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, maxMs, router]);
  return null;
}
