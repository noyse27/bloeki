import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { getSocket } from '../realtime/socket';

export interface ChatMessage {
  id: string;
  scope: 'lobby' | 'table';
  tableId: string | null;
  senderUserId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
}

interface ChatPanelProps {
  title: string;
  scope: 'lobby' | 'table';
  tableId?: string;
  endpoint: string;
  hint: string;
}

const MAX_LENGTH = 500;

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-50);
}

export function ChatPanel({ title, scope, tableId, endpoint, hint }: ChatPanelProps) {
  const { auth } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matchesPanel = useMemo(
    () => (message: ChatMessage) => message.scope === scope && (scope === 'lobby' || message.tableId === tableId),
    [scope, tableId],
  );

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    setMessages([]);
    apiFetch<{ messages: ChatMessage[] }>(endpoint, { token: auth.accessToken })
      .then((result) => {
        if (!cancelled) setMessages((current) => mergeMessages(current, result.messages.filter(matchesPanel)));
      })
      .catch(() => {
        if (!cancelled) setError('Chatverlauf konnte nicht geladen werden.');
      });

    const socket = getSocket(auth.accessToken);
    const onMessage = (message: ChatMessage) => {
      if (matchesPanel(message)) setMessages((current) => mergeMessages(current, [message]));
    };
    socket.on('chat:message', onMessage);
    return () => {
      cancelled = true;
      socket.off('chat:message', onMessage);
    };
  }, [auth, endpoint, matchesPanel]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!auth || !body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await apiFetch<{ message: ChatMessage }>(endpoint, {
        method: 'POST',
        body: { body },
        token: auth.accessToken,
      });
      setMessages((current) => mergeMessages(current, [result.message]));
      setBody('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Zu viele Nachrichten. Bitte warte kurz.');
      } else {
        setError('Nachricht konnte nicht gesendet werden.');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat-panel" aria-label={title}>
      <div className="chat-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{hint} Nachrichten verschwinden nach 30 Minuten.</p>
        </div>
        <span className="chat-live-badge"><span /> Live</span>
      </div>

      <div className="chat-message-list" ref={listRef} aria-live="polite" aria-relevant="additions">
        {messages.map((message) => {
          const own = message.senderUserId === auth?.user.id;
          return (
            <div className={`chat-message${own ? ' chat-message-own' : ''}`} key={message.id}>
              <div className="chat-message-meta">
                <b>{own ? 'Du' : message.senderUsername}</b>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              <div className="chat-message-body">{message.body}</div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="chat-empty">Noch keine Nachrichten. Sag Hallo!</p>}
      </div>

      {error && <div className="chat-error" role="alert">{error}</div>}
      <form className="chat-composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`chat-input-${scope}`}>Nachricht schreiben</label>
        <textarea
          id={`chat-input-${scope}`}
          value={body}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder="Nachricht schreiben…"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={sending || !body.trim()} aria-label="Nachricht senden">
          {sending ? '…' : 'Senden'}
        </button>
      </form>
      <div className="chat-character-count">{body.length}/{MAX_LENGTH}</div>
    </section>
  );
}
