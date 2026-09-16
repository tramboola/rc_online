ALTER TABLE users
  ADD COLUMN onboard_volume_percent integer NOT NULL DEFAULT 100,
  ADD COLUMN onboard_muted boolean NOT NULL DEFAULT false,
  ADD COLUMN onboard_audio_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_onboard_volume_range CHECK (onboard_volume_percent BETWEEN 0 AND 100),
  ADD CONSTRAINT users_onboard_audio_revision_nonnegative CHECK (onboard_audio_revision >= 0);
