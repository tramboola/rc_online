"use client";

import styles from "./ride-control-resume.module.css";

export function RideControlResume({
  onResume,
  disabled = false,
  detail = "Release the controls, then tap to resume.",
}: {
  readonly onResume: () => void;
  readonly disabled?: boolean;
  readonly detail?: string;
}) {
  return (
    <aside className={styles.panel} aria-label="Controls paused">
      <span role="status">CONTROLS PAUSED</span>
      <button type="button" disabled={disabled} onClick={onResume}>RESUME CONTROLS</button>
      <small>{detail}</small>
    </aside>
  );
}
