"use client";

import styles from "./ride-control-resume.module.css";

export function RideControlResume({ onResume }: { readonly onResume: () => void }) {
  return (
    <aside className={styles.panel} aria-label="Controls paused">
      <span role="status">CONTROLS PAUSED</span>
      <button type="button" onClick={onResume}>RESUME CONTROLS</button>
      <small>Release the controls, then tap to resume.</small>
    </aside>
  );
}
