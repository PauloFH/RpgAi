import { useCallback, useState } from 'react';
import { errorText } from '../i18n/pt-BR';

const codeOf = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'internal';
};

/** Runs an action and keeps its failure as text for the place on screen where it happened. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(errorText(codeOf(err)));
      return false;
    }
  }, []);
  return { error, run };
}
