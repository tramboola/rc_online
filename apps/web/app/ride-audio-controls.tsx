"use client";

import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";

import type { RideAudioState } from "./ride-media-playback";
import type { AudioSaveStatus } from "./ride-audio-preferences";

export function RideAudioControls({
  state,
  onToggle,
  onVolume,
  saveStatus = "saved",
}: {
  readonly state: RideAudioState;
  readonly onToggle: () => void;
  readonly onVolume: (volume: number) => void;
  readonly saveStatus?: AudioSaveStatus;
}) {
  const audible = state.hasAudio && !state.muted && !state.blocked && state.volume > 0;
  const label = !state.hasAudio ? "NO AUDIO" : state.blocked ? "ENABLE SOUND" : audible ? "SOUND ON" : "SOUND OFF";
  return (
    <section
      aria-label="Onboard sound"
      className="ride-audio-controls"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        aria-label={state.blocked ? "Enable onboard sound" : audible ? "Mute onboard sound" : "Unmute onboard sound"}
        aria-pressed={audible}
        disabled={!state.hasAudio}
        onClick={onToggle}
        type="button"
      >
        {audible ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />}
        {label}
      </button>
      <input
        aria-label="Onboard sound volume"
        disabled={!state.hasAudio}
        max={100}
        min={0}
        onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)}
        step={1}
        type="range"
        value={Math.round(state.volume * 100)}
      />
      {saveStatus === "not-saved" ? (
        <span className="ride-audio-save-status" role="status">VOLUME NOT SAVED</span>
      ) : null}
    </section>
  );
}
