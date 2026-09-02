/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Frische initiale Schema-Migration fuer bloeki, konsolidiert aus songsters
// gewachsener Migrationshistorie (siehe adolar-songster/backend/migrations)
// - aber ohne die dortige Adolar-Integration (adolar_playlist*,
// table_session_song_pool -> ersetzt durch table_session_trailer_pool) und
// ohne die Token-Spielmechanik (token_usage, round.mode, 'bonus'/'token'-
// Runden, timeline_card.special_type='token_win'). round.status kennt daher
// nur noch countdown -> playing -> guessing -> resolved (siehe
// services/roundEngine.ts) statt songsters
// countdown/playing/token_solo/token_others/resolved.
//
// Fremdschluessel auf game_table sind hier direkt mit ON DELETE CASCADE
// angelegt (songster hat das erst nachtraeglich per ALTER TABLE nachgezogen,
// siehe dessen table-inactivity-cleanup-Migration) - siehe
// services/tableCleanup.ts fuer die periodische Hart-Loeschung inaktiver
// Tische, die sich darauf verlaesst.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE app_user (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        karma_points INTEGER NOT NULL DEFAULT 0,
        score_points INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        session_version INTEGER NOT NULL DEFAULT 1,
        can_create_invites BOOLEAN NOT NULL DEFAULT FALSE,
        invite_quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        registered_via_invite_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (role IN ('user', 'admin')),
        CHECK (status IN ('active', 'blocked'))
    );

    CREATE TABLE invite_token (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(64) NOT NULL UNIQUE,
        created_by UUID NOT NULL REFERENCES app_user(id),
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ,
        disabled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (max_uses > 0),
        CHECK (used_count >= 0)
    );

    ALTER TABLE app_user
      ADD CONSTRAINT app_user_registered_via_invite_id_fkey
      FOREIGN KEY (registered_via_invite_id) REFERENCES invite_token(id);

    CREATE INDEX idx_app_user_registered_via_invite ON app_user(registered_via_invite_id);
    CREATE INDEX idx_invite_token_created_by ON invite_token(created_by);

    -- Kein source_playlist_id/Adolar-Auswahl: bloeki hat genau eine lokale
    -- Trailer-Bibliothek (siehe trailer_ref unten), keine Playlist-Wahl bei
    -- Tischerzeugung.
    CREATE TABLE game_table (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID NOT NULL REFERENCES app_user(id),
        name VARCHAR(120) NOT NULL,
        visibility VARCHAR(20) NOT NULL,
        join_code VARCHAR(32),
        allow_spectators BOOLEAN NOT NULL DEFAULT TRUE,
        max_players INTEGER NOT NULL DEFAULT 5,
        max_spectators INTEGER NOT NULL DEFAULT 10,
        state VARCHAR(20) NOT NULL DEFAULT 'open',
        settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        owner_left_at TIMESTAMPTZ,
        match_ended_at TIMESTAMPTZ,
        min_karma_points INTEGER,
        min_score_points INTEGER,
        min_games_played INTEGER,
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        display_connected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (visibility IN ('public', 'private')),
        CHECK (state IN ('open', 'running', 'finished', 'closed')),
        CHECK (max_players BETWEEN 2 AND 5),
        CHECK (max_spectators BETWEEN 0 AND 50),
        CHECK (min_karma_points IS NULL OR min_karma_points >= 0),
        CHECK (min_score_points IS NULL OR min_score_points >= 0),
        CHECK (min_games_played IS NULL OR min_games_played >= 0)
    );

    CREATE TABLE table_seat (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL REFERENCES game_table(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        seat_type VARCHAR(20) NOT NULL,
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        CHECK (seat_type IN ('player', 'spectator'))
    );

    CREATE INDEX idx_table_seat_table ON table_seat(table_id);
    CREATE INDEX idx_table_seat_user ON table_seat(user_id);
    CREATE UNIQUE INDEX uq_table_seat_active_user ON table_seat(table_id, user_id) WHERE left_at IS NULL;

    CREATE TABLE table_session (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL REFERENCES game_table(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        CHECK (status IN ('active', 'ended'))
    );

    CREATE INDEX idx_table_session_table ON table_session(table_id);

    -- Ersatz fuer songsters song_ref: kein "source"/externer Lieferant, die
    -- Trailer-Bibliothek liegt komplett lokal (siehe
    -- services/trailerScan.ts, das diese Tabelle per Dateisystem-Scan des
    -- gemounteten Snippet-Ordners befuellt). clip_path zeigt auf die
    -- zugeschnittene .mp4 im Ordner, den tools/snippet-cutter befuellt hat.
    CREATE TABLE trailer_ref (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        imdb_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        year_value INTEGER NOT NULL,
        clip_path TEXT NOT NULL,
        clip_status TEXT NOT NULL DEFAULT 'ready',
        is_valid BOOLEAN NOT NULL DEFAULT TRUE,
        last_played_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (year_value BETWEEN 1900 AND 2100),
        CHECK (clip_status IN ('ready', 'missing'))
    );

    CREATE INDEX idx_trailer_ref_valid_ready ON trailer_ref(is_valid, clip_status);

    -- Analog zu songsters table_session_song_pool: der bei Session-Start
    -- einmalig gezogene Batch (siehe services/trailerBatch.ts), auf den
    -- Rundenauswahl und Jahresspannbreite dieser Session beschraenkt sind.
    CREATE TABLE table_session_trailer_pool (
        table_session_id UUID NOT NULL REFERENCES table_session(id) ON DELETE CASCADE,
        trailer_ref_id UUID NOT NULL REFERENCES trailer_ref(id),
        PRIMARY KEY (table_session_id, trailer_ref_id)
    );

    CREATE TABLE game (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL REFERENCES game_table(id) ON DELETE CASCADE,
        table_session_id UUID NOT NULL REFERENCES table_session(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        winner_user_id UUID REFERENCES app_user(id),
        round_ready_started_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status IN ('pending', 'active', 'finished', 'aborted'))
    );

    CREATE INDEX idx_game_table ON game(table_id);
    CREATE INDEX idx_game_table_session ON game(table_session_id);

    -- Kein mode-Spalte (kein normal/token/bonus wie bei songster): bloeki
    -- kennt nur eine Rundenart. status durchlaeuft countdown -> playing ->
    -- guessing -> resolved (siehe roundEngine.ts) - "guessing" ist neu
    -- gegenueber songster, wo waehrend des Songs geraten wurde; bei bloeki
    -- erst NACH dem 25s-Trailer, in einem eigenen 10s-Fenster.
    CREATE TABLE round (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
        index_no INTEGER NOT NULL,
        trailer_id UUID NOT NULL REFERENCES trailer_ref(id),
        status VARCHAR(20) NOT NULL DEFAULT 'countdown',
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (index_no > 0),
        CHECK (status IN ('countdown', 'playing', 'guessing', 'resolved', 'failed'))
    );

    CREATE INDEX idx_round_game ON round(game_id);
    CREATE INDEX idx_round_trailer ON round(trailer_id);
    CREATE UNIQUE INDEX uq_round_game_trailer ON round(game_id, trailer_id);

    CREATE TABLE session_trailer_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_session_id UUID NOT NULL REFERENCES table_session(id) ON DELETE CASCADE,
        trailer_ref_id UUID NOT NULL REFERENCES trailer_ref(id),
        first_played_round_id UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
        play_count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (play_count > 0)
    );

    CREATE UNIQUE INDEX uq_session_trailer_history_unique ON session_trailer_history(table_session_id, trailer_ref_id);
    CREATE INDEX idx_session_trailer_history_session ON session_trailer_history(table_session_id);

    -- guess_type nur noch 'position' (kein 'exact_year' mehr - das war
    -- songsters Bonusrunden-/Token-Mechanik fuer exakte Jahresraten).
    CREATE TABLE guess (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        guess_type VARCHAR(20) NOT NULL,
        value_number INTEGER,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_correct BOOLEAN,
        CHECK (guess_type IN ('position'))
    );

    CREATE INDEX idx_guess_round ON guess(round_id);
    CREATE INDEX idx_guess_user ON guess(user_id);

    -- special_type nur noch 'normal' (kein 'token_win' - es gibt keine
    -- Token-Karten in bloeki).
    CREATE TABLE timeline_card (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        source_round_id UUID REFERENCES round(id) ON DELETE CASCADE,
        year_value INTEGER NOT NULL,
        special_type VARCHAR(30) NOT NULL DEFAULT 'normal',
        placed_position INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (special_type IN ('normal'))
    );

    CREATE INDEX idx_timeline_card_game_user ON timeline_card(game_id, user_id);

    CREATE TABLE karma_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_user(id),
        game_id UUID REFERENCES game(id) ON DELETE SET NULL,
        delta INTEGER NOT NULL,
        reason VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_karma_ledger_user ON karma_ledger(user_id);

    CREATE TABLE score_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_user(id),
        game_id UUID REFERENCES game(id) ON DELETE SET NULL,
        delta INTEGER NOT NULL,
        reason VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_score_ledger_user ON score_ledger(user_id);

    -- Kleiner Key/Value-Store fuer deployment-weite Admin-Einstellungen
    -- (bloeki braucht das u.a. fuer den "total_games_finished"-Zaehler, aber
    -- nicht fuer Musikquellen-Konfiguration wie songster - es gibt keine).
    CREATE TABLE system_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Pro-Runde-Bereitschaft (roundReady.ts): jede Runde ab der zweiten
    -- oeffnet mit einem 30s Bereitschaftsfenster.
    CREATE TABLE round_ready (
        game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, user_id)
    );

    CREATE TABLE round_sitout (
        round_id UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        PRIMARY KEY (round_id, user_id)
    );

    -- "Auto bereit"-Praeferenz, an game_id gebunden (siehe roundReady.ts).
    CREATE TABLE round_ready_pref (
        game_id UUID NOT NULL REFERENCES game(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_user(id),
        auto_ready BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, user_id)
    );

    -- Chat (Lobby/Tisch) - unveraendert von songster uebernommen.
    CREATE TABLE chat_message (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      table_id UUID REFERENCES game_table(id) ON DELETE CASCADE,
      sender_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      body VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      CHECK (scope IN ('lobby', 'table')),
      CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
      CHECK ((scope = 'lobby' AND table_id IS NULL) OR (scope = 'table' AND table_id IS NOT NULL))
    );

    CREATE INDEX idx_chat_message_lobby_created ON chat_message(created_at DESC) WHERE scope = 'lobby' AND deleted_at IS NULL;
    CREATE INDEX idx_chat_message_table_created ON chat_message(table_id, created_at DESC) WHERE scope = 'table' AND deleted_at IS NULL;
    CREATE INDEX idx_chat_message_sender_created ON chat_message(sender_user_id, created_at DESC);

    -- Playboard-Reaktionen je Spielphase - 'token' durch 'guessing' ersetzt,
    -- sonst unveraendert von songster uebernommen.
    CREATE TABLE playboard_reaction (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phase VARCHAR(20) NOT NULL,
      asset_id VARCHAR(40) NOT NULL,
      label VARCHAR(24) NOT NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (phase IN ('waiting', 'countdown', 'playing', 'guessing', 'resolved', 'finished')),
      CHECK (char_length(trim(label)) BETWEEN 1 AND 24),
      CHECK (sort_order BETWEEN 0 AND 7),
      UNIQUE (phase, asset_id),
      UNIQUE (phase, sort_order)
    );

    INSERT INTO playboard_reaction (phase, asset_id, label, sort_order) VALUES
      ('waiting', 'hello', 'Hallo', 0), ('waiting', 'like', 'Stark', 1),
      ('waiting', 'laugh', 'Lustig', 2), ('waiting', 'target', 'Guter Tipp', 3),
      ('waiting', 'technical', 'Technikproblem', 4),
      ('countdown', 'like', 'Stark', 0), ('countdown', 'think', 'Keine Ahnung', 1),
      ('countdown', 'technical', 'Technikproblem', 2),
      ('playing', 'like', 'Stark', 0), ('playing', 'think', 'Keine Ahnung', 1),
      ('playing', 'technical', 'Technikproblem', 2),
      ('guessing', 'like', 'Stark', 0), ('guessing', 'think', 'Keine Ahnung', 1),
      ('guessing', 'technical', 'Technikproblem', 2),
      ('resolved', 'like', 'Stark', 0), ('resolved', 'laugh', 'Lustig', 1),
      ('resolved', 'target', 'Guter Tipp', 2), ('resolved', 'technical', 'Technikproblem', 3),
      ('finished', 'like', 'Stark', 0), ('finished', 'laugh', 'Lustig', 1),
      ('finished', 'target', 'Guter Tipp', 2), ('finished', 'technical', 'Technikproblem', 3);

    -- Hostmodus (gemeinsames Anzeigegeraet) - unveraendert von songster
    -- uebernommen, nichts davon ist Adolar- oder Token-spezifisch.
    CREATE TABLE host_device (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(120) NOT NULL,
      install_id_hash TEXT NOT NULL,
      device_secret_hash TEXT NOT NULL,
      authorized_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      pairing_code VARCHAR(16) UNIQUE,
      pairing_expires_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'pairing',
      last_seen_at TIMESTAMPTZ,
      current_table_id UUID REFERENCES game_table(id) ON DELETE SET NULL,
      current_display_token TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      authorized_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      CHECK (status IN ('pairing', 'authorized', 'revoked', 'expired'))
    );

    CREATE INDEX idx_host_device_authorized_user ON host_device(authorized_user_id) WHERE status = 'authorized';
    CREATE INDEX idx_host_device_pairing_code ON host_device(pairing_code) WHERE pairing_code IS NOT NULL;

    -- Beta-Diagnostik (Client- und Server-Events) - unveraendert uebernommen.
    CREATE TABLE client_debug_event (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      client_session_id TEXT,
      device_id TEXT,
      client_kind TEXT,
      user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      table_id UUID,
      game_id UUID,
      round_id UUID,
      round_index INTEGER,
      request_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX idx_client_debug_event_game_created ON client_debug_event(game_id, created_at DESC);
    CREATE INDEX idx_client_debug_event_round_created ON client_debug_event(round_id, created_at DESC);
    CREATE INDEX idx_client_debug_event_session_created ON client_debug_event(client_session_id, created_at DESC);
    CREATE INDEX idx_client_debug_event_type_created ON client_debug_event(event_type, created_at DESC);

    CREATE TABLE game_event_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      table_id UUID,
      game_id UUID,
      round_id UUID,
      round_index INTEGER,
      user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      request_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX idx_game_event_log_game_created ON game_event_log(game_id, created_at ASC);
    CREATE INDEX idx_game_event_log_round_created ON game_event_log(round_id, created_at ASC);
    CREATE INDEX idx_game_event_log_type_created ON game_event_log(event_type, created_at DESC);

    INSERT INTO system_setting (key, value) VALUES ('total_games_finished', '0');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS game_event_log;
    DROP TABLE IF EXISTS client_debug_event;
    DROP TABLE IF EXISTS host_device;
    DROP TABLE IF EXISTS playboard_reaction;
    DROP TABLE IF EXISTS chat_message;
    DROP TABLE IF EXISTS round_ready_pref;
    DROP TABLE IF EXISTS round_sitout;
    DROP TABLE IF EXISTS round_ready;
    DROP TABLE IF EXISTS system_setting;
    DROP TABLE IF EXISTS score_ledger;
    DROP TABLE IF EXISTS karma_ledger;
    DROP TABLE IF EXISTS timeline_card;
    DROP TABLE IF EXISTS guess;
    DROP TABLE IF EXISTS session_trailer_history;
    DROP TABLE IF EXISTS round;
    DROP TABLE IF EXISTS game;
    DROP TABLE IF EXISTS table_session_trailer_pool;
    DROP TABLE IF EXISTS trailer_ref;
    DROP TABLE IF EXISTS table_session;
    DROP TABLE IF EXISTS table_seat;
    DROP TABLE IF EXISTS game_table;
    ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_registered_via_invite_id_fkey;
    DROP TABLE IF EXISTS invite_token;
    DROP TABLE IF EXISTS app_user;
  `);
};
