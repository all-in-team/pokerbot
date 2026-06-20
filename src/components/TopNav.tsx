"use client";

/**
 * Shared top navigation — makes every page feel like one app. Uses the unified
 * CSS tokens (surface / line / teal) so it matches the /watch look everywhere.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Arène" },
  { href: "/play", label: "Play" },
  { href: "/watch", label: "Watch" },
  { href: "/learning", label: "Learning" },
  { href: "/solver", label: "Solver" },
];

export function TopNav({ right }: { right?: ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(14,17,23,0.82)",
        borderBottom: "1px solid var(--color-line)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="flex items-center gap-3 flex-wrap md:flex-nowrap"
        style={{ maxWidth: 1400, margin: "0 auto", padding: "10px clamp(16px,4vw,28px)" }}
      >
        <Link href="/" className="shrink-0" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ color: "var(--color-teal)", fontSize: 18 }}>♠</span>
          <span style={{ fontWeight: 800, letterSpacing: -0.2, color: "var(--color-cream)" }}>PokerHub</span>
        </Link>

        {/* Mobile: full-width scrollable row below the logo. Desktop: inline. */}
        <nav className="no-scrollbar flex gap-1 overflow-x-auto order-last basis-full md:order-none md:basis-auto">
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="shrink-0 whitespace-nowrap"
                style={{
                  padding: "6px 12px",
                  borderRadius: 9,
                  fontSize: 13.5,
                  fontWeight: active ? 700 : 500,
                  textDecoration: "none",
                  color: active ? "#08130F" : "var(--color-muted)",
                  background: active ? "var(--color-teal)" : "transparent",
                  border: active ? "none" : "1px solid transparent",
                  transition: "color .15s ease, background .15s ease",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {right && <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">{right}</div>}
      </div>
    </header>
  );
}
