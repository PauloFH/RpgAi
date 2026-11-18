import type { RollResult, TermResult } from '@rpgai/shared';

/** Marks which rolls were dropped, consuming `kept` so that repeated values count right. */
function markDropped({ rolls, kept }: TermResult): { value: number; dropped: boolean }[] {
  const left = [...kept];
  return rolls.map((value) => {
    const i = left.indexOf(value);
    if (i === -1) return { value, dropped: true };
    left.splice(i, 1);
    return { value, dropped: false };
  });
}

function signText(sign: 1 | -1, first: boolean): string {
  if (sign < 0) return first ? '− ' : ' − ';
  return first ? '' : ' + ';
}

function TermView({ result, first }: { result: TermResult; first: boolean }) {
  const { term } = result;
  return (
    <span>
      {signText(term.sign, first)}
      {term.kind === 'const' ? (
        <span className="die const">{term.value}</span>
      ) : (
        markDropped(result).map(({ value, dropped }, i) => (
          <span key={i}>
            {i > 0 && ' '}
            {dropped ? <s className="die">{value}</s> : <span className="die">{value}</span>}
          </span>
        ))
      )}
    </span>
  );
}

export function RollView({ roll }: { roll: RollResult }) {
  return (
    <span className="roll">
      <code className="roll-source">{roll.source}</code>
      <span className="roll-terms">
        {roll.terms.map((result, i) => (
          <TermView key={i} result={result} first={i === 0} />
        ))}
      </span>
      <span className="roll-eq">=</span>
      <strong className="roll-total">{roll.total}</strong>
    </span>
  );
}
