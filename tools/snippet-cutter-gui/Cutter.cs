using System.Diagnostics;
using System.Text.Json;

namespace SnippetCutterGui;

public sealed record CutterOptions(string SourceDir, string TargetDir, double StartSeconds, double LengthSeconds);

public sealed record CutterSummary(int Scanned, int Cut, int SkippedExisting, int Failed, IReadOnlyList<string> Unmatched);

public sealed class CutterProgress
{
    public required string Message { get; init; }
    public int Scanned { get; init; }
    public int Total { get; init; }
}

// C#-Portierung der Kernlogik aus tools/snippet-cutter/src/index.ts - siehe
// dort fuer die ausfuehrliche Begruendung (Nur-Hinzufuegen-Prinzip, atomares
// Schreiben ueber eine .part-Temp-Datei, expliziter -f mp4-Muxer wegen der
// .part-Endung, Start-Anpassung bei zu kurzen Quelltrailern). Diese GUI-
// Variante ist bewusst ein eigenstaendiges .NET-Projekt neben der CLI, nicht
// deren Ersatz - siehe tools/snippet-cutter-gui/README.md.
public static class Cutter
{
    private static readonly HashSet<string> SourceExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".mkv", ".mov",
    };

    public static async Task<CutterSummary> RunAsync(
        CutterOptions options,
        IProgress<CutterProgress> progress,
        CancellationToken cancellationToken)
    {
        var files = Directory.Exists(options.SourceDir)
            ? Directory.EnumerateFiles(options.SourceDir, "*", SearchOption.AllDirectories)
                .Where(f => SourceExtensions.Contains(Path.GetExtension(f)))
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : new List<string>();

        progress.Report(new CutterProgress { Message = $"{files.Count} Datei(en) mit passender Endung gefunden.", Total = files.Count });

        Directory.CreateDirectory(options.TargetDir);

        int scanned = 0, cut = 0, skippedExisting = 0, failed = 0;
        var unmatched = new List<string>();

        foreach (var sourcePath in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            scanned++;
            var basename = Path.GetFileName(sourcePath);
            var stem = Path.GetFileNameWithoutExtension(sourcePath);
            var parsed = TrailerFilename.Parse(stem);
            if (parsed is null)
            {
                unmatched.Add(basename);
                progress.Report(new CutterProgress { Message = $"[kein Muster] {basename}", Scanned = scanned, Total = files.Count });
                continue;
            }

            var targetName = TrailerFilename.BuildStem(parsed) + ".mp4";
            var targetPath = Path.Combine(options.TargetDir, targetName);

            if (File.Exists(targetPath))
            {
                skippedExisting++;
                progress.Report(new CutterProgress { Message = $"[übersprungen] {targetName} existiert bereits", Scanned = scanned, Total = files.Count });
                continue;
            }

            var duration = await ProbeDurationSecondsAsync(sourcePath, cancellationToken);
            if (duration is null || duration < 5)
            {
                failed++;
                unmatched.Add($"{basename} (ffprobe fehlgeschlagen oder Datei < 5s)");
                progress.Report(new CutterProgress { Message = $"[übersprungen] {basename}: Dauer nicht ermittelbar oder zu kurz", Scanned = scanned, Total = files.Count });
                continue;
            }

            var start = duration < options.StartSeconds + options.LengthSeconds
                ? Math.Max(0, duration.Value - options.LengthSeconds)
                : options.StartSeconds;

            progress.Report(new CutterProgress
            {
                Message = $"[schneide] {basename} -> {targetName} (ab {start:0.0}s, {options.LengthSeconds:0.#}s)",
                Scanned = scanned,
                Total = files.Count,
            });

            var (ok, stderrTail) = await CutClipAsync(sourcePath, targetPath, start, options.LengthSeconds, cancellationToken);
            if (ok)
            {
                cut++;
            }
            else
            {
                failed++;
                progress.Report(new CutterProgress { Message = $"[fehlgeschlagen] ffmpeg-Fehler bei {basename}:\n{stderrTail}", Scanned = scanned, Total = files.Count });
            }
        }

        return new CutterSummary(scanned, cut, skippedExisting, failed, unmatched);
    }

    /// <summary>Prueft, ob ffmpeg/ffprobe im PATH auffindbar und ausfuehrbar sind.</summary>
    public static async Task<(bool ok, string message)> CheckFfmpegAvailableAsync()
    {
        foreach (var exe in new[] { "ffmpeg", "ffprobe" })
        {
            try
            {
                using var proc = Process.Start(new ProcessStartInfo(exe, "-version")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
                if (proc is null) return (false, $"{exe} konnte nicht gestartet werden.");
                await proc.WaitForExitAsync();
                if (proc.ExitCode != 0) return (false, $"{exe} -version endete mit Fehlercode {proc.ExitCode}.");
            }
            catch (Exception ex)
            {
                return (false, $"{exe} ist nicht im PATH auffindbar ({ex.Message}). Bitte ffmpeg installieren und sicherstellen, dass ffmpeg.exe/ffprobe.exe im PATH liegen.");
            }
        }
        return (true, "ffmpeg/ffprobe gefunden.");
    }

    private static async Task<double?> ProbeDurationSecondsAsync(string sourcePath, CancellationToken cancellationToken)
    {
        var (code, stdout, _) = await RunProcessAsync(
            "ffprobe",
            ["-v", "error", "-show_entries", "format=duration", "-of", "json", sourcePath],
            cancellationToken);
        if (code != 0) return null;
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            if (doc.RootElement.TryGetProperty("format", out var format)
                && format.TryGetProperty("duration", out var durationEl)
                && double.TryParse(durationEl.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var duration))
            {
                return duration;
            }
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task<(bool ok, string stderrTail)> CutClipAsync(
        string sourcePath, string targetPath, double start, double length, CancellationToken cancellationToken)
    {
        // Siehe index.ts's cutClip(): temporaere .part-Datei, erst bei Erfolg
        // auf den finalen Namen umbenannt (atomar, keine Halbschnitt-
        // Fehlerkennungen bei einem abgebrochenen Lauf). -f mp4 ist noetig,
        // weil ffmpeg das Format sonst aus der (hier ".part"-) Endung raet.
        var tempPath = targetPath + ".part";
        try { File.Delete(tempPath); } catch { /* egal, existiert vermutlich nicht */ }

        var (code, _, stderr) = await RunProcessAsync(
            "ffmpeg",
            [
                "-y",
                "-ss", start.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "-i", sourcePath,
                "-t", length.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-c:a", "aac",
                "-movflags", "+faststart",
                "-f", "mp4",
                tempPath,
            ],
            cancellationToken);

        if (code != 0)
        {
            try { File.Delete(tempPath); } catch { /* egal */ }
            var lines = stderr.Split('\n');
            var tail = string.Join('\n', lines.Skip(Math.Max(0, lines.Length - 15)));
            return (false, tail);
        }

        File.Move(tempPath, targetPath, overwrite: true);
        return (true, "");
    }

    private static async Task<(int code, string stdout, string stderr)> RunProcessAsync(
        string fileName, IEnumerable<string> args, CancellationToken cancellationToken)
    {
        var psi = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = new Process { StartInfo = psi };
        proc.Start();
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = proc.StandardError.ReadToEndAsync(cancellationToken);

        using (cancellationToken.Register(() =>
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* egal */ }
        }))
        {
            await proc.WaitForExitAsync(cancellationToken);
        }

        return (proc.ExitCode, await stdoutTask, await stderrTask);
    }
}
