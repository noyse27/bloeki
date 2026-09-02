// Duplikat von shared/trailerFilename.ts (Repo-Root) - siehe dessen
// Kopf-Kommentar: dieses Tool hat bewusst KEINE Laufzeit-Abhaengigkeit zum
// restlichen Repo (kein npm-Workspace-Mitglied, laeuft komplett
// eigenstaendig lokal), deshalb ist das Muster hier bewusst dupliziert statt
// importiert. Bei einer Aenderung MUSS diese Kopie synchron mit
// shared/trailerFilename.ts und backend/src/services/trailerScan.ts
// gehalten werden.
//
// Erwartetes Dateinamensmuster (ohne Extension):
//   trailer-<Filmtitel> (<Jahr>) {imdb-id ttXXXXXXX}
// Rechtsverankert (das `$` am Ende), damit Klammern innerhalb des
// Filmtitels selbst (z.B. "(T)Raumschiff Surprise - Periode 1") die
// Erkennung von Jahr/imdb-id am Ende nicht stoeren.
export const TRAILER_FILENAME_PATTERN = /^trailer-(.+?)\s\((\d{4})\)\s\{imdb-id\s+(tt\d+)\}$/;

export interface ParsedTrailerFilename {
  title: string;
  year: number;
  imdbId: string;
}

export function parseTrailerFilename(basenameWithoutExt: string): ParsedTrailerFilename | null {
  const match = TRAILER_FILENAME_PATTERN.exec(basenameWithoutExt);
  if (!match) return null;
  const [, title, yearRaw, imdbId] = match;
  return { title, year: Number(yearRaw), imdbId };
}

/** Baut aus den geparsten Teilen wieder exakt denselben Dateinamens-Stamm
 * (ohne Extension) - haelt den Zieldateinamen bit-identisch zum
 * Quelldateinamen (nur die Extension wechselt zu .mp4), damit der
 * Backend-Scan (trailerScan.ts) dieselbe Regex/dasselbe Namensschema
 * nutzen kann. */
export function buildTrailerFilenameStem(parsed: ParsedTrailerFilename): string {
  return `trailer-${parsed.title} (${parsed.year}) {imdb-id ${parsed.imdbId}}`;
}
