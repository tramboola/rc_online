"use client";

import { CreditCard, SignOut, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getAccountPresentation } from "./account-presentation";

export function AccountControl() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const presentation = getAccountPresentation(session);

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (presentation.state === "signed-out") {
    return (
      <div className="account-shell">
        <button
          className="account-chip account-button"
          disabled={status === "loading"}
          onClick={() => void signIn("google", { redirectTo: pathname })}
          type="button"
        >
          <UserCircle aria-hidden="true" size={23} />
          <span className="balance">{presentation.primary}</span>
          <small>{presentation.secondary}</small>
        </button>
      </div>
    );
  }

  return (
    <div className="account-shell" ref={containerRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="account-chip account-button"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <span aria-hidden="true" className="account-avatar">{presentation.initials}</span>
        <span className="balance">{presentation.primary}</span>
        <small>{presentation.secondary}</small>
      </button>
      {menuOpen ? (
        <div aria-label="Account" className="account-menu data-panel" role="menu">
          <div className="account-menu-identity">
            <span aria-hidden="true" className="account-avatar account-avatar-large">
              {presentation.initials}
            </span>
            <span>
              <strong>{presentation.displayName}</strong>
              <small>{presentation.email}</small>
            </span>
          </div>
          <div className="account-menu-balance">
            <small>ACCOUNT BALANCE</small>
            <strong>{presentation.primary}</strong>
          </div>
          <Link
            className="account-menu-action account-menu-primary"
            href="/pricing#packs"
            role="menuitem"
          >
            <CreditCard aria-hidden="true" size={20} />
            MANAGE BALANCE &amp; PLANS
          </Link>
          <button
            className="account-menu-action"
            onClick={() => void signOut({ redirectTo: pathname })}
            role="menuitem"
            type="button"
          >
            <SignOut aria-hidden="true" size={20} /> SIGN OUT
          </button>
        </div>
      ) : null}
    </div>
  );
}
