// Geteilt von roundEngine.ts (das die eigentlichen Uebergaenge plant) und
// gameState.ts/broadcast.ts (die dieselben Zahlen brauchen, um Clients zu
// sagen, wie lange Countdown/Trailer/Ratefenster dauern) - kein zirkulaerer
// Import zwischen roundEngine und dem Realtime-Broadcaster, den es aufruft.

// Fixe Werte fuer den Produktivbetrieb; per Env ueberschreibbar, damit
// Integrationstests einen kompletten Countdown -> Trailer -> Ratefenster ->
// Aufloesung-Zyklus in Millisekunden statt echten 3s + 25s + 10s
// durchlaufen koennen.
export const COUNTDOWN_MS = Number(process.env.ROUND_COUNTDOWN_MS ?? 3000);
export const TRAILER_DURATION_MS = Number(process.env.ROUND_TRAILER_DURATION_MS ?? 25000);

// Neu gegenueber songster: bei bloeki wird NICHT waehrend des Trailers
// geraten, sondern in einem eigenen Fenster direkt danach (siehe
// roundEngine.ts's 'guessing'-Status). Der Trailer-Ausschnitt selbst ist
// bereits auf ca. 25s zugeschnitten (siehe tools/snippet-cutter), das
// Ratefenster kommt on top.
export const GUESS_WINDOW_MS = Number(process.env.ROUND_GUESS_WINDOW_MS ?? 10000);

// Pro-Runde-Bereitschaftsfenster (roundReady.ts): jede Runde ab der zweiten
// oeffnet mit diesem Bereitschaftsfenster, bevor sie automatisch startet.
export const ROUND_READY_WINDOW_MS = Number(process.env.ROUND_READY_WINDOW_MS ?? 30000);

// "Auto bereit" (roundReady.ts) automatisiert nur den Bereit-Klick selbst,
// nicht die Ansicht der gerade geoeffneten Aufloesung/Ansage - deshalb
// wartet ein voll auto-bereites Match trotzdem diese feste Zeit, bevor die
// naechste Runde tatsaechlich startet, genauso als haette jeder Spieler den
// Bildschirm gelesen und von Hand geklickt.
export const AUTO_READY_GRACE_MS = Number(process.env.AUTO_READY_GRACE_MS ?? 5000);
