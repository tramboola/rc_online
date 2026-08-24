"use client";

import { InstagramLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function LegalFooter() {
  const pathname = usePathname();

  if (pathname === "/ride" || pathname.startsWith("/ride/")) return null;

  return (
    <footer className="legal-footer">
      <nav aria-label="Legal and social links">
        <Link href="/privacy">PRIVACY</Link>
        <Link href="/terms">TERMS</Link>
        <a
          aria-label="RC Mania on Instagram"
          href="https://www.instagram.com/rcmania.live/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <InstagramLogo aria-hidden="true" size={20} weight="bold" />
        </a>
      </nav>
    </footer>
  );
}
