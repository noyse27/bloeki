using System.Text.RegularExpressions;

namespace SnippetCutterGui;

// C#-Portierung von shared/trailerFilename.ts (siehe dort fuer Details zum
// Namensmuster) - dieses GUI-Tool ist bewusst ein eigenstaendiges .NET-Projekt
// ohne Node-Laufzeitabhaengigkeit, deshalb Kopie statt Shared-Referenz. Bei
// Aenderungen am Namensmuster muss diese Datei synchron zu
// shared/trailerFilename.ts und tools/snippet-cutter/src/trailerFilename.ts
// gehalten werden.
public sealed record ParsedTrailerFilename(string Title, int Year, string ImdbId);

public static partial class TrailerFilename
{
    [GeneratedRegex(@"^trailer-(.+?)\s\((\d{4})\)\s\{imdb-id\s+(tt\d+)\}$")]
    private static partial Regex Pattern();

    /// <summary>Basename ohne Extension, z.B. "trailer-#9 (2009) {imdb-id tt0472033}".</summary>
    public static ParsedTrailerFilename? Parse(string basenameWithoutExt)
    {
        var match = Pattern().Match(basenameWithoutExt);
        if (!match.Success) return null;
        return new ParsedTrailerFilename(
            match.Groups[1].Value,
            int.Parse(match.Groups[2].Value),
            match.Groups[3].Value);
    }

    /// <summary>Baut aus den geparsten Teilen wieder exakt denselben
    /// Dateinamens-Stamm (ohne Extension).</summary>
    public static string BuildStem(ParsedTrailerFilename parsed) =>
        $"trailer-{parsed.Title} ({parsed.Year}) {{imdb-id {parsed.ImdbId}}}";
}
