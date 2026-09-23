# Demomodus

blöki kann als isolierte, öffentlich zugängliche Demo-Instanz betrieben
werden - zum Ausprobieren, ohne dass irgendwo echte Zugangsdaten, echte
Trailer-Inhalte oder dauerhafte Nutzerdaten entstehen.

## Was der Demomodus macht

- Die Datenbank wird periodisch (Standard: stündlich) vollständig
  zurückgesetzt: alle Accounts, Tische, Spiele, Chatnachrichten und
  Host-Device-Pairings werden gelöscht und neu befüllt mit:
  - einem festen Demo-Admin-Account,
  - zwei Demo-Spielern (`demo-anna`, `demo-ben`) mit etwas Punktestand
    (damit die Rangliste nicht leer ist),
  - einem bereits offenen, öffentlichen Demo-Tisch, den `demo-anna`
    eröffnet hat und an dem sie schon sitzt und bereit ist - ein Besucher
    kann direkt beitreten, selbst auf "bereit" klicken und das Spiel
    startet sofort, ganz ohne eigenen Tisch anlegen zu müssen,
  - einem stehenden Einladungscode, mit dem sich Besucher selbst
    registrieren können.
- Ein sichtbares Banner im Frontend weist auf den Demomodus hin und zeigt
  den Einladungscode sowie die Admin-Zugangsdaten - beides ist bewusst kein
  Geheimnis, da die Instanz ohnehin nur Testdaten enthält und sich selbst
  zurücksetzt.
- Ein `X-Robots-Tag: noindex, nofollow`-Header verhindert, dass die
  Demo-Instanz in Suchmaschinen auftaucht.
- Ein paar destruktive Admin-Aktionen sind gesperrt (Einladungsrechte
  entziehen/zurücksetzen, Kommunikationseinstellungen ändern, Tische
  löschen) - siehe `backend/src/middleware/demoBlock.ts`. Alles andere
  (Registrieren, Spielen, Tische anlegen, Chat, Rangliste, Admin-Ansicht)
  funktioniert normal.
- Die Trailer-Bibliothek besteht aus zehn synthetisch erzeugten
  Platzhalter-Clips (Farbfläche + Ton + eingeblendeter Titel), erzeugt vom
  `demo-clips`-Compose-Service beim ersten Start. Es werden keine echten
  Trailer-Videos verwendet oder mitgeliefert - das wäre sowohl ein
  Urheberrechtsproblem als auch unnötig für eine öffentliche Demo.

## Zum Testen

1. Mit dem Einladungscode selbst registrieren (oder direkt als
   `demo-admin` anmelden) und in der Lobby den offenen "Demo-Tisch"
   beitreten.
2. Auf "bereit" klicken - `demo-anna`, die Tischbesitzerin, ist bereits
   bereit, also startet die erste Runde sofort.
3. Für eine zweite Runde muss auch `demo-anna` wieder auf "bereit"
   klicken (die Runden-Bereit-Markierung gilt jeweils nur für die
   laufende Partie, siehe unten) - dafür in einem zweiten Tab/Browser mit
   `demo-anna` / `<DEMO_ADMIN_PASSWORD>` anmelden, oder den "Auto
   bereit"-Schalter dort einmal aktivieren, dann läuft die Partie von
   allein weiter.

`demo-anna` ist nur eine vorab in der Datenbank angelegte Zeile, niemand
ist dauerhaft in ihrem Namen eingeloggt - `table_seat.ready` (das
Tisch-Bereit-Flag, das den automatischen Spielstart auslöst) lässt sich
beim Reset vorab setzen, das separate, pro-Partie geltende "Auto
bereit" (`round_ready_pref`, siehe `roundReady.ts`) dagegen nicht, weil
es erst nach dem ersten Rundenstart eine Partie-ID gibt, an die es
gebunden werden kann.

## Aktivierung

Rein über die Umgebungsvariable `DEMO_MODE=true`
(`backend/src/config/demoMode.ts`), gesetzt für eine komplett separate
Compose-Installation - **niemals** gegen eine bestehende, echte Datenbank.

Am einfachsten über das mitgelieferte Setup-Skript, das `.env.demo` bei
Bedarf mit einem zufälligen `JWT_SECRET` anlegt und den Stack startet:

```bash
./setup.sh demo
```

Entspricht von Hand ausgeführt:

```bash
cp .env.demo.example .env.demo
# JWT_SECRET in .env.demo setzen (openssl rand -hex 32)

docker compose -p bloeki-demo --env-file .env.demo -f compose.demo.yaml up -d --build
```

`./setup.sh` (ohne Argument oder mit `production`) macht dasselbe für die
normale Installation (`.env` statt `.env.demo`). Beide Aufrufe sind sicher
mehrfach ausführbar - eine bereits vorhandene Env-Datei bzw. ein bereits
gesetztes Secret wird nie überschrieben.

`compose.demo.yaml` ist bewusst eine eigenständige Compose-Datei, kein
Override der normalen `docker-compose.yml` - sie hat eigene
Standard-Ports (Frontend `5175`, Postgres `15533`, siehe
`.env.demo.example`), ein eigenes DB-Volume (durch den Compose-Projektnamen
`bloeki-demo` automatisch von der echten Installation getrennt) und einen
zusätzlichen `demo-clips`-Service, der die Platzhalter-Trailer erzeugt,
bevor das Backend startet. Eine echte blöki-Installation und eine
Demo-Installation können so parallel auf demselben Host laufen, ohne sich
in die Quere zu kommen.

### Konfigurierbare Werte (`.env.demo`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `JWT_SECRET` | *(erforderlich)* | wie bei der echten Installation |
| `DEMO_RESET_MINUTES` | `60` | Reset-Intervall in Minuten, geklemmt auf 5-1440 |
| `DEMO_ADMIN_USERNAME` / `_EMAIL` / `_PASSWORD` | `demo-admin` / `demo-admin@example.invalid` / `bloeki-demo` | fester Admin-Login, auf dem Banner sichtbar |
| `DEMO_INVITE_CODE` | `demo` | stehender Einladungscode für Selbstregistrierung |
| `FRONTEND_HOST_PORT` / `DB_HOST_PORT` | `5175` / `15533` | Host-Ports, kollisionsfrei zu echtem bloeki (`5174`/`15532`) und songster (`5173`/`15432`) |
| `TRAILER_DEMO_CLIP_SECONDS` | `25` | Länge der generierten Platzhalter-Clips |

## Sicherheitsmechanismus

`backend/src/services/demoReset.ts`s `assertDemoSafeToManage()` läuft bei
jedem Start, wenn `DEMO_MODE=true` gesetzt ist:

- Findet sie einen `system_setting`-Eintrag `demo_managed`, ist die
  Datenbank bereits als Demo-Instanz markiert - der periodische Reset läuft
  normal weiter.
- Ist die Datenbank leer (kein einziger Account), wird sie einmalig
  befüllt und der Marker gesetzt.
- Enthält die Datenbank bereits Accounts, aber **keinen** Marker, verweigert
  das Backend den Start mit einem Fehler. Das verhindert, dass ein
  Konfigurationsfehler (z. B. eine versehentlich wiederverwendete
  `DATABASE_URL`) eine echte, befüllte Installation stillschweigend
  periodisch leerräumt.

## Tests

- `backend/test/unit/demoMode.test.ts`: Env-Var-Parsing (Aktivierung,
  Clamping von `DEMO_RESET_MINUTES`).
- `backend/test/integration/demoReset.test.ts`: Erstbefüllung, Idempotenz,
  Verweigerung bei fremden Daten ohne Marker, Trailer-Bibliothek bleibt beim
  Reset erhalten.
- `backend/test/integration/demoBlock.test.ts`: gesperrte vs. weiterhin
  erlaubte Admin-Routen, öffentlicher `/api/v1/demo/status`-Endpunkt.

```bash
npm run test:unit --workspace backend
npm run test:integration:local
```
