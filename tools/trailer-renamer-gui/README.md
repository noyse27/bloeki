# blöki Trailer-Renamer (GUI)

Windows-GUI-Tool, um lose herumliegende Trailer-Dateien (Dateiname noch nicht im blöki-Schema) in das erwartete Format zu überführen:

```
trailer-<Titel> (<Jahr>) {imdb-id <imdb-id>}.<ext>
```

Ergebnis kann anschließend ganz normal mit [`tools/snippet-cutter-gui`](../snippet-cutter-gui/README.md) weiterverarbeitet werden.

## Ablauf

1. **Ordner wählen** — listet alle Video-Dateien (`.mkv`, `.mp4`, `.avi`, `.mov`, `.webm`, `.wmv`, `.m4v`, `.ts`) im gewählten Ordner (nicht rekursiv).
2. Für jede Datei wird automatisch versucht, Titel (und Jahr, falls im Dateinamen erkennbar) zu erraten — erkannt werden u. a. Muster wie `Titel ≣ Jahr ≣ Trailer.mkv` oder `Titel - DEFA-Trailer.mkv`. Titel und Jahr lassen sich vor der Suche jederzeit von Hand korrigieren.
3. **Bei TMDB suchen** — fragt die [TMDB-API](https://www.themoviedb.org) ab (dafür einmalig einen kostenlosen API-Key unter <https://www.themoviedb.org/settings/api> anlegen und über den Button **TMDB-API-Key…** hinterlegen; er wird lokal unter `%AppData%\bloeki\trailer-renamer-gui\settings.json` gespeichert, nicht im Repo).
4. Aus der Trefferliste (Titel, Jahr, Produktionsland) den passenden Film auswählen und **Treffer übernehmen & umbenennen** klicken — die Datei wird direkt im selben Ordner umbenannt.
5. **Keine Treffer?** Den erkannten Titel oben aus dem Feld kopieren, selbst in der IMDb suchen, die gefundene IMDb-ID (`tt…`) sowie das Jahr eintragen und **Manuell umbenennen** klicken.
6. **Überspringen**, wenn eine Datei (noch) nicht zugeordnet werden soll.

Bereits umbenannte bzw. übersprungene Dateien sind in der Liste links mit ✓ bzw. – markiert.

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

Ergebnis liegt unter `bin/Release/net10.0-windows/win-x64/publish/TrailerRenamerGui.exe`.

Framework-dependent (winzig, ~150 KB, braucht aber .NET 10 Desktop Runtime auf dem Zielrechner):

```bash
dotnet publish -c Release -p:PublishSingleFile=true --self-contained false
```
