import { Link } from 'react-router-dom';
import './pages.css';

export function InstructionsPage() {
  return (
    <div className="app-shell">
      <div className="sh-card sh-rules">
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Anleitung</h2>
        <ol>
          <li>
            Jede*r startet mit <b>2 Jahreskarten</b> auf der eigenen Zeitleiste.
          </li>
          <li>
            Pro Runde läuft ein <b>Filmtrailer</b> für 25 Sekunden. Danach hast du <b>10 Sekunden</b> Zeit, dein
            Kärtchen so in deiner Zeitleiste zu platzieren, dass es chronologisch zwischen die Nachbarkarten passt.
          </li>
          <li>
            Nach jedem Trailer wird aufgelöst: richtige Platzierungen bleiben stehen, falsche verschwinden wieder.
          </li>
          <li>
            Wer zuerst <b>10 korrekte Karten</b> auf der Zeitleiste hat, gewinnt die Partie.
          </li>
          <li>
            Karma-Punkte spiegeln faires Verhalten wider &mdash; ein komplett gespieltes Match gibt Pluspunkte, vorzeitiges
            Verlassen kostet welche und erschwert später die Tisch-/Mitspielersuche.
          </li>
        </ol>
      </div>
    </div>
  );
}
