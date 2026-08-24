"use client";

import {
  ArrowLeft,
  ArrowRight,
  EnvelopeSimple,
  GoogleLogo,
  LockKey,
  PaperPlaneTilt,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { type FormEvent, useEffect, useRef, useState } from "react";

type AccountDialogView =
  | "sign-in"
  | "create-account"
  | "forgot-password"
  | "pending-verification"
  | "pending-reset";

type AccountResponse = {
  ok?: boolean;
  message?: string;
};

type AccountDialogProps = {
  open: boolean;
  returnTo: string;
  onClose(): void;
  onSignedIn(): void;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function passwordLengthIsValid(password: string): boolean {
  const length = Array.from(password).length;
  return length >= 12 && length <= 128;
}

async function postAccountRequest(
  path: string,
  body: Record<string, string>,
): Promise<{ response: Response; body: AccountResponse }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let responseBody: AccountResponse = {};
  try {
    responseBody = await response.json() as AccountResponse;
  } catch {
    // The visible fallback below is intentionally generic.
  }
  return { response, body: responseBody };
}

export function AccountDialog({ open, returnTo, onClose, onSignedIn }: AccountDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<AccountDialogView>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) emailRef.current?.focus();
  }, [open, view]);

  function changeView(nextView: AccountDialogView) {
    setView(nextView);
    setFieldErrors({});
    setErrorMessage("");
    setStatusMessage("");
    setPassword("");
    setPasswordConfirmation("");
  }

  function validateEmail(): Record<string, string> {
    return emailPattern.test(email.trim()) ? {} : { email: "Enter a valid email address." };
  }

  function validateCredentials(includeConfirmation: boolean): Record<string, string> {
    const errors = validateEmail();
    if (!passwordLengthIsValid(password)) {
      errors.password = "Use 12 to 128 characters.";
    }
    if (includeConfirmation && password !== passwordConfirmation) {
      errors.passwordConfirmation = "Passwords do not match.";
    }
    return errors;
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const registering = view === "create-account";
    const errors = validateCredentials(registering);
    setFieldErrors(errors);
    setErrorMessage("");
    setStatusMessage("");
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const { response, body } = await postAccountRequest(
        registering ? "/api/account/register" : "/api/account/sign-in/password",
        { email: email.trim(), password },
      );
      if (registering && response.ok) {
        setView("pending-verification");
        return;
      }
      if (!registering && response.ok) {
        onSignedIn();
        return;
      }
      setErrorMessage(body.message || "Unable to continue. Try again.");
    } catch {
      setErrorMessage("Account service is unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateEmail();
    setFieldErrors(errors);
    setErrorMessage("");
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const { response, body } = await postAccountRequest("/api/account/forgot-password", {
        email: email.trim(),
      });
      if (!response.ok) {
        setErrorMessage(body.message || "Unable to send a reset link. Try again later.");
        return;
      }
      setView("pending-reset");
    } catch {
      setErrorMessage("Account service is unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const { response } = await postAccountRequest("/api/account/resend-verification", {
        email: email.trim(),
      });
      if (!response.ok) {
        setErrorMessage("Unable to resend right now. Try again later.");
        return;
      }
      setStatusMessage("Verification email requested. Check your inbox.");
    } catch {
      setErrorMessage("Unable to resend right now. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  const dialogTitle = view === "create-account"
    ? "Create your RC Mania account"
    : view === "forgot-password"
      ? "Reset password"
      : view === "pending-verification" || view === "pending-reset"
        ? "Check your inbox"
        : "Sign in to RC Mania";

  return (
    <dialog
      aria-labelledby="account-dialog-title"
      aria-modal="true"
      className="account-dialog rc-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="rc-dialog-frame">
        <button aria-label="Close account dialog" className="rc-dialog-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={22} />
        </button>

        {(view === "pending-verification" || view === "pending-reset") ? (
          <section className="account-pending">
            <span aria-hidden="true" className="rc-dialog-icon"><PaperPlaneTilt size={30} /></span>
            <p className="eyebrow">EMAIL SENT</p>
            <h2 id="account-dialog-title">{dialogTitle}</h2>
            <p className="rc-dialog-copy">
              {view === "pending-verification"
                ? "Open the verification link before signing in. The link expires after 24 hours."
                : "If the address can be used, a password reset link is on its way."}
            </p>
            <strong className="account-pending-email">{email.trim()}</strong>
            {view === "pending-verification" ? (
              <button className="dialog-secondary-action" disabled={busy} onClick={() => void resendVerification()} type="button">
                RESEND VERIFICATION EMAIL
              </button>
            ) : null}
            {statusMessage ? <p className="form-status" role="status">{statusMessage}</p> : null}
            {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
            <button className="dialog-text-action" onClick={() => changeView("sign-in")} type="button">
              <ArrowLeft aria-hidden="true" size={17} /> BACK TO SIGN IN
            </button>
          </section>
        ) : (
          <>
            <p className="eyebrow">RC MANIA ACCOUNT</p>
            <h2 id="account-dialog-title">{dialogTitle}</h2>
            <p className="rc-dialog-copy">
              Sign in to manage your profile, balance, and live driving access.
            </p>

            {view !== "forgot-password" ? (
              <div aria-label="Account view" className="account-dialog-tabs" role="group">
                <button
                  aria-label="Show sign in form"
                  aria-pressed={view === "sign-in"}
                  className={view === "sign-in" ? "active" : ""}
                  onClick={() => changeView("sign-in")}
                  type="button"
                >
                  SIGN IN
                </button>
                <button
                  aria-label="Show create account form"
                  aria-pressed={view === "create-account"}
                  className={view === "create-account" ? "active" : ""}
                  onClick={() => changeView("create-account")}
                  type="button"
                >
                  CREATE ACCOUNT
                </button>
              </div>
            ) : null}

            {view === "sign-in" ? (
              <button
                className="google-sign-in"
                disabled={busy}
                onClick={() => void signIn("google", { redirectTo: returnTo })}
                type="button"
              >
                <GoogleLogo aria-hidden="true" size={22} weight="bold" /> SIGN IN WITH GOOGLE
              </button>
            ) : null}

            {view === "sign-in" ? <div className="dialog-divider"><span>OR USE EMAIL</span></div> : null}

            {view === "forgot-password" ? (
              <form className="account-form" noValidate onSubmit={(event) => void submitForgotPassword(event)}>
                <AccountEmailField email={email} error={fieldErrors.email} inputRef={emailRef} setEmail={setEmail} />
                {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
                <button className="dialog-primary-action" disabled={busy} type="submit">
                  {busy ? "SENDING..." : "SEND RESET LINK"} <ArrowRight aria-hidden="true" size={20} />
                </button>
                <button className="dialog-text-action" onClick={() => changeView("sign-in")} type="button">
                  <ArrowLeft aria-hidden="true" size={17} /> BACK TO SIGN IN
                </button>
              </form>
            ) : (
              <form className="account-form" noValidate onSubmit={(event) => void submitCredentials(event)}>
                <AccountEmailField email={email} error={fieldErrors.email} inputRef={emailRef} setEmail={setEmail} />
                <label className="dialog-field">
                  <span>PASSWORD</span>
                  <span className="dialog-input-wrap">
                    <LockKey aria-hidden="true" size={19} />
                    <input
                      aria-label="Password"
                      aria-describedby={fieldErrors.password ? "account-password-error" : undefined}
                      aria-invalid={Boolean(fieldErrors.password)}
                      autoComplete={view === "create-account" ? "new-password" : "current-password"}
                      id="account-password"
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      value={password}
                    />
                  </span>
                  {fieldErrors.password ? <small className="field-error" id="account-password-error">{fieldErrors.password}</small> : null}
                </label>
                {view === "create-account" ? (
                  <label className="dialog-field">
                    <span>CONFIRM PASSWORD</span>
                    <span className="dialog-input-wrap">
                      <LockKey aria-hidden="true" size={19} />
                      <input
                        aria-label="Confirm password"
                        aria-describedby={fieldErrors.passwordConfirmation ? "account-password-confirmation-error" : undefined}
                        aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
                        autoComplete="new-password"
                        id="account-password-confirmation"
                        name="passwordConfirmation"
                        onChange={(event) => setPasswordConfirmation(event.target.value)}
                        type="password"
                        value={passwordConfirmation}
                      />
                    </span>
                    {fieldErrors.passwordConfirmation ? (
                      <small className="field-error" id="account-password-confirmation-error">{fieldErrors.passwordConfirmation}</small>
                    ) : null}
                  </label>
                ) : null}
                {view === "sign-in" ? (
                  <button className="forgot-password-action" onClick={() => changeView("forgot-password")} type="button">
                    FORGOT PASSWORD?
                  </button>
                ) : null}
                {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
                <button className="dialog-primary-action" disabled={busy} type="submit">
                  {busy ? "PLEASE WAIT..." : view === "create-account" ? "CREATE ACCOUNT" : "SIGN IN WITH EMAIL"}
                  <ArrowRight aria-hidden="true" size={20} />
                </button>
                {view === "create-account" ? (
                  <p className="account-legal-notice">
                    By continuing, you agree to the <Link href="/terms">Terms of Service</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.
                  </p>
                ) : null}
              </form>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

function AccountEmailField({
  email,
  error,
  inputRef,
  setEmail,
}: {
  email: string;
  error: string | undefined;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setEmail(value: string): void;
}) {
  return (
    <label className="dialog-field">
      <span>EMAIL</span>
      <span className="dialog-input-wrap">
        <EnvelopeSimple aria-hidden="true" size={19} />
        <input
          aria-label="Email"
          aria-describedby={error ? "account-email-error" : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="email"
          id="account-email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          ref={inputRef}
          type="email"
          value={email}
        />
      </span>
      {error ? <small className="field-error" id="account-email-error">{error}</small> : null}
    </label>
  );
}
