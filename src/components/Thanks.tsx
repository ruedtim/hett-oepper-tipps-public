interface Props {
  repeated: boolean;
  onBack: () => void;
}

export default function Thanks({ repeated, onBack }: Props) {
  return (
    <div className="thanks">
      <p className="thanks__mark" aria-hidden="true">
        ✓
      </p>
      <h1>Danke!</h1>
      <p>
        {repeated
          ? 'War schon gespeichert — es ist also nicht doppelt angekommen.'
          : 'Gespeichert — ist ab sofort für alle sichtbar.'}
      </p>
      <button type="button" className="button" onClick={onBack}>
        Zurück zu den Tipps
      </button>
    </div>
  );
}
