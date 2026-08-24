"use client";

import { CreditCard, PencilSimple, SignOut, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountDialog } from "./account-dialog";
import { getAccountPresentation } from "./account-presentation";
import { ProfileDialog } from "./profile-dialog";

export function AccountControl() {
  const pathname = usePathname();
  const { data: session, status, update } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
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
          aria-label={`${presentation.primary} ${presentation.secondary}`}
          className="account-chip account-button"
          disabled={status === "loading"}
          onClick={() => setAccountDialogOpen(true)}
          type="button"
        >
          <UserCircle aria-hidden="true" size={23} />
          <span className="balance">{presentation.primary}</span>
          <small>{presentation.secondary}</small>
        </button>
        <AccountDialog
          onClose={() => setAccountDialogOpen(false)}
          onSignedIn={() => {
            setAccountDialogOpen(false);
            void update();
          }}
          open={accountDialogOpen}
          returnTo={pathname}
        />
      </div>
    );
  }

  return (
    <div className="account-shell" ref={containerRef}>
      <button
        aria-label={`${presentation.primary} ${presentation.secondary}`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="account-chip account-button"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <span aria-hidden="true" className="account-avatar account-avatar-image">
          <img alt="" src={presentation.avatarSrc} />
        </span>
        <span className="balance">{presentation.primary}</span>
        <small>{presentation.secondary}</small>
      </button>
      {menuOpen ? (
        <div aria-label="Account" className="account-menu data-panel" role="menu">
          <div className="account-menu-identity">
            <span aria-hidden="true" className="account-avatar account-avatar-image account-avatar-large">
              <img alt="" src={presentation.avatarSrc} />
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
          <button
            className="account-menu-action account-menu-primary"
            onClick={() => {
              setMenuOpen(false);
              setProfileDialogOpen(true);
            }}
            role="menuitem"
            type="button"
          >
            <PencilSimple aria-hidden="true" size={20} /> EDIT PROFILE
          </button>
          <Link
            className="account-menu-action"
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
      <ProfileDialog
        onClose={() => setProfileDialogOpen(false)}
        onDeleteAccount={() => setProfileDialogOpen(false)}
        onSaved={() => void update()}
        open={profileDialogOpen}
      />
    </div>
  );
}
