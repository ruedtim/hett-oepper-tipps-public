import type { Category } from '../lib/types';

interface Props {
  category: Category;
  /** Anzahl Treffer unter den übrigen Filtern. `undefined` = nicht anzeigen. */
  count?: number;
  active?: boolean;
  onClick?: () => void;
  /** Nur darstellen, nicht bedienbar (z. B. auf einer Tipp-Karte). */
  readOnly?: boolean;
}

export default function CategoryChip({ category, count, active = false, onClick, readOnly = false }: Props) {
  const style = { '--chip-color': category.color } as React.CSSProperties;

  if (readOnly) {
    return (
      <span className="chip chip--readonly" style={style}>
        <span aria-hidden="true">{category.emoji}</span> {category.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="chip"
      style={style}
      aria-pressed={active}
      disabled={count === 0 && !active}
      onClick={onClick}
    >
      <span aria-hidden="true">{category.emoji}</span> {category.label}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  );
}
