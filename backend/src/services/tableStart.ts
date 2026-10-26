import { pool } from '../db/pool';
import { computeYearRange, generateStartBlocks } from './timeline';
import { loadTrailerBatch } from './trailerBatch';
import { RoundEngineError } from './errors';
import { selectTrailerForGame } from './trailerPool';
import { warmTrailerFile } from './trailerFileCache';

export type TableStartOutcome =
  | { ok: true; tableSessionId: string; gameId: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Geteilt vom manuellen POST /tables/:id/start des Tisch-Admins und dem
 * automatischen Start, ausgeloest von POST /tables/:id/ready sobald jeder
 * sitzende Spieler bereit ist (siehe tables.ts). Beide brauchen dieselben
 * Voraussetzungen - Tisch noch offen, >=2 aktive Spieler (bei einem
 * Solo-Tisch, is_solo: genau 1), alle sitzenden bereit.
 */
export async function startTableGame(tableId: string): Promise<TableStartOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `SELECT id, name, state, is_solo FROM game_table WHERE id = $1 FOR UPDATE`,
      [tableId],
    );
    if (tableResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, code: 'TABLE_NOT_FOUND', message: 'table not found' };
    }
    const table = tableResult.rows[0];
    if (table.state !== 'open') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'TABLE_NOT_OPEN', message: 'table is not open' };
    }

    const seatsResult = await client.query(
      `SELECT user_id, ready FROM table_seat
       WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
      [tableId],
    );
    const activePlayerIds: string[] = seatsResult.rows.map((row) => row.user_id);
    const minPlayers = table.is_solo ? 1 : 2;
    if (activePlayerIds.length < minPlayers) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        code: 'NOT_ENOUGH_PLAYERS',
        message: `at least ${minPlayers} active player(s) are required to start`,
      };
    }
    if (seatsResult.rows.some((row) => !row.ready)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        code: 'NOT_ALL_PLAYERS_READY',
        message: 'not every seated player has marked themselves ready yet',
      };
    }

    // Der feste 50-Trailer-Batch wird einmalig hier bei Session-Start
    // gezogen (siehe trailerBatch.ts) - analog zu songsters Adolar-Batch,
    // aber komplett lokal (kein externer Lieferant).
    let trailerBatchIds: string[];
    try {
      trailerBatchIds = await loadTrailerBatch(client);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof RoundEngineError) {
        return { ok: false, status: 409, code: err.code, message: err.message };
      }
      throw err;
    }

    const sessionResult = await client.query(
      `INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    const tableSessionId = sessionResult.rows[0].id;

    for (const trailerRefId of trailerBatchIds) {
      await client.query(
        `INSERT INTO table_session_trailer_pool (table_session_id, trailer_ref_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [tableSessionId, trailerRefId],
      );
    }

    const range = await computeYearRange(client, tableSessionId);
    if (!range) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        code: 'TRAILER_METADATA_INVALID',
        message: 'no valid trailers in the library yet',
      };
    }

    const gameResult = await client.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, tableSessionId],
    );
    const gameId = gameResult.rows[0].id as string;
    // Auch Runde 1 bekommt dieselbe Vorlaufzeit: Schon waehrend Intro,
    // Kartenverteilung und erstem Bereitschaftsfenster liegt ihr Trailer als
    // Reservierung fest und kann vom Backend vorgeladen werden.
    const firstTrailer = await selectTrailerForGame(client, gameId, tableSessionId, table.is_solo);
    await client.query(`UPDATE game SET next_trailer_id = $1 WHERE id = $2`, [firstTrailer.id, gameId]);
    await generateStartBlocks(client, gameId, activePlayerIds, tableSessionId);
    await client.query(`UPDATE game_table SET state = 'running' WHERE id = $1`, [tableId]);

    // Eine Woche abrufbarer Snapshot der tatsaechlich gespielten Trailer.
    // IDs werden am Spielende im UI ausgegeben und helfen bei der
    // Fehleranalyse, auch nachdem Tisch und Spiel bereits geloescht sind.
    await client.query(
      `INSERT INTO game_trailer_playlist (table_id, table_name, game_id) VALUES ($1, $2, $3)`,
      [tableId, table.name, gameResult.rows[0].id],
    );

    await client.query('COMMIT');
    void warmTrailerFile(firstTrailer.id, gameId);
    return { ok: true, tableSessionId, gameId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
