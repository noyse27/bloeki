using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;

namespace TrailerRenamerGui;

public sealed record TmdbMatch(int Id, string Title, string? OriginalTitle, int? Year, string? ImdbId, IReadOnlyList<string> Countries);

/// <summary>Duenner Client fuer die TMDB-v3-API - nur die zwei Endpunkte, die
/// dieses Tool braucht (Filmsuche + Details inkl. externer IDs). Ein API-Key
/// unter https://www.themoviedb.org/settings/api anlegen (kostenlos).</summary>
public sealed class TmdbClient(string apiKey) : IDisposable
{
    private readonly HttpClient _http = new() { BaseAddress = new Uri("https://api.themoviedb.org/3/") };

    /// <summary>Sucht nach Filmen und laedt fuer jeden Treffer direkt die
    /// Details nach (IMDb-ID, Produktionsland) - die Trefferliste ist in der
    /// Praxis klein genug (TMDB liefert max. 20 pro Seite, wir zeigen ohnehin
    /// nur die ersten paar), dass die zusaetzlichen Requests nicht ins
    /// Gewicht fallen.</summary>
    public async Task<IReadOnlyList<TmdbMatch>> SearchAsync(string title, int? year, CancellationToken ct)
    {
        var matches = await SearchRawAsync(title, year, ct);
        if (matches.Count > 0) return matches;

        // TMDBs Suchindex matcht Umlaute manchmal schlechter als die
        // diakritikfreie Schreibweise (z.B. "Übermorgen" liefert 0 Treffer,
        // "Ubermorgen" findet denselben Film trotzdem - beobachtet, nicht
        // dokumentiert, aber reproduzierbar). Bei 0 Treffern automatisch
        // einen zweiten Versuch ohne Diakritika starten, bevor wir dem User
        // "keine Treffer" melden.
        var stripped = RemoveDiacritics(title);
        if (stripped == title) return matches;
        return await SearchRawAsync(stripped, year, ct);
    }

    private async Task<IReadOnlyList<TmdbMatch>> SearchRawAsync(string title, int? year, CancellationToken ct)
    {
        var url = $"search/movie?api_key={Uri.EscapeDataString(apiKey)}&language=de-DE&query={Uri.EscapeDataString(title)}";
        if (year is { } y) url += $"&year={y}";

        var response = await _http.GetFromJsonAsync<TmdbSearchResponse>(url, ct)
            ?? throw new InvalidOperationException("TMDB hat eine leere Antwort geliefert.");

        var results = response.Results.Take(8).ToList();
        var matches = new List<TmdbMatch>(results.Count);
        foreach (var r in results)
        {
            ct.ThrowIfCancellationRequested();
            matches.Add(await LoadDetailsAsync(r, ct));
        }
        return matches;
    }

    private static string RemoveDiacritics(string s)
    {
        var normalized = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        }
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    private async Task<TmdbMatch> LoadDetailsAsync(TmdbSearchResultItem item, CancellationToken ct)
    {
        var url = $"movie/{item.Id}?api_key={Uri.EscapeDataString(apiKey)}&language=de-DE&append_to_response=external_ids";
        try
        {
            var details = await _http.GetFromJsonAsync<TmdbMovieDetails>(url, ct);
            var year = ParseYear(item.ReleaseDate ?? details?.ReleaseDate);
            var countries = details?.ProductionCountries?.Select(c => c.Name).ToList() ?? new List<string>();
            return new TmdbMatch(item.Id, item.Title, item.OriginalTitle, year, details?.ExternalIds?.ImdbId, countries);
        }
        catch (HttpRequestException)
        {
            // Detailabruf fuer einen einzelnen Treffer fehlgeschlagen (z.B.
            // Netzwerk-Hickup) - lieber den Treffer ohne Land/IMDb-ID
            // anzeigen als die ganze Suche abzubrechen; der User kann die
            // IMDb-ID im Zweifel manuell eintragen.
            return new TmdbMatch(item.Id, item.Title, item.OriginalTitle, ParseYear(item.ReleaseDate), null, Array.Empty<string>());
        }
    }

    private static int? ParseYear(string? releaseDate) =>
        !string.IsNullOrEmpty(releaseDate) && releaseDate.Length >= 4 && int.TryParse(releaseDate[..4], out var y) ? y : null;

    public void Dispose() => _http.Dispose();

    private sealed record TmdbSearchResponse([property: JsonPropertyName("results")] List<TmdbSearchResultItem> Results);

    private sealed record TmdbSearchResultItem(
        [property: JsonPropertyName("id")] int Id,
        [property: JsonPropertyName("title")] string Title,
        [property: JsonPropertyName("original_title")] string? OriginalTitle,
        [property: JsonPropertyName("release_date")] string? ReleaseDate);

    private sealed record TmdbMovieDetails(
        [property: JsonPropertyName("release_date")] string? ReleaseDate,
        [property: JsonPropertyName("production_countries")] List<TmdbCountry>? ProductionCountries,
        [property: JsonPropertyName("external_ids")] TmdbExternalIds? ExternalIds);

    private sealed record TmdbCountry([property: JsonPropertyName("name")] string Name);

    private sealed record TmdbExternalIds([property: JsonPropertyName("imdb_id")] string? ImdbId);
}
