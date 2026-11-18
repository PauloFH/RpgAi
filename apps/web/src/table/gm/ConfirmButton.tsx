import { useState } from 'react';
import { t } from '../../i18n/pt-BR';

interface ConfirmButtonProps {
  label: string;
  prompt: string;
  disabled?: boolean;
  onConfirm(): void;
}

/** A destructive button that asks for confirmation inside the page. */
export function ConfirmButton({ label, prompt, disabled, onConfirm }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label={prompt}>
      <span>{prompt}</span>
      <button
        type="button"
        className="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t.gm.yes}
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        {t.gm.no}
      </button>
    </span>
  );
}
