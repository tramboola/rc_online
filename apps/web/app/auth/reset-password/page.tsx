"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

export type ResetPasswordState = "form" | "invalid" | "updated";

const resetPasswordCopy: Record<
  Exclude<ResetPasswordState, "form">,
  { eyebrow: string; heading: string; body: string }
> = {
  invalid: {
    eyebrow: "RECOVERY LINK",
    heading: "LINK EXPIRED",
    body: "This password recovery link is invalid or has expired. Request a new one to continue.",
  },
  updated: {
    eyebrow: "ACCOUNT SECURED",
    heading: "PASSWORD UPDATED",
    body: "Your password was updated and your active sessions were signed out.",
  },
};

export function ResetPasswordStatus({
  state,
  onSubmit,
}: {
  state: ResetPasswordState;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (state === "form") {
    return (
      <main className="auth-error-page">
        <section className="data-panel auth-error-panel">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1>RESET PASSWORD</h1>
          <p>Choose a new password with 12 to 128 characters.</p>
          <form onSubmit={onSubmit}>
            <label>
              NEW PASSWORD
              <input autoComplete="new-password" maxLength={128} minLength={12} name="password" required type="password" />
            </label>
            <button className="hero-link" type="submit">UPDATE PASSWORD</button>
          </form>
        </section>
      </main>
    );
  }

  const copy = resetPasswordCopy[state];
  return (
    <main className="auth-error-page">
      <section className="data-panel auth-error-panel" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.heading}</h1>
        <p>{copy.body}</p>
        <Link className="hero-link" href="/">RETURN TO ACCOUNT</Link>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  const [state, setState] = useState<ResetPasswordState>("form");
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    tokenRef.current = url.searchParams.get("token");
    window.history.replaceState({}, "", window.location.pathname);
    if (!tokenRef.current) setState("invalid");
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenRef.current;
    const password = new FormData(event.currentTarget).get("password");
    if (!token || typeof password !== "string") {
      setState("invalid");
      return;
    }
    void fetch("/api/account/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    })
      .then((response) => setState(response.ok ? "updated" : "invalid"))
      .catch(() => setState("invalid"));
  }

  return <ResetPasswordStatus onSubmit={submit} state={state} />;
}
