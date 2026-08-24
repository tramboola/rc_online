"use client";

import { Check, FloppyDisk, Trash, X } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { avatarKeys, type AvatarKey } from "../auth/avatar";

export type PrivateProfile = {
  email: string;
  nickname: string;
  avatarKey: AvatarKey;
};

type ProfileDialogProps = {
  open: boolean;
  onClose(): void;
  onDeleteAccount(): void;
  onSaved(profile: PrivateProfile): void;
};

const avatarLabels: Record<AvatarKey, string> = {
  "racer-red": "Racer red",
  "racer-cyan": "Racer cyan",
  "wheel-fire": "Wheel fire",
  "track-night": "Track night",
  "buggy-red": "Buggy red",
  "helmet-lime": "Helmet lime",
};

function isPrivateProfile(value: unknown): value is PrivateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.email === "string"
    && typeof profile.nickname === "string"
    && avatarKeys.includes(profile.avatarKey as AvatarKey);
}

export function ProfileDialog({ open, onClose, onDeleteAccount, onSaved }: ProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<PrivateProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [avatarKey, setAvatarKey] = useState<AvatarKey>("racer-red");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    void fetch("/api/account/profile", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as unknown;
      if (!response.ok || !isPrivateProfile(body)) throw new Error("profile unavailable");
      setProfile(body);
      setNickname(body.nickname);
      setAvatarKey(body.avatarKey);
      requestAnimationFrame(() => nicknameRef.current?.focus());
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setErrorMessage("Profile is unavailable. Try again.");
      }
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [open]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    const normalizedNickname = nickname.normalize("NFKC").trim();
    const nicknameLength = Array.from(normalizedNickname).length;
    if (nicknameLength < 3 || nicknameLength > 24) {
      setErrorMessage("Use 3 to 24 visible characters.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: normalizedNickname, avatarKey }),
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isPrivateProfile(body)) {
        setErrorMessage(response.status === 409
          ? "That nickname is unavailable."
          : "Profile could not be saved. Try again.");
        return;
      }
      setProfile(body);
      setNickname(body.nickname);
      setAvatarKey(body.avatarKey);
      setStatusMessage("Profile saved.");
      onSaved(body);
    } catch {
      setErrorMessage("Profile could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      aria-labelledby="profile-dialog-title"
      aria-modal="true"
      className="profile-dialog rc-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="rc-dialog-frame profile-dialog-frame">
        <button aria-label="Close profile dialog" className="rc-dialog-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={22} />
        </button>
        <p className="eyebrow">PRIVATE PROFILE</p>
        <h2 id="profile-dialog-title">EDIT PROFILE</h2>
        <p className="rc-dialog-copy">Choose how other drivers see you. Your email stays private.</p>

        {loading ? <p className="profile-loading" role="status">LOADING PROFILE...</p> : null}
        {!loading && errorMessage && !profile ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {profile ? (
          <form className="profile-form" noValidate onSubmit={(event) => void saveProfile(event)}>
            <label className="dialog-field">
              <span>EMAIL</span>
              <span className="dialog-input-wrap dialog-input-readonly">
                <input aria-label="Email" readOnly type="email" value={profile.email} />
              </span>
              <small>Used only for your private account and sign-in.</small>
            </label>
            <label className="dialog-field">
              <span>NICKNAME</span>
              <span className="dialog-input-wrap">
                <input
                  aria-label="Nickname"
                  autoComplete="nickname"
                  maxLength={24}
                  minLength={3}
                  onChange={(event) => setNickname(event.target.value)}
                  ref={nicknameRef}
                  value={nickname}
                />
              </span>
              <small>3–24 characters. You can drive with the generated nickname.</small>
            </label>

            <fieldset className="avatar-picker">
              <legend>CHOOSE AVATAR</legend>
              <div className="avatar-grid" role="radiogroup">
                {avatarKeys.map((key) => {
                  const selected = avatarKey === key;
                  return (
                    <label
                      className={selected ? "avatar-option selected" : "avatar-option"}
                      key={key}
                    >
                      <input
                        aria-label={avatarLabels[key]}
                        checked={selected}
                        className="avatar-radio"
                        name="avatarKey"
                        onChange={() => setAvatarKey(key)}
                        type="radio"
                        value={key}
                      />
                      <img alt="" src={`/assets/avatars/${key}.webp`} />
                      <span>{avatarLabels[key]}</span>
                      {selected ? <Check aria-hidden="true" className="avatar-check" size={17} weight="bold" /> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {statusMessage ? <p className="form-status" role="status">{statusMessage}</p> : null}
            {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
            <button className="dialog-primary-action" disabled={saving} type="submit">
              <FloppyDisk aria-hidden="true" size={20} /> {saving ? "SAVING..." : "SAVE PROFILE"}
            </button>
            <div className="profile-danger-zone">
              <span>
                <strong>DELETE ACCOUNT</strong>
                <small>Permanently remove your RC Mania account.</small>
              </span>
              <button className="dialog-danger-action" onClick={onDeleteAccount} type="button">
                <Trash aria-hidden="true" size={19} /> DELETE ACCOUNT
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
