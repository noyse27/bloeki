import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import {
  ConfiguredReaction,
  ReactionAsset,
  ReactionConfig,
  REACTION_PHASES,
  ReactionPhase,
} from '../game/reactions';

interface CommunicationAdminSettings {
  textChat: { autoConvertEmoticons: boolean; blockedWords: string[] };
  reactions: ReactionConfig;
  catalog: ReactionAsset[];
  defaultReactions: ReactionConfig;
}

const PHASE_LABELS: Record<ReactionPhase, string> = {
  waiting: 'Bereit / zwischen Runden',
  countdown: 'Countdown',
  playing: 'Trailer läuft',
  guessing: 'Zeitleiste einordnen',
  resolved: 'Auflösung',
  finished: 'Spiel beendet',
};

const EMOTICONS: Record<string, string> = {
  ':-D': '😄', ':D': '😄', ':-)': '🙂', ':)': '🙂', ';-)': '😉', ';)': '😉', ':-(': '🙁', ':(': '🙁', '<3': '❤️',
};

function previewEmoticons(value: string): string {
  return value.replace(/(^|\s)(:-D|:D|:-\)|:\)|;-\)|;\)|:-\(|:\(|<3)(?=$|\s|[.,!?])/g, (_match, prefix, emoticon) => {
    return `${prefix}${EMOTICONS[emoticon] ?? emoticon}`;
  });
}

function cloneConfig(config: ReactionConfig): ReactionConfig {
  return Object.fromEntries(REACTION_PHASES.map((phase) => [phase, config[phase].map((reaction) => ({ ...reaction }))])) as ReactionConfig;
}

export function CommunicationSettingsSection({ token }: { token: string }) {
  const [settings, setSettings] = useState<CommunicationAdminSettings | null>(null);
  const [tab, setTab] = useState<'chat' | 'reactions'>('chat');
  const [phase, setPhase] = useState<ReactionPhase>('waiting');
  const [blockedInput, setBlockedInput] = useState('');
  const [preview, setPreview] = useState('Hallo :) Das ist richtig stark :D');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [reactionLabel, setReactionLabel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<CommunicationAdminSettings>('/admin/communication-settings', { token })
      .then((loaded) => setSettings({ ...loaded, reactions: cloneConfig(loaded.reactions) }))
      .catch(() => setMessage({ kind: 'error', text: 'Chateinstellungen konnten nicht geladen werden.' }));
  }, [token]);

  const current = settings?.reactions[phase] ?? [];
  const selectedAsset = settings?.catalog.find((asset) => asset.id === selectedAssetId) ?? null;
  const availableCatalog = useMemo(() => settings?.catalog ?? [], [settings]);

  function updateSettings(updater: (currentSettings: CommunicationAdminSettings) => CommunicationAdminSettings) {
    setSettings((currentSettings) => currentSettings ? updater(currentSettings) : currentSettings);
    setDirty(true);
    setMessage(null);
  }

  function addBlockedWords() {
    const candidates = blockedInput.split(',').map((word) => word.trim()).filter(Boolean);
    if (!candidates.length) return;
    if (candidates.some((word) => word.length > 40)) {
      setMessage({ kind: 'error', text: 'Ein Filtereintrag darf höchstens 40 Zeichen lang sein.' });
      return;
    }
    updateSettings((currentSettings) => {
      const seen = new Set(currentSettings.textChat.blockedWords.map((word) => word.toLocaleLowerCase('de-DE')));
      const added = candidates.filter((word) => {
        const key = word.toLocaleLowerCase('de-DE');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return {
        ...currentSettings,
        textChat: { ...currentSettings.textChat, blockedWords: [...currentSettings.textChat.blockedWords, ...added].slice(0, 100) },
      };
    });
    setBlockedInput('');
  }

  function removeBlockedWord(word: string) {
    updateSettings((currentSettings) => ({
      ...currentSettings,
      textChat: { ...currentSettings.textChat, blockedWords: currentSettings.textChat.blockedWords.filter((item) => item !== word) },
    }));
  }

  function chooseAsset(asset: ReactionAsset) {
    if (current.some((reaction) => reaction.id === asset.id) || current.length >= 8) return;
    setSelectedAssetId(asset.id);
    setReactionLabel(asset.defaultLabel);
  }

  function addReaction() {
    if (!selectedAsset || !reactionLabel.trim() || current.length >= 8) return;
    updateSettings((currentSettings) => ({
      ...currentSettings,
      reactions: {
        ...currentSettings.reactions,
        [phase]: [...currentSettings.reactions[phase], { ...selectedAsset, label: reactionLabel.trim().slice(0, 24) }],
      },
    }));
    setSelectedAssetId(null);
    setReactionLabel('');
  }

  function removeReaction(assetId: string) {
    updateSettings((currentSettings) => ({
      ...currentSettings,
      reactions: {
        ...currentSettings.reactions,
        [phase]: currentSettings.reactions[phase].filter((reaction) => reaction.id !== assetId),
      },
    }));
  }

  function moveReaction(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    updateSettings((currentSettings) => {
      const reordered = [...currentSettings.reactions[phase]];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return { ...currentSettings, reactions: { ...currentSettings.reactions, [phase]: reordered } };
    });
  }

  function restorePhaseDefaults() {
    updateSettings((currentSettings) => ({
      ...currentSettings,
      reactions: { ...currentSettings.reactions, [phase]: currentSettings.defaultReactions[phase].map((reaction) => ({ ...reaction })) },
    }));
    setSelectedAssetId(null);
  }

  async function save() {
    if (!settings || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<Pick<CommunicationAdminSettings, 'textChat' | 'reactions'>>('/admin/communication-settings', {
        method: 'PUT',
        token,
        body: { textChat: settings.textChat, reactions: settings.reactions },
      });
      setSettings((currentSettings) => currentSettings ? { ...currentSettings, ...updated, reactions: cloneConfig(updated.reactions) } : currentSettings);
      setDirty(false);
      setMessage({ kind: 'ok', text: 'Chateinstellungen gespeichert und live verteilt.' });
    } catch {
      setMessage({ kind: 'error', text: 'Chateinstellungen konnten nicht gespeichert werden.' });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return message ? <div className="sh-error">{message.text}</div> : <p className="admin-muted">Lade Einstellungen…</p>;

  return (
    <div className="comm-admin">
      <div className="comm-admin-tabs" role="tablist" aria-label="Chateinstellungen">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')} role="tab" aria-selected={tab === 'chat'}>Textchat</button>
        <button className={tab === 'reactions' ? 'active' : ''} onClick={() => setTab('reactions')} role="tab" aria-selected={tab === 'reactions'}>Playboard-Reaktionen</button>
      </div>

      {tab === 'chat' ? (
        <div className="comm-admin-pane">
          <label className="comm-switch">
            <input
              type="checkbox"
              checked={settings.textChat.autoConvertEmoticons}
              onChange={(event) => updateSettings((currentSettings) => ({
                ...currentSettings,
                textChat: { ...currentSettings.textChat, autoConvertEmoticons: event.target.checked },
              }))}
            />
            <span>Text-Smileys automatisch in Emojis umwandeln</span>
          </label>
          <p className="admin-muted">Unterstützt unter anderem :) :D ;) :( und &lt;3. Die Umwandlung erfolgt serverseitig.</p>

          <div className="comm-preview">
            <label htmlFor="comm-preview-input">Live-Vorschau</label>
            <input id="comm-preview-input" value={preview} onChange={(event) => setPreview(event.target.value)} />
            <div>{settings.textChat.autoConvertEmoticons ? previewEmoticons(preview) : preview}</div>
          </div>

          <label className="comm-field-label" htmlFor="blocked-words">Wortfilter</label>
          <p className="admin-muted">Kommagetrennt eingeben. Vollständige Wörter werden unabhängig von Groß-/Kleinschreibung durch *piep* ersetzt.</p>
          <div className="comm-word-entry">
            <input
              id="blocked-words"
              value={blockedInput}
              maxLength={500}
              placeholder="Wort eins, Wort zwei"
              onChange={(event) => setBlockedInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); addBlockedWords(); }
              }}
            />
            <button className="admin-btn-sm" type="button" onClick={addBlockedWords}>Hinzufügen</button>
          </div>
          <div className="comm-word-chips">
            {settings.textChat.blockedWords.map((word) => (
              <span key={word}>{word}<button type="button" onClick={() => removeBlockedWord(word)} aria-label={`${word} entfernen`}>×</button></span>
            ))}
            {!settings.textChat.blockedWords.length && <em>Noch keine gesperrten Wörter.</em>}
          </div>
        </div>
      ) : (
        <div className="comm-admin-pane">
          <div className="comm-phase-head">
            <label htmlFor="reaction-phase">Spielzustand</label>
            <select id="reaction-phase" value={phase} onChange={(event) => { setPhase(event.target.value as ReactionPhase); setSelectedAssetId(null); }}>
              {REACTION_PHASES.map((item) => <option key={item} value={item}>{PHASE_LABELS[item]}</option>)}
            </select>
            <b>{current.length}/8</b>
          </div>

          <div className="comm-current-reactions">
            {current.map((reaction, index) => (
              <ReactionCard
                key={reaction.id}
                reaction={reaction}
                index={index}
                total={current.length}
                onRemove={() => removeReaction(reaction.id)}
                onMove={moveReaction}
              />
            ))}
            {!current.length && <p className="admin-muted">In diesem Zustand sind keine Reaktionen verfügbar.</p>}
          </div>

          <div className="comm-reaction-tools">
            <h4>Reaktion hinzufügen</h4>
            <p className="admin-muted">Einmal anklicken oder auf dem Desktop doppelklicken. Jedes Motiv ist pro Zustand nur einmal erlaubt.</p>
            <div className="comm-catalog">
              {availableCatalog.map((asset) => {
                const used = current.some((reaction) => reaction.id === asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={used || current.length >= 8}
                    className={selectedAssetId === asset.id ? 'selected' : ''}
                    onClick={() => chooseAsset(asset)}
                    onDoubleClick={() => chooseAsset(asset)}
                    title={used ? 'In diesem Zustand bereits vorhanden' : asset.defaultLabel}
                  >
                    <span>{asset.symbol}</span><small>{asset.defaultLabel}</small>{asset.kind === 'sticker' && <i>Sticker</i>}
                  </button>
                );
              })}
            </div>
            {selectedAsset && (
              <div className="comm-reaction-editor">
                <span>{selectedAsset.symbol}</span>
                <input
                  autoFocus
                  maxLength={24}
                  value={reactionLabel}
                  aria-label="Reaktionstext"
                  onChange={(event) => setReactionLabel(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') addReaction(); }}
                />
                <button className="admin-btn-sm" type="button" onClick={addReaction} disabled={!reactionLabel.trim()}>OK</button>
                <button className="admin-btn-sm" type="button" onClick={() => setSelectedAssetId(null)}>Abbrechen</button>
              </div>
            )}
          </div>
          <button className="admin-btn-sm" type="button" onClick={restorePhaseDefaults}>Standard für diesen Zustand wiederherstellen</button>
        </div>
      )}

      {message && <div className={message.kind === 'ok' ? 'sh-info' : 'sh-error'}>{message.text}</div>}
      <div className="comm-save-row">
        <span>{dirty ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert'}</span>
        <button className="sh-submit" type="button" disabled={!dirty || saving} onClick={save}>{saving ? 'Speichert…' : 'Einstellungen speichern'}</button>
      </div>
    </div>
  );
}

function ReactionCard({
  reaction,
  index,
  total,
  onRemove,
  onMove,
}: {
  reaction: ConfiguredReaction;
  index: number;
  total: number;
  onRemove: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <div className="comm-reaction-card">
      <button className="comm-reaction-remove" type="button" onClick={onRemove} aria-label={`${reaction.label} entfernen`}>×</button>
      <span className="comm-reaction-symbol">{reaction.symbol}</span>
      <b>{reaction.label}</b>
      <small>{reaction.kind === 'sticker' ? 'Sticker' : 'Emoji'}</small>
      <div className="comm-reaction-order">
        <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Nach vorne">↑</button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove(index, 1)} aria-label="Nach hinten">↓</button>
      </div>
    </div>
  );
}
