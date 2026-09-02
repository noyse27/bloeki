import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export type ChatScope = 'lobby' | 'table';
export type ReactionPhase = 'waiting' | 'countdown' | 'playing' | 'guessing' | 'resolved' | 'finished';
export type ReactionKind = 'emoji' | 'sticker';

export interface ChatMessage {
  id: string;
  scope: ChatScope;
  tableId: string | null;
  senderUserId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
}

export interface ReactionAsset {
  id: string;
  symbol: string;
  defaultLabel: string;
  kind: ReactionKind;
}

export interface ConfiguredReaction extends ReactionAsset {
  label: string;
}

export type ReactionConfig = Record<ReactionPhase, ConfiguredReaction[]>;

export interface TextChatSettings {
  autoConvertEmoticons: boolean;
  blockedWords: string[];
}

export interface CommunicationSettings {
  textChat: TextChatSettings;
  reactions: ReactionConfig;
}

export interface CommunicationAdminSettings extends CommunicationSettings {
  catalog: ReactionAsset[];
  defaultReactions: ReactionConfig;
}

export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_RETENTION_MINUTES = 30;
export const CHAT_RATE_LIMIT_PER_MINUTE = 12;
export const REACTION_PHASES: ReactionPhase[] = ['waiting', 'countdown', 'playing', 'guessing', 'resolved', 'finished'];
export const MAX_REACTIONS_PER_PHASE = 8;
export const MAX_BLOCKED_WORDS = 100;
export const MAX_BLOCKED_WORD_LENGTH = 40;
export const MAX_REACTION_LABEL_LENGTH = 24;

// Curated and code-owned: admins can choose and label these assets, but
// cannot inject arbitrary markup, URLs or oversized media into clients.
// "dance" is the light-weight, reduced-motion-safe Elvis-style option.
export const REACTION_CATALOG: ReactionAsset[] = [
  { id: 'hello', symbol: '👋', defaultLabel: 'Hallo', kind: 'emoji' },
  { id: 'like', symbol: '👍', defaultLabel: 'Stark', kind: 'emoji' },
  { id: 'laugh', symbol: '😂', defaultLabel: 'Lustig', kind: 'emoji' },
  { id: 'think', symbol: '🤔', defaultLabel: 'Keine Ahnung', kind: 'emoji' },
  { id: 'target', symbol: '🎯', defaultLabel: 'Guter Tipp', kind: 'emoji' },
  { id: 'technical', symbol: '⚠️', defaultLabel: 'Technikproblem', kind: 'emoji' },
  { id: 'dance', symbol: '🕺', defaultLabel: 'Elvis tanzt', kind: 'sticker' },
  { id: 'fire', symbol: '🔥', defaultLabel: 'Das brennt!', kind: 'emoji' },
  { id: 'clap', symbol: '👏', defaultLabel: 'Applaus', kind: 'emoji' },
  { id: 'heart', symbol: '❤️', defaultLabel: 'Liebe ich', kind: 'emoji' },
  { id: 'music', symbol: '🎵', defaultLabel: 'Mein Song!', kind: 'emoji' },
  { id: 'party', symbol: '🥳', defaultLabel: 'Party!', kind: 'emoji' },
  { id: 'mindblown', symbol: '🤯', defaultLabel: 'Unglaublich', kind: 'emoji' },
  { id: 'eyes', symbol: '👀', defaultLabel: 'Ich seh dich', kind: 'emoji' },
  { id: 'cry', symbol: '😭', defaultLabel: 'Oh nein', kind: 'emoji' },
  { id: 'cool', symbol: '😎', defaultLabel: 'Cool', kind: 'emoji' },
  { id: 'rocket', symbol: '🚀', defaultLabel: 'Ab geht’s', kind: 'emoji' },
  { id: 'crown', symbol: '👑', defaultLabel: 'Königlich', kind: 'emoji' },
  { id: 'rock', symbol: '🤘', defaultLabel: 'Rock on!', kind: 'emoji' },
  { id: 'star', symbol: '⭐', defaultLabel: 'Volltreffer', kind: 'emoji' },
];

const assetById = new Map(REACTION_CATALOG.map((asset) => [asset.id, asset]));
const DEFAULT_REACTION_IDS: Record<ReactionPhase, string[]> = {
  waiting: ['hello', 'like', 'laugh', 'target', 'technical'],
  countdown: ['like', 'think', 'technical'],
  playing: ['like', 'think', 'technical'],
  guessing: ['like', 'think', 'technical'],
  resolved: ['like', 'laugh', 'target', 'technical'],
  finished: ['like', 'laugh', 'target', 'technical'],
};
const TEXT_AUTO_CONVERT_KEY = 'communication.chat.auto_convert_emoticons';
const TEXT_BLOCKED_WORDS_KEY = 'communication.chat.blocked_words';

function emptyReactionConfig(): ReactionConfig {
  return { waiting: [], countdown: [], playing: [], guessing: [], resolved: [], finished: [] };
}

export function defaultReactionConfig(): ReactionConfig {
  const config = emptyReactionConfig();
  for (const phase of REACTION_PHASES) {
    config[phase] = DEFAULT_REACTION_IDS[phase].map((id) => {
      const asset = assetById.get(id) as ReactionAsset;
      return { ...asset, label: asset.defaultLabel };
    });
  }
  return config;
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    scope: row.scope as ChatScope,
    tableId: (row.table_id as string | null) ?? null,
    senderUserId: row.sender_user_id as string,
    senderUsername: row.sender_username as string,
    body: row.body as string,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export function normalizeChatBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length === 0 || body.length > CHAT_MAX_LENGTH) return null;
  return body;
}

export function normalizeBlockedWords(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_BLOCKED_WORDS) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const word = item.trim().replace(/\s+/g, ' ');
    if (!word || word.length > MAX_BLOCKED_WORD_LENGTH) return null;
    const key = word.toLocaleLowerCase('de-DE');
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(word);
    }
  }
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyWordFilter(body: string, blockedWords: string[]): string {
  let filtered = body;
  for (const word of [...blockedWords].sort((a, b) => b.length - a.length)) {
    const escaped = escapeRegExp(word).replace(/\s+/g, '\\s+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
    filtered = filtered.replace(pattern, '*piep*');
  }
  return filtered;
}

const EMOTICON_MAP: Record<string, string> = {
  ':-D': '😄', ':D': '😄', ':-)': '🙂', ':)': '🙂', ';-)': '😉', ';)': '😉', ':-(': '🙁', ':(': '🙁', '<3': '❤️',
};

export function convertEmoticons(body: string): string {
  return body.replace(/(^|\s)(:-D|:D|:-\)|:\)|;-\)|;\)|:-\(|:\(|<3)(?=$|\s|[.,!?])/g, (_match, prefix, emoticon) => {
    return `${prefix}${EMOTICON_MAP[emoticon] ?? emoticon}`;
  });
}

export async function loadTextChatSettings(): Promise<TextChatSettings> {
  const result = await pool.query(`SELECT key, value FROM system_setting WHERE key = ANY($1::text[])`, [
    [TEXT_AUTO_CONVERT_KEY, TEXT_BLOCKED_WORDS_KEY],
  ]);
  const values = new Map<string, string>(result.rows.map((row) => [row.key, row.value]));
  let blockedWords: string[];
  try {
    blockedWords = normalizeBlockedWords(JSON.parse(values.get(TEXT_BLOCKED_WORDS_KEY) ?? '[]')) ?? [];
  } catch {
    blockedWords = [];
  }
  return { autoConvertEmoticons: values.get(TEXT_AUTO_CONVERT_KEY) === 'true', blockedWords };
}

export async function prepareChatBody(body: string): Promise<string> {
  const settings = await loadTextChatSettings();
  const filtered = applyWordFilter(body, settings.blockedWords);
  return settings.autoConvertEmoticons ? convertEmoticons(filtered) : filtered;
}

export async function listChatMessages(scope: ChatScope, tableId: string | null): Promise<ChatMessage[]> {
  const result = await pool.query(
    `SELECT * FROM (
       SELECT m.id, m.scope, m.table_id, m.sender_user_id, u.username AS sender_username, m.body, m.created_at
       FROM chat_message m JOIN app_user u ON u.id = m.sender_user_id
       WHERE m.scope = $1 AND m.table_id IS NOT DISTINCT FROM $2::uuid AND m.deleted_at IS NULL
         AND m.created_at >= NOW() - ($3 * INTERVAL '1 minute')
       ORDER BY m.created_at DESC LIMIT $4
     ) recent ORDER BY created_at ASC`,
    [scope, tableId, CHAT_RETENTION_MINUTES, CHAT_HISTORY_LIMIT],
  );
  return result.rows.map(mapMessage);
}

export async function createChatMessage(
  scope: ChatScope,
  tableId: string | null,
  senderUserId: string,
  body: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; retryAfterSeconds: number }> {
  const recentResult = await pool.query(
    `SELECT COUNT(*)::int AS count,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MIN(created_at) + INTERVAL '1 minute' - NOW()))))::int AS retry_after_seconds
     FROM chat_message WHERE sender_user_id = $1 AND created_at >= NOW() - INTERVAL '1 minute'`,
    [senderUserId],
  );
  if (recentResult.rows[0].count >= CHAT_RATE_LIMIT_PER_MINUTE) {
    return { ok: false, retryAfterSeconds: recentResult.rows[0].retry_after_seconds ?? 60 };
  }

  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO chat_message (scope, table_id, sender_user_id, body) VALUES ($1, $2, $3, $4) RETURNING *
     )
     SELECT i.id, i.scope, i.table_id, i.sender_user_id, u.username AS sender_username, i.body, i.created_at
     FROM inserted i JOIN app_user u ON u.id = i.sender_user_id`,
    [scope, tableId, senderUserId, body],
  );
  return { ok: true, message: mapMessage(result.rows[0]) };
}

export async function deleteExpiredChatMessages(): Promise<number> {
  const result = await pool.query(`DELETE FROM chat_message WHERE created_at < NOW() - ($1 * INTERVAL '1 minute')`, [
    CHAT_RETENTION_MINUTES,
  ]);
  return result.rowCount ?? 0;
}

export function isReactionAssetId(value: unknown): value is string {
  return typeof value === 'string' && assetById.has(value);
}

export async function loadReactionConfig(client: Pick<PoolClient, 'query'> = pool): Promise<ReactionConfig> {
  const result = await client.query(`SELECT phase, asset_id, label FROM playboard_reaction ORDER BY phase, sort_order`);
  const config = emptyReactionConfig();
  for (const row of result.rows) {
    const asset = assetById.get(row.asset_id);
    if (asset && REACTION_PHASES.includes(row.phase)) config[row.phase as ReactionPhase].push({ ...asset, label: row.label });
  }
  return config;
}

export async function loadConfiguredReaction(phase: ReactionPhase, assetId: string): Promise<ConfiguredReaction | null> {
  const asset = assetById.get(assetId);
  if (!asset) return null;
  const result = await pool.query(`SELECT label FROM playboard_reaction WHERE phase = $1 AND asset_id = $2`, [phase, assetId]);
  return result.rows[0] ? { ...asset, label: result.rows[0].label } : null;
}

export async function loadCommunicationSettings(): Promise<CommunicationAdminSettings> {
  const [textChat, reactions] = await Promise.all([loadTextChatSettings(), loadReactionConfig()]);
  return { textChat, reactions, catalog: REACTION_CATALOG, defaultReactions: defaultReactionConfig() };
}

export function validateReactionConfig(value: unknown): ReactionConfig | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const config = emptyReactionConfig();
  for (const phase of REACTION_PHASES) {
    const items = input[phase];
    if (!Array.isArray(items) || items.length > MAX_REACTIONS_PER_PHASE) return null;
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== 'object') return null;
      const { id, label } = item as { id?: unknown; label?: unknown };
      if (!isReactionAssetId(id) || typeof label !== 'string') return null;
      const normalizedLabel = label.trim();
      if (!normalizedLabel || normalizedLabel.length > MAX_REACTION_LABEL_LENGTH || seen.has(id)) return null;
      seen.add(id);
      config[phase].push({ ...(assetById.get(id) as ReactionAsset), label: normalizedLabel });
    }
  }
  return config;
}

export async function saveCommunicationSettings(settings: CommunicationSettings): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertSetting(client, TEXT_AUTO_CONVERT_KEY, String(settings.textChat.autoConvertEmoticons));
    await upsertSetting(client, TEXT_BLOCKED_WORDS_KEY, JSON.stringify(settings.textChat.blockedWords));
    await client.query('DELETE FROM playboard_reaction');
    for (const phase of REACTION_PHASES) {
      for (const [sortOrder, reaction] of settings.reactions[phase].entries()) {
        await client.query(`INSERT INTO playboard_reaction (phase, asset_id, label, sort_order) VALUES ($1, $2, $3, $4)`, [
          phase,
          reaction.id,
          reaction.label,
          sortOrder,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function upsertSetting(client: PoolClient, key: string, value: string): Promise<void> {
  await client.query(
    `INSERT INTO system_setting (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

export async function loadReactionPhase(gameId: string): Promise<ReactionPhase | null> {
  const result = await pool.query(
    `SELECT g.status AS game_status,
            (SELECT r.status FROM round r WHERE r.game_id = g.id ORDER BY r.index_no DESC LIMIT 1) AS round_status
     FROM game g WHERE g.id = $1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.game_status === 'finished') return 'finished';
  if (row.round_status === 'countdown') return 'countdown';
  if (row.round_status === 'playing') return 'playing';
  if (row.round_status === 'guessing') return 'guessing';
  if (row.round_status === 'resolved') return 'resolved';
  return 'waiting';
}
