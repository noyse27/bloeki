# bloeki

bloeki ist ein lokales Video-Trailer-Zeitleistenratespiel: Spielerinnen und
Spieler sehen einen kurzen Filmtrailer-Ausschnitt, raten das
Erscheinungsjahr und ordnen den Film auf einer gemeinsamen Zeitleiste ein.
Wer zuerst 10 korrekt platzierte Karten gesammelt hat, gewinnt.

Das Projekt ist als selbst gehostete Web-App gebaut. Die Trailer bleiben lokal
auf deinem Rechner, NAS oder Server; bloeki nutzt keinen externen Video- oder
Musikdienst.

## Inhalt dieses Releases

- Web-App mit Backend, Frontend, Postgres-Datenbank und Docker-Compose-Setup.
- Setup-Assistent fuer die erste Admin-Einrichtung.
- Admin-Bereich fuer Trailer-Scan, Tische, Einladungen, Benutzerverwaltung und
  Kommunikationseinstellungen.
- Host-/Display-Modus mit QR-Code fuer gemeinsame Spielrunden.
- Zwei Windows-Tools als Release-Assets:
  - `TrailerRenamerGui.exe`: Trailer-Dateien ins bloeki-Namensschema bringen.
  - `SnippetCutterGui.exe`: aus Trailern fertige 25-Sekunden-Snippets erzeugen.

## Schnellstart mit Docker Compose

Voraussetzungen:

- Docker und Docker Compose
- Ein lokaler Ordner mit fertig zugeschnittenen Trailer-Snippets
- Fuer die Windows-Tools: Windows x64 und fuer den Snippet-Cutter `ffmpeg` und
  `ffprobe` im `PATH`

```bash
cp .env.example .env
```

Setze in `.env` mindestens:

```bash
JWT_SECRET=<zufaelliges-geheimnis-mit-mindestens-32-zeichen>
```

Ein Secret erzeugst du zum Beispiel mit:

```bash
openssl rand -hex 32
```

Danach starten:

```bash
docker compose up --build
```

Die Web-App ist danach standardmaessig unter `http://localhost:5174`
erreichbar.

Beim ersten Start schreibt das Backend einen Setup-Link mit Token in die Logs:

```bash
docker compose logs backend
```

Oeffne den Link oder gehe auf `/setup`, um den ersten Admin-Account anzulegen.
Danach ist das Setup-Token verbraucht.

## Trailer-Bibliothek

bloeki erwartet fertige Snippets in diesem Namensschema:

```text
trailer-<Titel> (<Jahr>) {imdb-id <imdb-id>}.mp4
```

Beispiel:

```text
trailer-Alien (1979) {imdb-id tt0078748}.mp4
```

Im Docker-Setup wird der Ordner `./bloeki-clips` read-only nach `/data/clips`
in den Backend-Container gemountet. Fuer produktive Setups, zum Beispiel auf
einer Synology-Freigabe, kannst du den Host-Pfad per
`docker-compose.override.yml` ersetzen.

Das Backend scannt den Snippet-Ordner automatisch alle 15 Minuten. Im
Admin-Bereich kann der Scan manuell angestossen werden.

## Windows-Tools

Die beiden GUI-Tools sind fuer den lokalen Vorbereitungsworkflow gedacht:

1. `TrailerRenamerGui.exe` benennt lose Trailer-Dateien mit Hilfe von TMDB oder
   manueller IMDb-ID in das bloeki-Schema um.
2. `SnippetCutterGui.exe` schneidet daraus fertige `.mp4`-Snippets fuer die
   bloeki-Bibliothek.

Die EXEs aus dem Release sind self-contained gebaut. Auf dem Zielrechner muss
also keine .NET Desktop Runtime installiert sein. `SnippetCutterGui.exe`
braucht aber weiterhin `ffmpeg` und `ffprobe` im `PATH`, weil das eigentliche
Video-Schneiden darueber laeuft.

Mehr Details stehen in der [Bedienungsanleitung](docs/BEDIENUNGSANLEITUNG.md).

## Lokale Entwicklung

Voraussetzungen:

- Node.js 22 oder neuer
- npm
- Postgres
- .NET SDK 10 fuer die Windows-Tools

Root-Installation:

```bash
npm install
```

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Build und Tests:

```bash
npm run build
npm run test:unit
npm run test:integration
```

Windows-Tools bauen:

```bash
dotnet publish tools/snippet-cutter-gui/SnippetCutterGui.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
dotnet publish tools/trailer-renamer-gui/TrailerRenamerGui.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

## Wichtige Konfiguration

Die wichtigsten Variablen aus `.env.example`:

- `JWT_SECRET`: Pflichtwert fuer Login- und Sitzungs-Tokens.
- `SETUP_TOKEN`: optionaler fixer Token fuer unbeaufsichtigte Erstinstallation.
- `FRONTEND_URL`: Adresse, die im Setup-Link in den Backend-Logs verwendet wird.
- `FRONTEND_HOST_PORT`: Host-Port des Frontends, Default `5174`.
- `DB_HOST_PORT`: lokaler Debug-Port fuer Postgres, Default `15532`.
- `TRAILER_SCAN_INTERVAL_CRON`: Scan-Intervall fuer Trailer-Snippets.
- `BETA_DEBUG_LOGGING` und `VITE_BETA_DEBUG_LOGGING`: zusaetzliche Diagnose-Logs
  fuer Beta-/Test-Sessions.

## Architektur

- Backend: Node.js, Express, TypeScript, Postgres, `socket.io`, JWT-Auth.
- Frontend: React, React Router, Vite, TypeScript, `socket.io-client`.
- Datenbank: Postgres mit `node-pg-migrate`.
- Deployment: Docker Compose mit `db`, `migrate`, `backend` und `frontend`.
- Tools: .NET 10 WinForms fuer manuelle Windows-Workflows.

## Lizenz

Dieses Repository enthaelt derzeit keine explizite Lizenzdatei. Vor einer
oeffentlichen Weitergabe sollte eine passende Lizenz ergaenzt werden.
