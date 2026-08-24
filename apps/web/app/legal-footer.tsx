"use client";

import { InstagramLogo } from "@phosphor-icons/react";
import Link from "next/link";

export function LegalFooter() {
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
