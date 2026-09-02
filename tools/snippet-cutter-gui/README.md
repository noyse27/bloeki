# blöki Snippet-Cutter (GUI)

Windows-GUI-Variante von [`tools/snippet-cutter`](../snippet-cutter/README.md) — dieselbe Logik (Regex-Namensmuster, ffmpeg-Zuschnitt über eine atomar umbenannte `.part`-Temp-Datei, Nur-Hinzufügen-Prinzip, automatische Start-Anpassung bei zu kurzen Trailern), nur mit Fenster statt Terminal-Prompts. Die CLI bleibt daneben bestehen (z. B. für Automatisierung per Task Scheduler); dieses Tool ist für den manuellen Gebrauch.

Voraussetzung: `ffmpeg`/`ffprobe` müssen im PATH liegen (die App prüft das beim Start und zeigt eine Fehlermeldung mit Installationshinweis, falls nicht).

## Bedienung

1. Quellordner wählen (Default, falls vorhanden: `V:\#trailer`).
2. Zielordner wählen (der Ordner, den das blöki-Backend als `TRAILER_CLIP_DIR` mountet).
3. Startsekunde und Länge einstellen (Default 30s / 25s).
4. Zielformat: aktuell nur `mp4` (Dropdown ist für später vorbereitet).
5. **Start** — Log und Fortschrittsbalken zeigen den Verlauf, **Abbrechen** bricht sauber ab (laufender ffmpeg-Prozess wird beendet, keine Teildatei bleibt liegen).

## Entwickeln

```bash
dotnet build
dotnet run
```

## Veröffentlichen als eigenständige .exe

Self-contained (läuft auch ohne installiertes .NET auf dem Zielrechner, dafür ~70–150 MB):

```bash
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Ergebnis liegt unter `bin/Release/net10.0-windows/win-x64/publish/SnippetCutterGui.exe`.

Framework-dependent (winzig, ~150 KB, braucht aber .NET 10 Desktop Runtime auf dem Zielrechner):

```bash
dotnet publish -c Release -p:PublishSingleFile=true --self-contained false
```
