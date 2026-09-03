namespace TrailerRenamerGui;

public enum FileItemStatus { Pending, Renamed, Skipped }

/// <summary>Ein Trailer im eingelesenen Ordner samt aktuellem Bearbeitungsstand.
/// CurrentTitle/CurrentYear werden bei jedem Wechsel der Auswahl aus den
/// Eingabefeldern zurueckgeschrieben, damit Korrekturen beim Hin- und
/// Herspringen zwischen Dateien nicht verlorengehen.</summary>
public sealed class FileItem
{
    public required string FullPath { get; set; }
    public required string FileName { get; init; }
    public FileItemStatus Status { get; set; } = FileItemStatus.Pending;
    public string CurrentTitle { get; set; } = "";
    public int? CurrentYear { get; set; }

    public override string ToString()
    {
        var marker = Status switch
        {
            FileItemStatus.Renamed => "✓ ",
            FileItemStatus.Skipped => "– ",
            _ => "○ ",
        };
        return marker + FileName;
    }
}
