import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, ClientState } from '@rpgai/shared';
import { t } from '../i18n/pt-BR';
import { RollView } from './RollView';
import type { TableConnection } from './socket';
import { useAction } from './useAction';

const STICK_DISTANCE_PX = 40;

const nameOf = (state: ClientState, userId: string): string =>
  state.members.find((m) => m.userId === userId)?.displayName ?? t.chat.unknownAuthor;

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function MessageView({ message, state }: { message: ChatMessage; state: ClientState }) {
  const { kind, secret, recipients, undone, label, text, rolls } = message;
  const restricted = kind === 'whisper' || secret;
  const classes = ['message', restricted && 'restricted', undone && 'undone'].filter(Boolean).join(' ');
  return (
    <li className={classes}>
      <div className="message-head">
        <strong>{nameOf(state, message.authorId)}</strong>
        <time className="dim" dateTime={message.createdAt}>
          {timeOf(message.createdAt)}
        </time>
        {undone && <span className="badge undone-badge">{t.chat.undone}</span>}
      </div>
      {restricted && (
        <div className="message-audience">
          {kind === 'whisper' ? t.chat.whisper : t.chat.secretRoll}
          {recipients && ` · ${t.chat.visibleTo}: ${recipients.map((id) => nameOf(state, id)).join(', ')}`}
        </div>
      )}
      <div className="message-body">
        {kind === 'roll' ? label && <div>{label}</div> : <div className="message-text">{text}</div>}
        {rolls.map((roll, i) => (
          <RollView key={i} roll={roll} />
        ))}
      </div>
    </li>
  );
}

export function ChatPanel({ state, conn }: { state: ClientState; conn: TableConnection }) {
  const [text, setText] = useState('');
  const { error, run } = useAction();
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  // A ref, not state: a second Enter can arrive before React renders the first one.
  const sending = useRef(false);

  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [state.chat.length]);

  const onScroll = () => {
    const list = listRef.current;
    if (list) stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_DISTANCE_PX;
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const value = text;
    if (value.trim() === '' || sending.current) return;
    sending.current = true;
    const sent = await run(() => conn.send({ type: 'chat.send', text: value }));
    sending.current = false;
    if (sent) setText((current) => (current === value ? '' : current));
  };

  return (
    <aside className="chat" aria-label={t.chat.title}>
      <ol className="chat-list" ref={listRef} onScroll={onScroll}>
        {state.chat.length === 0 && <li className="dim">{t.chat.empty}</li>}
        {state.chat.map((message) => (
          <MessageView key={message.id} message={message} state={state} />
        ))}
      </ol>
      <form className="chat-form" onSubmit={send}>
        <div className="row">
          <input
            aria-label={t.chat.message}
            placeholder={t.chat.placeholder}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit">{t.chat.send}</button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
