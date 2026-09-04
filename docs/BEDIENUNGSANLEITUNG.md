# bloeki Bedienungsanleitung

Diese Anleitung fuehrt vom ersten Start bis zur fertigen Spielrunde. Sie
beschreibt die Web-App und die beiden Windows-Tools aus dem Release.

## 1. Installation der Web-App

### Voraussetzungen

- Docker und Docker Compose
- Ein Ordner fuer die fertigen Trailer-Snippets
- Zugriff auf den Rechner oder Server, auf dem bloeki laufen soll

### `.env` anlegen

Kopiere die Vorlage:

```bash
cp .env.example .env
```

Setze mindestens `JWT_SECRET`:

```bash
JWT_SECRET=<zufaelliger-wert-mit-mindestens-32-zeichen>
```

Optional kannst du den Frontend-Port anpassen:

```bash
FRONTEND_HOST_PORT=5174
```

### Trailer-Ordner einbinden

Standardmaessig nutzt Docker Compose den lokalen Ordner `./bloeki-clips`.
Wenn deine Snippets auf einer anderen Platte oder NAS-Freigabe liegen, lege
eine `docker-compose.override.yml` an:

```yaml
services:
  backend:
    volumes:
      - "V:/bloeki-clips:/data/clips:ro"
```

Passe den linken Pfad an deinen echten Snippet-Ordner an.

### Starten

```bash
docker compose up --build
```

Die Web-App laeuft danach unter:

```text
http://localhost:5174
```

Wenn du bloeki von einem anderen Geraet im Netzwerk oeffnest, verwende die
IP-Adresse oder den Hostnamen des Servers, zum Beispiel:

```text
http://192.168.1.50:5174
```

## 2. Ersteinrichtung

Beim ersten Start gibt das Backend einen Setup-Link aus:

```bash
docker compose logs backend
```

Suche nach `SETUP TOKEN`. Oeffne den angezeigten Link oder rufe `/setup` im
Browser auf und trage den Token ein.

Im Setup-Assistenten:

1. Admin-Benutzername, E-Mail und Passwort eintragen.
2. Admin anlegen.
3. Den Selbsttest ausfuehren.
4. Danach anmelden.

Der Setup-Token funktioniert nur, solange noch kein Admin-Account existiert.

## 3. Trailer vorbereiten

bloeki spielt keine kompletten Trailer-Dateien ab, sondern fertige kurze
Snippets. Der empfohlene Workflow ist:

1. Original-Trailer sammeln.
2. Mit `TrailerRenamerGui.exe` ins bloeki-Namensschema bringen.
3. Mit `SnippetCutterGui.exe` Snippets erzeugen.
4. Zielordner vom Backend scannen lassen.

### Erwartetes Namensschema

```text
trailer-<Titel> (<Jahr>) {imdb-id <imdb-id>}.mp4
```

Beispiel:

```text
trailer-The Matrix (1999) {imdb-id tt0133093}.mp4
```

Das Jahr ist das Erscheinungsjahr, das spaeter geraten wird. Die IMDb-ID macht
den Film eindeutig.

## 4. TrailerRenamerGui.exe

Dieses Tool benennt lose Trailer-Dateien in das bloeki-Schema um.

### Voraussetzungen

- Windows x64
- Fuer die TMDB-Suche: ein kostenloser TMDB-API-Key

Den API-Key kannst du bei TMDB in den Kontoeinstellungen erzeugen. Im Tool wird
er ueber `TMDB-API-Key...` gespeichert. Die Speicherung erfolgt lokal unter
`%AppData%\bloeki\trailer-renamer-gui\settings.json`.

### Bedienung

1. `TrailerRenamerGui.exe` starten.
2. `Ordner waehlen` anklicken.
3. Einen Ordner mit Trailer-Dateien auswaehlen.
4. Links eine Datei aus der Liste waehlen.
5. Titel und Jahr pruefen oder korrigieren.
6. `Bei TMDB suchen` klicken.
7. Den passenden Treffer auswaehlen.
8. `Treffer uebernehmen & umbenennen` klicken.

Wenn TMDB nichts Passendes findet:

1. Den Film selbst bei IMDb suchen.
2. IMDb-ID im Format `tt...` eintragen.
3. Jahr eintragen.
4. `Manuell umbenennen` klicken.

Unterstuetzte Eingangsformate sind unter anderem `.mkv`, `.mp4`, `.avi`,
`.mov`, `.webm`, `.wmv`, `.m4v` und `.ts`.

### Hinweise

- Das Tool arbeitet nicht rekursiv. Es listet nur Dateien direkt im gewaehlten
  Ordner.
- Bereits bearbeitete oder uebersprungene Dateien werden in der Liste markiert.
- Wenn eine Zieldatei bereits existiert, fragt das Tool nach dem weiteren
  Vorgehen.

## 5. SnippetCutterGui.exe

Dieses Tool schneidet aus umbenannten Trailern kurze `.mp4`-Snippets.

### Voraussetzungen

- Windows x64
- `ffmpeg` und `ffprobe` im `PATH`

Pruefe die Installation in PowerShell:

```powershell
ffmpeg -version
ffprobe -version
```

Wenn beide Befehle funktionieren, kann der Snippet-Cutter schneiden.

### Bedienung

1. `SnippetCutterGui.exe` starten.
2. Quellordner waehlen, in dem die umbenannten Trailer liegen.
3. Zielordner waehlen, den bloeki als Trailer-Bibliothek scannt.
4. Startsekunde einstellen, Standard ist `30`.
5. Laenge einstellen, Standard ist `25`.
6. `Start` klicken.

Das Tool schreibt Fortschritt und Details ins Log. Bereits vorhandene Snippets
werden uebersprungen. Bei zu kurzen Trailern wird der Startpunkt automatisch
angepasst.

### Abbrechen

Mit `Abbrechen` wird der laufende ffmpeg-Prozess beendet. Unvollstaendige
Teildateien werden nicht als fertige Snippets uebernommen.

## 6. Trailer in bloeki scannen

Nach dem Schneiden gibt es zwei Wege:

- Warten, bis der automatische Scan laeuft. Standard: alle 15 Minuten.
- Im Admin-Bereich `Jetzt scannen` ausloesen.

Wenn beim Spielstart keine Trailer verfuegbar sind, pruefe:

- Liegen `.mp4`-Dateien im gemounteten Ordner?
- Stimmen Namen und IMDb-ID-Schema?
- Zeigt der Docker-Mount wirklich auf den Zielordner?
- Gibt es Backend-Logmeldungen zum Trailer-Scan?

## 7. Spielen

### Konto anlegen und anmelden

Der erste Account entsteht im Setup-Assistenten als Admin. Weitere Spieler
koennen ueber Einladungen registriert werden, wenn die Instanz so betrieben
wird.

### Tisch erstellen

1. Anmelden.
2. `Tisch erstellen` oeffnen.
3. Tischname und Einstellungen auswaehlen.
4. Tisch erstellen.

Der Ersteller ist Tischleitung. Sobald Spieler beigetreten und bereit sind,
kann die Runde gestartet werden.

### Beitreten

Spieler oeffnen die Web-App auf ihrem eigenen Geraet, melden sich an und treten
einem verfuegbaren Tisch bei.

### Rundenablauf

1. Countdown startet.
2. Trailer-Snippet laeuft.
3. Guessing-Fenster oeffnet.
4. Spieler ordnen den Film auf ihrer Zeitleiste ein.
5. Aufloesung zeigt Titel, Jahr und Platzierung.
6. Naechste Runde startet, bis jemand 10 korrekt platzierte Karten erreicht.

## 8. Display- und Host-Modus

Fuer gemeinsame Runden kann ein Host- oder Display-Geraet genutzt werden, zum
Beispiel ein TV, Beamer oder Wohnzimmer-PC.

Typischer Ablauf:

1. Tisch oeffnen.
2. Display-Link oder QR-Code erzeugen.
3. Link auf dem Anzeige-Geraet oeffnen.
4. Spieler steuern ihre Eingaben auf den eigenen Geraeten.

Autorisierte Host-Geraete koennen im Profil verwaltet werden.

## 9. Admin-Bereich

Admins koennen:

- Trailer scannen und Trailer-Bibliothek pruefen.
- Tische ueberwachen und bei Bedarf loeschen.
- Einladungen erstellen und verwalten.
- Benutzerrechte fuer Einladungserstellung vergeben oder entziehen.
- Kommunikationseinstellungen pflegen.

Der Admin-Bereich ist unter `/admin` erreichbar, sobald du als Admin
angemeldet bist.

## 10. Wartung

### Logs ansehen

```bash
docker compose logs backend
docker compose logs frontend
docker compose logs db
```

Live-Logs:

```bash
docker compose logs -f backend
```

### Aktualisieren

```bash
git pull
docker compose up --build
```

Migrationen laufen im Compose-Setup ueber den `migrate`-Service.

### Integrationstests lokal sicher ausfuehren

Die Backend-Integrationstests leeren ihre Datenbank vor dem Lauf. Verwende
deshalb den sicheren lokalen Testbefehl:

```bash
npm run test:integration:local
```

Dieser Befehl verwendet standardmaessig die separate Datenbank `bloeki_test` auf
`localhost:15532`, legt sie bei Bedarf an, migriert sie und startet danach die
Integrationstests. Die normale Entwicklungsdatenbank `bloeki` bleibt erhalten.

Fuer andere lokale Setups kannst du eine eigene Testdatenbank setzen:

```powershell
$env:TEST_DATABASE_URL="postgres://bloeki:bloeki@localhost:15532/mein_bloeki_test"
npm run test:integration:local
```

### Stoppen

```bash
docker compose down
```

Die Datenbankdaten bleiben im Docker-Volume erhalten.

### Vollstaendig zuruecksetzen

Nur verwenden, wenn die Datenbank geloescht werden darf:

```bash
docker compose down -v
```

## 11. Fehlerbehebung

### Backend startet nicht wegen `JWT_SECRET`

Setze einen echten Wert in `.env`. Der Wert muss mindestens 32 Zeichen lang
sein und darf nicht leer sein.

### Setup-Link zeigt auf die falsche Adresse

Setze `FRONTEND_URL` in `.env`, zum Beispiel:

```bash
FRONTEND_URL=http://192.168.1.50:5174
```

Danach Container neu starten.

### Keine Trailer im Spiel

Pruefe den Snippet-Ordner, das Namensschema und den Docker-Mount. Fuehre danach
im Admin-Bereich einen manuellen Scan aus.

### Snippet-Cutter startet, schneidet aber nicht

Pruefe `ffmpeg` und `ffprobe`:

```powershell
ffmpeg -version
ffprobe -version
```

Pruefe ausserdem, ob Quell- und Zielordner beschreibbar sind.

### TMDB-Suche funktioniert nicht

Pruefe den gespeicherten API-Key und deine Internetverbindung. Alternativ kannst
du Jahr und IMDb-ID manuell eintragen.

### Port ist belegt

Passe in `.env` den Frontend-Port an:

```bash
FRONTEND_HOST_PORT=5175
```

Danach:

```bash
docker compose up --build
```
