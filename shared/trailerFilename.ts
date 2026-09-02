// Gemeinsam genutzt von tools/snippet-cutter (laeuft lokal auf dem PC, hat
// keine Laufzeit-Abhaengigkeit zu diesem Backend) und
// backend/src/services/trailerScan.ts. Da ein echtes npm-Workspace-Package
// dafuer den Rahmen sprengen wuerde (das Snippet-Tool ist bewusst
// eigenstaendig, siehe tools/snippet-cutter/README-Hinweis in package.json),
// wird diese Datei stattdessen 1:1 in beide Projekte kopiert - siehe den
// Verweis-Kommentar an der jeweiligen Kopie. Aendert sich das Muster, muss
// es an beiden Stellen synchron gehalten werden.
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

/** basename ohne Extension, z.B. "trailer-#9 (2009) {imdb-id tt0472033}". */
export function parseTrailerFilename(basenameWithoutExt: string): ParsedTrailerFilename | null {
  const match = TRAILER_FILENAME_PATTERN.exec(basenameWithoutExt);
  if (!match) return null;
  const [, title, yearRaw, imdbId] = match;
  return { title, year: Number(yearRaw), imdbId };
}

/** Baut aus den geparsten Teilen wieder exakt denselben Dateinamens-Stamm
 * (ohne Extension) - genutzt vom Snippet-Tool, um den Zieldateinamen
 * bit-identisch zum Quelldateinamen zu halten (nur die Extension wechselt
 * zu .mp4). */
export function buildTrailerFilenameStem(parsed: ParsedTrailerFilename): string {
  return `trailer-${parsed.title} (${parsed.year}) {imdb-id ${parsed.imdbId}}`;
}
