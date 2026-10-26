#!/usr/bin/env node
// bloeki Snippet-Cutter - eigenstaendiges lokales CLI-Tool.
//
// Laeuft NICHT im Docker-Compose-Stack, NICHT auf der Synology: die
// Synology-Hardware ist zu schwach fuers ffmpeg-Zuschneiden vieler
// Trailer, deshalb laeuft dieses Tool manuell auf dem staerkeren
// Windows-PC und schreibt die fertigen Snippets direkt auf die
// Syno-Freigabe (oder einen beliebigen lokalen/Netzwerk-Zielordner). Das
// bloeki-Backend scannt diesen Ordner danach nur noch leichtgewichtig
// (siehe backend/src/services/trailerScan.ts) - kein ffmpeg/ffprobe im
// Backend-Image.
//
// Voraussetzung: ffmpeg UND ffprobe muessen im PATH installiert sein.
//
// Aufruf: npm start  (in diesem Ordner) - fragt interaktiv alle Werte ab,
// jeder Wert ist per Enter mit seinem Default uebernehmbar. Wiederholt
// aufrufbar: bereits geschnittene Dateien (gleicher Zieldateiname) werden
// normalerweise uebersprungen. Mit --reencode-existing koennen sie sicher
// neu codiert und ersetzt werden.
//
// Nur-Hinzufuegen-Prinzip: das Tool liest ausschliesslich den Quellordner
// und schreibt/ueberspringt einzelne Zieldateien - es listet den
// Zielordner nie komplett und loescht dort nichts. Fehlt ein Trailer beim
// naechsten Durchlauf im Quellordner (verschoben, umbenannt, Laufwerk
// nicht verbunden), bleibt sein bereits geschnittenes Snippet unangetastet
// liegen. Ein Snippet verschwindet also nie stillschweigend, nur weil die
// Quelle gerade nicht erreichbar war.

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import prompts from 'prompts';
import { buildTrailerFilenameStem, parseTrailerFilename } from './trailerFilename';

const SOURCE_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov']);

interface CliOptions {
  sourceDir: string;
  targetDir: string;
  startSeconds: number;
  lengthSeconds: number;
  maxHeight: number;
  reencodeExisting: boolean;
}

interface ScanEntry {
  sourcePath: string;
  basename: string;
}

// Erlaubt nicht-interaktive Laeufe (z.B. fuer Tests oder Automatisierung
// per Task Scheduler): werden --source und --target als Flags uebergeben,
// werden die interaktiven prompts uebersprungen; --start/--length sind
// dabei optional und fallen sonst auf ihre Defaults zurueck. Vorhandene
// Ziele werden nur mit --reencode-existing ersetzt; --max-height ist 1080.
function parseCliArgs(argv: string[]): Partial<CliOptions> | null {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const sourceDir = get('--source');
  const targetDir = get('--target');
  if (!sourceDir || !targetDir) return null;
  const startRaw = get('--start');
  const lengthRaw = get('--length');
  const maxHeightRaw = get('--max-height');
  return {
    sourceDir,
    targetDir,
    startSeconds: startRaw !== undefined ? Number(startRaw) : 30,
    lengthSeconds: lengthRaw !== undefined ? Number(lengthRaw) : 25,
    maxHeight: maxHeightRaw !== undefined ? Number(maxHeightRaw) : 1080,
    reencodeExisting: argv.includes('--reencode-existing'),
  };
}

async function promptOptions(): Promise<CliOptions> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  if (cliArgs) return cliArgs as CliOptions;

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'sourceDir',
        message: 'Quellordner mit den Original-Trailern',
        initial: 'V:\\#trailer',
      },
      {
        type: 'text',
        name: 'targetDir',
        message:
          'Zielordner fuer die geschnittenen Snippets (z.B. die Syno-Freigabe, die das bloeki-Backend als TRAILER_CLIP_DIR mountet)',
        initial: '\\\\syno\\bloeki-clips',
      },
      {
        type: 'number',
        name: 'startSeconds',
        message: 'Startsekunde des Ausschnitts',
        initial: 30,
        min: 0,
      },
      {
        type: 'number',
        name: 'lengthSeconds',
        message: 'Laenge des Ausschnitts in Sekunden',
        initial: 25,
        min: 1,
      },
      {
        type: 'number',
        name: 'maxHeight',
        message: 'Maximale Videohoehe (kleinere Videos werden nicht hochskaliert)',
        initial: 1080,
        min: 240,
      },
      {
        type: 'confirm',
        name: 'reencodeExisting',
        message: 'Bereits vorhandene Snippets neu codieren und sicher ersetzen?',
        initial: false,
      },
    ],
    {
      onCancel: () => {
        console.log('Abgebrochen.');
        process.exit(1);
      },
    },
  );
  return response as CliOptions;
}

async function listSourceFiles(dir: string): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = [];
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Kann Quellordner nicht lesen: ${dir}`, err);
    return entries;
  }
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...(await listSourceFiles(fullPath)));
    } else if (dirent.isFile() && SOURCE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
      entries.push({ sourcePath: fullPath, basename: dirent.name });
    }
  }
  return entries;
}

function runCommand(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function probeDurationSeconds(sourcePath: string): Promise<number | null> {
  const result = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'json',
    sourcePath,
  ]);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { format?: { duration?: string } };
    const duration = Number(parsed.format?.duration);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

async function replaceFileAtomically(tempPath: string, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.bak`;
  const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (!targetExists) {
    await fs.rename(tempPath, targetPath);
    return;
  }

  await fs.rm(backupPath, { force: true });
  await fs.rename(targetPath, backupPath);
  try {
    await fs.rename(tempPath, targetPath);
    await fs.rm(backupPath, { force: true });
  } catch (err) {
    await fs.rename(backupPath, targetPath).catch(() => undefined);
    throw err;
  }
}

async function cutClip(
  sourcePath: string,
  targetPath: string,
  start: number,
  length: number,
  maxHeight: number,
): Promise<boolean> {
  // ffmpeg schreibt zunaechst in eine temporaere Datei im selben Ordner
  // (gleiches Dateisystem => rename ist atomar) und wird erst danach auf
  // den endgueltigen Zieldateinamen umbenannt. Damit gilt "Zieldatei
  // existiert" zuverlaessig als "vollstaendig geschnitten" - ein
  // abgebrochener Lauf (Absturz, Stromausfall) hinterlaesst nur eine
  // .part-Datei, die beim naechsten Durchlauf ignoriert und der Trailer
  // erneut geschnitten wird, statt als falsch-positiv "bereits vorhanden"
  // durchzugehen.
  const tempPath = `${targetPath}.part`;
  await fs.rm(tempPath, { force: true }).catch(() => {});
  const result = await runCommand('ffmpeg', [
    '-y',
    '-ss', String(start),
    '-i', sourcePath,
    '-t', String(length),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-maxrate', '2M',
    '-bufsize', '4M',
    '-vf', `scale=w=trunc(iw*min(1\\,${maxHeight}/ih)/2)*2:h=trunc(ih*min(1\\,${maxHeight}/ih)/2)*2`,
    '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    // Ohne -f wuerde ffmpeg das Ausgabeformat aus der Dateiendung raten -
    // durch das ".part"-Suffix der temporaeren Datei (siehe oben) endet
    // der Dateiname aber nicht mehr auf ".mp4", also muss der Muxer
    // explizit angegeben werden.
    '-f', 'mp4',
    tempPath,
  ]);
  if (result.code !== 0) {
    console.error(result.stderr.split('\n').slice(-15).join('\n'));
    await fs.rm(tempPath, { force: true }).catch(() => {});
    return false;
  }
  await replaceFileAtomically(tempPath, targetPath);
  return true;
}

async function main(): Promise<void> {
  console.log('bloeki Snippet-Cutter\n');
  const options = await promptOptions();
  if (!Number.isFinite(options.startSeconds) || options.startSeconds < 0) {
    throw new Error('--start muss eine Zahl groesser oder gleich 0 sein');
  }
  if (!Number.isFinite(options.lengthSeconds) || options.lengthSeconds < 1) {
    throw new Error('--length muss eine Zahl groesser oder gleich 1 sein');
  }
  if (!Number.isInteger(options.maxHeight) || options.maxHeight < 240) {
    throw new Error('--max-height muss eine ganze Zahl groesser oder gleich 240 sein');
  }

  console.log(`\nScanne ${options.sourceDir} ...`);
  const files = await listSourceFiles(options.sourceDir);
  console.log(`${files.length} Datei(en) mit passender Endung gefunden.\n`);

  await fs.mkdir(options.targetDir, { recursive: true }).catch(() => {
    // Zielordner kann bereits existieren oder ein Netzwerkpfad sein, der
    // kein mkdir erlaubt (z.B. schreibgeschuetzte Freigabe-Wurzel) - der
    // eigentliche Schreibversuch weiter unten liefert in diesem Fall den
    // aussagekraeftigeren Fehler.
  });

  let scanned = 0;
  let cut = 0;
  let skippedExisting = 0;
  let failed = 0;
  const unmatched: string[] = [];

  for (const entry of files) {
    scanned += 1;
    const stem = path.basename(entry.basename, path.extname(entry.basename));
    const parsed = parseTrailerFilename(stem);
    if (!parsed) {
      unmatched.push(entry.basename);
      continue;
    }

    const targetName = `${buildTrailerFilenameStem(parsed)}.mp4`;
    const targetPath = path.join(options.targetDir, targetName);

    const alreadyExists = await fs
      .access(targetPath)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists && !options.reencodeExisting) {
      skippedExisting += 1;
      console.log(`[uebersprungen] ${targetName} existiert bereits`);
      continue;
    }

    const duration = await probeDurationSeconds(entry.sourcePath);
    if (duration === null || duration < 5) {
      failed += 1;
      unmatched.push(`${entry.basename} (ffprobe fehlgeschlagen oder Datei < 5s)`);
      console.warn(`[uebersprungen] ${entry.basename}: Dauer nicht ermittelbar oder zu kurz`);
      continue;
    }

    // Startpunkt = angegebene Startsekunde, ausser die Restdauer reicht
    // nicht - dann Startpunkt = max(0, duration - length), damit der
    // Ausschnitt trotzdem so lang wie moeglich (bis zu `length`) wird statt
    // einfach zu scheitern.
    const start =
      duration < options.startSeconds + options.lengthSeconds
        ? Math.max(0, duration - options.lengthSeconds)
        : options.startSeconds;

    const action = alreadyExists ? 'neu codieren' : 'schneide';
    console.log(`[${action}] ${entry.basename} -> ${targetName} (ab ${start.toFixed(1)}s, ${options.lengthSeconds}s, max. ${options.maxHeight}p)`);
    const ok = await cutClip(entry.sourcePath, targetPath, start, options.lengthSeconds, options.maxHeight);
    if (ok) {
      cut += 1;
    } else {
      failed += 1;
      console.error(`[fehlgeschlagen] ffmpeg-Fehler bei ${entry.basename}`);
    }
  }

  console.log('\n--- Zusammenfassung ---');
  console.log(`Gescannt:            ${scanned}`);
  console.log(`Neu geschnitten:     ${cut}`);
  console.log(`Uebersprungen:       ${skippedExisting} (bereits vorhanden)`);
  console.log(`Fehlgeschlagen:      ${failed}`);
  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} Datei(en) ohne passendes Namensmuster oder mit Problemen:`);
    for (const name of unmatched) console.log(`  - ${name}`);
  }
}

main().catch((err) => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
