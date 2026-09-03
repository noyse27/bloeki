using System.Text.Json;

namespace TrailerRenamerGui;

/// <summary>Lokale Einstellungen (aktuell nur der TMDB-API-Key). Liegen bewusst
/// in %AppData% statt im Repo/Programmordner - der Key ist ein persoenliches
/// Credential und darf nicht versehentlich committet oder mitpubliziert
/// werden.</summary>
public sealed class Settings
{
    public string TmdbApiKey { get; set; } = "";

    private static string FilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "bloeki", "trailer-renamer-gui", "settings.json");

    public static Settings Load()
    {
        try
        {
            var path = FilePath;
            if (!File.Exists(path)) return new Settings();
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<Settings>(json) ?? new Settings();
        }
        catch
        {
            // Kaputte/fehlende Settings-Datei ist kein Fehlerfall - einfach
            // mit leeren Einstellungen neu starten (API-Key-Dialog fragt dann
            // erneut).
            return new Settings();
        }
    }

    public void Save()
    {
        var path = FilePath;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(this));
    }
}
