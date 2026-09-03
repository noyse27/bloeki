using System.Text.RegularExpressions;

namespace TrailerRenamerGui;

/// <summary>Baut den blöki-Dateinamens-Stamm "trailer-Titel (Jahr) {imdb-id
/// ttXXXXXXX}" - siehe shared/trailerFilename.ts bzw.
/// tools/snippet-cutter-gui/TrailerFilename.cs fuer das Gegenstueck, das
/// diesen Namen wieder parst.</summary>
public static partial class BlokiFilename
{
    [GeneratedRegex(@"^tt\d+$")]
    private static partial Regex ImdbIdPattern();

    // Deckt sich mit tools/snippet-cutter-gui/TrailerFilename.cs - Dateien,
    // die darauf schon passen, sind bereits fertig umbenannt und muessen
    // beim Einlesen nicht nochmal angezeigt werden.
    [GeneratedRegex(@"^trailer-.+?\s\(\d{4}\)\s\{imdb-id\s+tt\d+\}$")]
    private static partial Regex AlreadyNamedPattern();

    public static bool IsValidImdbId(string imdbId) => ImdbIdPattern().IsMatch(imdbId.Trim());

    /// <summary>Prueft, ob ein Dateinamens-Stamm (ohne Extension) bereits dem
    /// blöki-Schema entspricht.</summary>
    public static bool IsAlreadyNamed(string basenameWithoutExt) => AlreadyNamedPattern().IsMatch(basenameWithoutExt);

    public static string BuildStem(string title, int year, string imdbId) =>
        $"trailer-{FilenameGuesser.SanitizeForFilename(title)} ({year}) {{imdb-id {imdbId.Trim()}}}";
}
