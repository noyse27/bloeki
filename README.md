# blöki

Video-Trailer-Zeitleistenratespiel — das visuelle Pendant zu
[songster](https://github.com/) (Musik-Zeitleistenratespiel): Spieler raten
anhand eines 25-sekündigen Filmtrailer-Ausschnitts das Erscheinungsjahr des
Films und ordnen ihn auf einer gemeinsamen Zeitleiste ein. Danach folgt ein
10-sekündiges Einordnungsfenster ("guessing"), bevor die Runde aufgelöst
wird. Erster Spieler mit 10 korrekt platzierten Karten gewinnt.

blöki ist komplett lokal: kein externer Musik-/Video-Lieferant, keine
Token-Spielmechanik. Die Trailer-Bibliothek liegt als lokaler Ordner mit
zugeschnittenen `.mp4`-Dateien vor (siehe `tools/snippet-cutter` unten).

## Architektur

Gleicher Stack wie songster:

- **Backend**: Node 22, Express 4 + TypeScript, Postgres (`node-pg-migrate`),
  `socket.io`, JWT-Auth (`argon2`/`jsonwebtoken`), Jest/Supertest.
- **Frontend**: React 18 + React Router 7, Vite 6, TypeScript,
  `socket.io-client`, Vitest.
- **DB**: eigene Postgres-Datenbank `bloeki`.
- **Docker**: `docker-compose.yml` mit `db`, `migrate`, `backend`, `frontend`
  (nginx) — analog zu songster, aber **ohne** ffmpeg/ffprobe im
  Backend-Image (siehe unten).

## Wichtig: Trailer-Snippets VOR dem ersten Spielstart erzeugen

Das Backend läuft auf schwächerer Hardware (Synology NAS) und schneidet
selbst **keine** Videos zu — es scannt nur zyklisch einen fertigen
Snippet-Ordner (`TRAILER_CLIP_DIR`, alle 15 Minuten per Default, siehe
`backend/src/services/trailerScan.ts`).

Das eigentliche Zuschneiden übernimmt das eigenständige CLI-Tool
`tools/snippet-cutter/` — ein separates, kleines Node/TS-Projekt **ohne**
Laufzeit-Abhängigkeit zu Postgres/Express/Docker. Es läuft manuell, lokal,
auf einem PC mit installiertem `ffmpeg`/`ffprobe` im PATH und schreibt die
fertigen Snippets direkt in den Ordner, den das Backend als
`TRAILER_CLIP_DIR` mountet (z. B. die Syno-Freigabe).

```
cd tools/snippet-cutter
npm install
npm start
```

Fragt interaktiv Quellordner (Default `V:\#trailer`), Zielordner, Startsekunde
(Default 30) und Länge (Default 25s) ab — jeder Wert per Enter mit Default
übernehmbar. Wiederholt aufrufbar: bereits geschnittene Trailer werden
übersprungen, nur neue kommen dazu.

**Vor dem ersten Spielstart** also einmal `tools/snippet-cutter` laufen
lassen und den nächsten Backend-Scan abwarten (oder im Admin-Bereich manuell
über "Jetzt scannen" triggern, `POST /admin/trailers/scan`).

## Docker-Compose-Schnellstart

```
cp .env.example .env
# JWT_SECRET setzen: openssl rand -hex 32
docker compose up --build
```

Der Snippet-Ordner wird per read-only Bind-Mount in den Backend-Container
gemountet (`./bloeki-clips:/data/clips:ro` in `docker-compose.yml`) — Pfad
bei Bedarf per `docker-compose.override.yml` auf die echte Freigabe zeigen
lassen.

Frontend erreichbar unter `http://localhost:5173`. Beim ersten Start wird
ein Setup-Token in den Backend-Logs ausgegeben (`docker compose logs
backend`), das den Browser-Einrichtungsassistenten (`/setup`) freischaltet.

## Später (noch nicht umgesetzt)

Verbund-Login zwischen songster und blöki — zurückgestellt, keine
Architekturentscheidung/Implementierung bisher.
