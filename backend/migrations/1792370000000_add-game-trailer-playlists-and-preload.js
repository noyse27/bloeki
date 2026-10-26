exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE game_trailer_playlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL,
        table_name TEXT NOT NULL,
        game_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    );
    CREATE UNIQUE INDEX uq_game_trailer_playlist_game ON game_trailer_playlist(game_id);
    CREATE INDEX idx_game_trailer_playlist_expires ON game_trailer_playlist(expires_at);

    INSERT INTO game_trailer_playlist (table_id, table_name, game_id)
      SELECT g.table_id, t.name, g.id FROM game g JOIN game_table t ON t.id = g.table_id
      ON CONFLICT DO NOTHING;

    CREATE TABLE game_trailer_playlist_item (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        playlist_id UUID NOT NULL REFERENCES game_trailer_playlist(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position > 0),
        trailer_ref_id UUID REFERENCES trailer_ref(id),
        imdb_id TEXT NOT NULL,
        title TEXT NOT NULL,
        year_value INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX uq_game_trailer_playlist_item_position
      ON game_trailer_playlist_item(playlist_id, position);

    INSERT INTO game_trailer_playlist_item
      (playlist_id, position, trailer_ref_id, imdb_id, title, year_value)
      SELECT gp.id, r.index_no, tr.id, tr.imdb_id, tr.title, tr.year_value
      FROM game_trailer_playlist gp
      JOIN round r ON r.game_id = gp.game_id
      JOIN trailer_ref tr ON tr.id = r.trailer_id
      WHERE r.status = 'resolved'
      ON CONFLICT DO NOTHING;

    ALTER TABLE game ADD COLUMN next_trailer_id UUID REFERENCES trailer_ref(id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game DROP COLUMN next_trailer_id;
    DROP TABLE game_trailer_playlist_item;
    DROP TABLE game_trailer_playlist;
  `);
};
