"use client";

import { Check, FloppyDisk, Trash, WarningOctagon, X } from "@phosphor-icons/react";
import Link from "next/link";
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
  onDeleted(): void;
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

export function ProfileDialog({ open, onClose, onDeleted, onSaved }: ProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  const requestGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const deletingRef = useRef(false);
  const [profile, setProfile] = useState<PrivateProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [avatarKey, setAvatarKey] = useState<AvatarKey>("racer-red");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  openRef.current = open;

  function invalidateRequests() {
    requestGenerationRef.current += 1;
    loadControllerRef.current?.abort();
    saveControllerRef.current?.abort();
    deleteControllerRef.current?.abort();
    loadControllerRef.current = null;
    saveControllerRef.current = null;
    deleteControllerRef.current = null;
    deletingRef.current = false;
  }

  function requestIsCurrent(
    controller: AbortController,
    generation: number,
    controllerRef: React.RefObject<AbortController | null>,
  ): boolean {
    return openRef.current
      && !controller.signal.aborted
      && requestGenerationRef.current === generation
      && controllerRef.current === controller;
  }

  function closeProfileDialog() {
    if (deletingRef.current) return;
    invalidateRequests();
    setDeleteMode(false);
    setDeleteConfirmation("");
    setDeleting(false);
    setErrorMessage("");
    setStatusMessage("");
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    invalidateRequests();
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setSaving(false);
    setErrorMessage("");
    setStatusMessage("");
    setDeleteMode(false);
    setDeleteConfirmation("");
    setDeleting(false);
    void fetch("/api/account/profile", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as unknown;
      if (!requestIsCurrent(controller, generation, loadControllerRef)) return;
      if (!response.ok || !isPrivateProfile(body)) throw new Error("profile unavailable");
      setProfile(body);
      setNickname(body.nickname);
      setAvatarKey(body.avatarKey);
      requestAnimationFrame(() => nicknameRef.current?.focus());
    }).catch((error: unknown) => {
      if (requestIsCurrent(controller, generation, loadControllerRef)
        && !(error instanceof DOMException && error.name === "AbortError")) {
        setErrorMessage("Profile is unavailable. Try again.");
      }
    }).finally(() => {
      if (requestIsCurrent(controller, generation, loadControllerRef)) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    });
    return () => invalidateRequests();
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

    saveControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = requestGenerationRef.current;
    saveControllerRef.current = controller;
    setSaving(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: normalizedNickname, avatarKey }),
        signal: controller.signal,
      });
      const body = await response.json() as unknown;
      if (!requestIsCurrent(controller, generation, saveControllerRef)) return;
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
      if (requestIsCurrent(controller, generation, saveControllerRef)) {
        setErrorMessage("Profile could not be saved. Try again.");
      }
    } finally {
      if (requestIsCurrent(controller, generation, saveControllerRef)) {
        saveControllerRef.current = null;
        setSaving(false);
      }
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirmation !== "DELETE") return;
    deleteControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = requestGenerationRef.current;
    deleteControllerRef.current = controller;
    deletingRef.current = true;
    setDeleting(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
        signal: controller.signal,
      });
      if (!requestIsCurrent(controller, generation, deleteControllerRef)) return;
      if (!response.ok) {
        setErrorMessage("Account could not be deleted. Try again later.");
        return;
      }
      onDeleted();
    } catch {
      if (requestIsCurrent(controller, generation, deleteControllerRef)) {
        setErrorMessage("Account could not be deleted. Try again later.");
      }
    } finally {
      if (requestIsCurrent(controller, generation, deleteControllerRef)) {
        deleteControllerRef.current = null;
        deletingRef.current = false;
        setDeleting(false);
      }
    }
  }

  return (
    <dialog
      aria-labelledby="profile-dialog-title"
      aria-modal="true"
      className="profile-dialog rc-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!deletingRef.current) closeProfileDialog();
      }}
      ref={dialogRef}
    >
      <div className="profile-dialog-frame-shell">
        <div className="rc-dialog-frame profile-dialog-frame">
        <button aria-label="Close profile dialog" className="rc-dialog-close" disabled={deleting} onClick={closeProfileDialog} type="button">
          <X aria-hidden="true" size={22} />
        </button>
        <p className="eyebrow">{deleteMode ? "ACCOUNT CONTROL" : "PRIVATE PROFILE"}</p>
        <h2 id="profile-dialog-title">{deleteMode ? "DELETE ACCOUNT PERMANENTLY" : "EDIT PROFILE"}</h2>
        <p className="rc-dialog-copy">
          {deleteMode
            ? "This cannot be undone. Your sign-in methods, profile, and active sessions will be removed."
            : "Choose how other drivers see you. Your email stays private."}
        </p>

        {!deleteMode && loading ? <p className="profile-loading" role="status">LOADING PROFILE...</p> : null}
        {!deleteMode && !loading && errorMessage && !profile ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {deleteMode ? (
          <form className="account-delete-confirmation" onSubmit={(event) => void deleteAccount(event)}>
            <WarningOctagon aria-hidden="true" className="account-delete-warning-icon" size={48} weight="duotone" />
            <p>
              Type <strong>DELETE</strong> below to confirm. Some transaction and consent records may be retained where legally required, as described in our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>.
            </p>
            <label className="dialog-field">
              <span>TYPE DELETE TO CONFIRM</span>
              <span className="dialog-input-wrap">
                <input
                  aria-label="Type DELETE to confirm"
                  autoComplete="off"
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  spellCheck={false}
                  value={deleteConfirmation}
                />
              </span>
            </label>
            {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
            <div className="account-delete-actions">
              <button
                className="dialog-secondary-action"
                disabled={deleting}
                onClick={() => {
                  setDeleteMode(false);
                  setDeleteConfirmation("");
                  setErrorMessage("");
                }}
                type="button"
              >
                KEEP MY ACCOUNT
              </button>
              <button
                className="dialog-danger-action account-delete-confirm"
                disabled={deleting || deleteConfirmation !== "DELETE"}
                type="submit"
              >
                <Trash aria-hidden="true" size={19} /> {deleting ? "DELETING..." : "PERMANENTLY DELETE ACCOUNT"}
              </button>
            </div>
          </form>
        ) : profile ? (
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
            <button className="dialog-primary-action profile-save-action" disabled={saving} type="submit">
              <FloppyDisk aria-hidden="true" size={20} /> {saving ? "SAVING..." : "SAVE PROFILE"}
            </button>
            <div className="profile-danger-zone">
              <span>
                <strong>DELETE ACCOUNT</strong>
                <small>Permanently remove your RC Mania account.</small>
              </span>
              <button
                className="dialog-danger-action"
                onClick={() => {
                  setDeleteMode(true);
                  setDeleteConfirmation("");
                  setErrorMessage("");
                  setStatusMessage("");
                }}
                type="button"
              >
                <Trash aria-hidden="true" size={19} /> DELETE ACCOUNT
              </button>
            </div>
          </form>
        ) : null}
        </div>
      </div>
    </dialog>
  );
}
