# bloeki v0.1.0-beta

Erstes Beta-Release von bloeki mit lokaler Web-App und Windows-Tools fuer den
Trailer-Workflow.

## Highlights

- Lokales Filmtrailer-Zeitleistenratespiel fuer gemeinsame Runden.
- Docker-Compose-Setup mit Postgres, Backend, Migrationen und Frontend.
- Setup-Assistent fuer den ersten Admin-Account.
- Admin-Bereich fuer Trailer-Scan, Tische, Einladungen, Benutzerverwaltung und
  Kommunikationseinstellungen.
- Host-/Display-Modus mit QR-Code.
- Release-Assets:
  - `TrailerRenamerGui.exe`
  - `SnippetCutterGui.exe`

## Hinweise

- `SnippetCutterGui.exe` benoetigt `ffmpeg` und `ffprobe` im `PATH`.
- Die EXE-Dateien sind self-contained fuer Windows x64 gebaut.
- Vor dem ersten Spiel muessen Trailer-Snippets im konfigurierten
  `TRAILER_CLIP_DIR` liegen.
