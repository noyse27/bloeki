using System.Text.RegularExpressions;

namespace TrailerRenamerGui;

public sealed record TitleYearGuess(string Title, int? Year);

/// <summary>Erraet Filmtitel (und wenn moeglich Jahr) aus typischen
/// Trailer-Dateinamen, wie sie auf diversen Video-Plattformen ueblich sind -
/// z.B. "Alter Kahn und junge Liebe ≣ 1973 ≣ Trailer.mkv" oder
/// "Hasenherz - DEFA-Trailer.mkv". Rein heuristisch: liefert einen
/// Startpunkt, den der User in der GUI vor der TMDB-Suche noch korrigieren
/// kann.</summary>
public static partial class FilenameGuesser
{
    // "Titel ≣ Jahr ≣ Trailer" (oder Varianten ohne Jahr/mit anderem
    // Suffix als "Trailer") - Trennzeichen ist ein U+2263 (STRICTLY
    // EQUIVALENT TO), das manche Trailer-Kanäle als Feldtrenner nutzen.
    [GeneratedRegex(@"^\s*(?<title>.+?)\s*≣\s*(?<year>\d{4})\s*≣.*$")]
    private static partial Regex EqualsDelimited();

    // Ein 4-stelliges Jahr (1900-2099) irgendwo im Namen, in Klammern,
    // eckigen Klammern oder frei zwischen Trennern stehend.
    [GeneratedRegex(@"[\(\[]?(?<year>19\d{2}|20\d{2})[\)\]]?")]
    private static partial Regex YearAnywhere();

    // Uebliche Suffixe, die Trailer-Kanaele an den Filmtitel anhaengen,
    // z.B. " - DEFA-Trailer", " – Trailer", " (Trailer)", " Official Trailer".
    [GeneratedRegex(@"[\s\-–_]*[\(\[]?(?:offizieller?\s+|official\s+|deutscher?\s+|german\s+|hd\s+|defa-)*trailer[s]?\b.*$", RegexOptions.IgnoreCase)]
    private static partial Regex TrailerSuffix();

    private static readonly char[] SeparatorTrimChars = { ' ', '-', '–', '_', '.', ',', '≣', '(', ')', '[', ']' };

    public static TitleYearGuess Guess(string filenameWithoutExt)
    {
        var input = filenameWithoutExt.Trim();

        var equalsMatch = EqualsDelimited().Match(input);
        if (equalsMatch.Success)
        {
            var title = CleanTitle(equalsMatch.Groups["title"].Value);
            var year = int.Parse(equalsMatch.Groups["year"].Value);
            return new TitleYearGuess(title, year);
        }

        int? foundYear = null;
        var yearMatch = YearAnywhere().Match(input);
        var withoutYear = input;
        if (yearMatch.Success)
        {
            foundYear = int.Parse(yearMatch.Groups["year"].Value);
            withoutYear = input.Remove(yearMatch.Index, yearMatch.Length);
        }

        var withoutSuffix = TrailerSuffix().Replace(withoutYear, "");
        var cleaned = CleanTitle(withoutSuffix);
        if (cleaned.Length == 0) cleaned = CleanTitle(withoutYear);
        if (cleaned.Length == 0) cleaned = input;

        return new TitleYearGuess(cleaned, foundYear);
    }

    private static string CleanTitle(string s) => s.Trim().Trim(SeparatorTrimChars).Trim();

    private static readonly char[] InvalidFilenameChars = Path.GetInvalidFileNameChars();

    /// <summary>Ersetzt Zeichen, die in Windows-Dateinamen nicht erlaubt sind
    /// (z.B. der Doppelpunkt in "Mission: Impossible"), durch einen
    /// verträglichen Ersatz, ohne den Titel unkenntlich zu machen.</summary>
    public static string SanitizeForFilename(string title)
    {
        var sb = new System.Text.StringBuilder(title.Length);
        foreach (var c in title)
        {
            if (c == ':') { sb.Append(" -"); continue; }
            sb.Append(Array.IndexOf(InvalidFilenameChars, c) >= 0 ? '_' : c);
        }
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }
}
