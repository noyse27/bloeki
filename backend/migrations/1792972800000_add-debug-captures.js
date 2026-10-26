/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE debug_capture (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      disabled_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      enabled_by UUID REFERENCES app_user(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX idx_debug_capture_one_active
      ON debug_capture ((disabled_at IS NULL)) WHERE disabled_at IS NULL;
    CREATE INDEX idx_debug_capture_expiry ON debug_capture(expires_at) WHERE expires_at IS NOT NULL;

    CREATE TABLE debug_game_archive (
      capture_id UUID NOT NULL REFERENCES debug_capture(id) ON DELETE CASCADE,
      game_id UUID NOT NULL,
      table_id UUID NOT NULL,
      table_name TEXT NOT NULL,
      is_solo BOOLEAN NOT NULL,
      game_started_at TIMESTAMPTZ NOT NULL,
      first_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capture_id, game_id)
    );

    CREATE INDEX idx_debug_game_archive_table ON debug_game_archive(table_id, last_event_at DESC);
    CREATE INDEX idx_debug_game_archive_name ON debug_game_archive(LOWER(table_name));

    ALTER TABLE client_debug_event
      ADD COLUMN capture_id UUID REFERENCES debug_capture(id) ON DELETE CASCADE;
    ALTER TABLE game_event_log
      ADD COLUMN capture_id UUID REFERENCES debug_capture(id) ON DELETE CASCADE;

    CREATE INDEX idx_client_debug_event_capture_game
      ON client_debug_event(capture_id, game_id, created_at ASC);
    CREATE INDEX idx_game_event_log_capture_game
      ON game_event_log(capture_id, game_id, created_at ASC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_game_event_log_capture_game;
    DROP INDEX IF EXISTS idx_client_debug_event_capture_game;
    ALTER TABLE game_event_log DROP COLUMN IF EXISTS capture_id;
    ALTER TABLE client_debug_event DROP COLUMN IF EXISTS capture_id;
    DROP TABLE IF EXISTS debug_game_archive;
    DROP TABLE IF EXISTS debug_capture;
  `);
};
