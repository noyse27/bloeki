# bloeki

bloeki ist ein lokales Video-Trailer-Zeitleistenratespiel: Spielerinnen und
Spieler sehen einen kurzen Filmtrailer-Ausschnitt, raten das
Erscheinungsjahr und ordnen den Film auf einer gemeinsamen Zeitleiste ein.
Wer zuerst 10 korrekt platzierte Karten gesammelt hat, gewinnt.

Das Projekt ist als selbst gehostete Web-App gebaut. Die Trailer bleiben lokal
auf deinem Rechner, NAS oder Server; bloeki nutzt keinen externen Video- oder
Musikdienst.

## Inhalt von v0.2.0-beta

- Solo-Modus zum direkten Üben ohne Ranglisten- oder Karma-Auswirkungen.
- Zuverlässigeres Trailer-Streaming mit serverseitigem RAM-Cache, Vorladen und
  blockweisem Abruf auch von langsameren USB-/NAS-Bibliotheken.
- Konfigurierbarer Trailer-Bibliothekspfad im Setup und Admin-Bereich; Docker zeigt
  zusätzlich den gesetzten Host-Pfad an.
- Trailer-Playlist nach Spielende sowie Suche und Kontrolle der Playlist im
  Admin-Bereich.
- Erweiterte, zeitlich begrenzte Debug-Aufzeichnungen pro Tisch und Partie zum
  Herunterladen und Analysieren von Wiedergabeproblemen.
- Blöki-Intro beim Spielstart und verbesserte Anzeige von Countdown, Spielversion,
  Tisch- und Playlist-Kennern.
- Platzierungen können zunächst verändert werden; der grüne Haken fixiert sie und
  speichert separat den Bestätigungszeitpunkt für einen zukünftigen Turniermodus.
- Sichererer zweistufiger Login und besser abtippbare temporäre Passwörter;
  erledigte Passwort-Reset-Anfragen werden beim erfolgreichen Login entfernt.
- Host-/Display-Modus mit QR-Code für gemeinsame Spielrunden sowie Kommunikation
  und Reaktionen während des Spiels.
- Zwei aktualisierte Windows-Tools als Release-Assets:
  - `TrailerRenamerGui.exe`: Trailer-Dateien ins bloeki-Namensschema bringen.
  - `SnippetCutterGui.exe`: aus Trailern fertige 25-Sekunden-Snippets erzeugen und
    vorhandene Clips auf maximal 1080p, H.264/AAC und 2 Mbit/s neu codieren.

## Schnellstart mit Docker Compose

Voraussetzungen:

- Docker und Docker Compose
- Ein lokaler Ordner mit fertig zugeschnittenen Trailer-Snippets
- Fuer die Windows-Tools: Windows x64 und fuer den Snippet-Cutter `ffmpeg` und
  `ffprobe` im `PATH`

Am schnellsten mit dem mitgelieferten Setup-Skript, das `.env` bei Bedarf
mit einem zufälligen `JWT_SECRET` anlegt und den Stack direkt startet:

```bash
./setup.sh
```

Oder von Hand:

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
einer Synology-Freigabe, setzt du den Host-Pfad in der `.env`, zum Beispiel:

```env
TRAILER_CLIP_HOST_DIR=/volumeUSB2/usbshare/bloeki-clips
```

Der interne Containerpfad bleibt `/data/clips`. Wenn `TRAILER_CLIP_DIR` nicht
gesetzt ist, fragt der Setup-Assistent beim ersten Start nach dem Pfad; spaeter
kann er im Admin-Bereich geaendert werden. Ist `TRAILER_CLIP_DIR` gesetzt, hat
die Umgebungsvariable Vorrang und der Admin-Bereich zeigt den Pfad nur an.

Das Backend scannt den Snippet-Ordner automatisch alle 15 Minuten. Im
Admin-Bereich kann der Scan manuell angestossen werden.

Der CLI-Snippet-Cutter normalisiert neue Videos standardmaessig auf maximal
1080p (kleinere Quellen werden nicht hochskaliert), H.264/AAC und maximal
2 Mbit/s Video-Bitrate fuer zuverlaessiges Vorladen. Bereits vorhandene Snippets lassen sich mit
`--reencode-existing` neu codieren; `--max-height` kann die Obergrenze bei
Bedarf aendern:

```bash
cd tools/snippet-cutter
npm start -- --source "V:\\#trailer" --target "F:\\bloeki-clips" --reencode-existing
```

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

## Demomodus

Für eine öffentlich zugängliche, isolierte Vorführinstanz mit
selbst-zurücksetzenden Testdaten (kein echter Trailer-Inhalt, keine
dauerhaften Accounts) siehe [docs/demo.md](docs/demo.md).

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

Sichere lokale Integrationstests mit eigener Wegwerf-Datenbank:

```bash
npm run test:integration:local
```

Der Befehl nutzt standardmaessig
`postgres://bloeki:bloeki@localhost:15532/bloeki_test`, legt die Datenbank bei
Bedarf an, fuehrt Migrationen aus und startet dann die Backend-Integrationstests.
Die normale Dev-Datenbank `bloeki` wird dabei nicht geleert. Fuer abweichende
Setups kann `TEST_DATABASE_URL` auf eine andere lokale Testdatenbank zeigen.

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
- `TRAILER_CLIP_HOST_DIR`: Host-Ordner, der in Docker nach `/data/clips` gemountet wird.
- `TRAILER_CLIP_DIR`: Pfad aus Sicht des Backends; ueberschreibt Setup-/Admin-Einstellung.
- `TRAILER_SCAN_INTERVAL_CRON`: Scan-Intervall fuer Trailer-Snippets.
- `TRAILER_CACHE_MAX_MB`: Maximaler RAM fuer vorgewärmte Trailer (Standard: 256 MB).
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
