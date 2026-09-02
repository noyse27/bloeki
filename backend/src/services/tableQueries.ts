import { pool } from '../db/pool';

export interface LobbyTableRow {
  tableId: string;
  name: string;
  visibility: string;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  state: string;
  activePlayers: number;
  activeSpectators: number;
  createdAt: string;
}

export async function fetchLobbyTables(): Promise<LobbyTableRow[]> {
  const result = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.allow_spectators, t.max_players, t.max_spectators, t.state,
        t.created_at,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators
     FROM game_table t
     LEFT JOIN table_seat s ON s.table_id = t.id
     WHERE t.visibility = 'public' AND t.state = 'open'
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
  );

  return result.rows.map((row) => ({
    tableId: row.id,
    name: row.name,
    visibility: row.visibility,
    allowSpectators: row.allow_spectators,
    maxPlayers: row.max_players,
    maxSpectators: row.max_spectators,
    state: row.state,
    activePlayers: Number(row.active_players),
    activeSpectators: Number(row.active_spectators),
    createdAt: row.created_at,
  }));
}

// H-01: minimal detail a not-yet-joined but logged-in user may see, so the
// lobby/join-link flow still works once GET /tables/:tableId itself starts
// requiring an active seat below. Deliberately excludes joinCode, seats,
// ownerUserId and latestGameId - nothing here helps anyone who hasn't
// joined yet, and all of it is worth protecting once membership is required.
export interface TablePreview {
  tableId: string;
  name: string;
  visibility: string;
  state: string;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  activePlayers: number;
  activeSpectators: number;
  minKarmaPoints: number | null;
  minScorePoints: number | null;
  minGamesPlayed: number | null;
}

export async function loadTablePreview(tableId: string): Promise<TablePreview | null> {
  const result = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.allow_spectators, t.max_players, t.max_spectators, t.state,
        t.min_karma_points, t.min_score_points, t.min_games_played,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators
     FROM game_table t
     LEFT JOIN table_seat s ON s.table_id = t.id
     WHERE t.id = $1
     GROUP BY t.id`,
    [tableId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    tableId: row.id,
    name: row.name,
    visibility: row.visibility,
    state: row.state,
    allowSpectators: row.allow_spectators,
    maxPlayers: row.max_players,
    maxSpectators: row.max_spectators,
    activePlayers: Number(row.active_players),
    activeSpectators: Number(row.active_spectators),
    minKarmaPoints: row.min_karma_points,
    minScorePoints: row.min_score_points,
    minGamesPlayed: row.min_games_played,
  };
}

export interface TableDetail {
  tableId: string;
  name: string;
  visibility: string;
  joinCode: string | null;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  state: string;
  ownerUserId: string;
  ownerReconnectDeadlinePending: boolean;
  activePlayers: number;
  activeSpectators: number;
  minKarmaPoints: number | null;
  minScorePoints: number | null;
  minGamesPlayed: number | null;
  lastActivityAt: string;
  seats: { userId: string; username: string; seatType: string; ready: boolean }[];
  latestGameId: string | null;
}

export async function loadTableDetail(tableId: string): Promise<TableDetail | null> {
  const tableResult = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.join_code, t.allow_spectators,
        t.max_players, t.max_spectators, t.state, t.owner_user_id, t.owner_left_at,
        t.min_karma_points, t.min_score_points, t.min_games_played, t.last_activity_at,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators
     FROM game_table t
     LEFT JOIN table_seat s ON s.table_id = t.id
     WHERE t.id = $1
     GROUP BY t.id`,
    [tableId],
  );
  const table = tableResult.rows[0];
  if (!table) return null;

  const seatsResult = await pool.query(
    `SELECT s.user_id, u.username, s.seat_type, s.ready
     FROM table_seat s
     JOIN app_user u ON u.id = s.user_id
     WHERE s.table_id = $1 AND s.left_at IS NULL
     ORDER BY s.joined_at ASC`,
    [tableId],
  );

  const latestGameResult = await pool.query(
    `SELECT id FROM game WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tableId],
  );

  return {
    tableId: table.id,
    name: table.name,
    visibility: table.visibility,
    joinCode: table.join_code,
    allowSpectators: table.allow_spectators,
    maxPlayers: table.max_players,
    maxSpectators: table.max_spectators,
    state: table.state,
    ownerUserId: table.owner_user_id,
    ownerReconnectDeadlinePending: Boolean(table.owner_left_at),
    activePlayers: Number(table.active_players),
    activeSpectators: Number(table.active_spectators),
    minKarmaPoints: table.min_karma_points,
    minScorePoints: table.min_score_points,
    minGamesPlayed: table.min_games_played,
    lastActivityAt: table.last_activity_at,
    seats: seatsResult.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      seatType: row.seat_type,
      ready: row.ready,
    })),
    latestGameId: latestGameResult.rows[0]?.id ?? null,
  };
}
