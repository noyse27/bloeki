interface ExitModalProps {
  open: boolean;
  karmaPenalty: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ExitModal({ open, karmaPenalty, onCancel, onConfirm }: ExitModalProps) {
  return (
    <div className={`pb-modal-overlay${open ? ' pb-open' : ''}`} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pb-modal">
        <h3>Tisch wirklich verlassen?</h3>
        <p>
          Das Spiel läuft noch. Verlässt du jetzt, bekommst du <b>{karmaPenalty}</b> Karma-Punkte. Eine niedrige
          Karma-Punktzahl kann es später schwerer machen, offene Tische oder Mitspieler zu finden.
        </p>
        <div className="pb-modal-actions">
          <button className="pb-modal-btn pb-ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="pb-modal-btn pb-danger" onClick={onConfirm}>
            Trotzdem verlassen
          </button>
        </div>
      </div>
    </div>
  );
}

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  return (
    <div className={`pb-modal-overlay${open ? ' pb-open' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pb-modal pb-wide">
        <h3>Kurzanleitung</h3>
        <ul className="pb-help-list">
          <li>
            <b>Bereit-Kreis (Mitte):</b> Klick meldet dich bereit. Sobald alle bereit sind, startet die Runde &mdash; sonst
            spätestens nach 30s, wer dann nicht bereit ist, setzt diese Runde aus.
          </li>
          <li>
            <b>Spieler-Icon:</b> Hover zeigt Punkte, Karma-Punkte und aktuellen Ranglistenplatz. Ein Klick
            markiert bereit/nicht bereit.
          </li>
          <li>
            <b>Trailer schauen:</b> 25 Sekunden Ausschnitt, danach hast du 10 Sekunden Zeit, dein Jahr in der
            Zeitleiste einzuordnen.
          </li>
          <li>
            <b>Leeres Kästchen</b> in deiner Zeitleiste: Klick wählt die Einfügeposition für die aktuelle Karte.
          </li>
          <li>
            <b>Schmaler Steg zwischen zwei belegten Kästchen:</b> schiebt die Zeitleiste auseinander, um mittendrin
            Platz zu schaffen.
          </li>
          <li>
            <b>&#10003; / &#10005;</b> rechts: Platzierung bestätigen oder Auswahl verwerfen.
          </li>
        </ul>
        <div className="pb-modal-actions">
          <button className="pb-modal-btn pb-primary" onClick={onClose}>
            Verstanden
          </button>
        </div>
      </div>
    </div>
  );
}
