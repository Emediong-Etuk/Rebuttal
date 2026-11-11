import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Rebuttal: answers every PayPal dispute before the deadline",
  description: "An AI agent that answers PayPal disputes for small sellers: contests with real evidence, recommends refunds when the seller is wrong, one tap to resolve.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="top">
            <Link href="/" className="brand">
              Rebuttal<span>.</span>
            </Link>
            <nav className="links">
              <Link href="/demo">Demo</Link>
              <Link href="/cases">Cases</Link>
              <a href={REPO_URL}>Code</a>
            </nav>
          </header>
          {children}
          <footer className="foot">Runs against the PayPal sandbox. Not affiliated with PayPal. MIT licensed.</footer>
        </div>
      </body>
    </html>
  );
}
