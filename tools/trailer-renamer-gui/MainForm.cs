namespace TrailerRenamerGui;

public sealed class MainForm : Form
{
    private static readonly string[] VideoExtensions = { ".mkv", ".mp4", ".avi", ".mov", ".webm", ".wmv", ".m4v", ".ts" };

    private readonly Settings _settings = Settings.Load();

    private readonly TextBox _folderBox = new() { ReadOnly = true };
    private readonly ListBox _fileList = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    private readonly TextBox _origNameBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly TextBox _titleBox = new() { Dock = DockStyle.Fill };
    private readonly TextBox _yearBox = new() { Width = 80 };
    private readonly DataGridView _resultsGrid = BuildResultsGrid();
    private readonly List<TmdbMatch> _currentMatches = new();
    private readonly TextBox _manualImdbBox = new() { Width = 140, PlaceholderText = "tt1234567" };
    private readonly TextBox _manualYearBox = new() { Width = 70, PlaceholderText = "Jahr" };
    private readonly Label _statusLabel = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Text = "Bereit." };
    private readonly Button _searchButton = new() { Text = "Bei TMDB suchen", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2) };
    private readonly Button _useResultButton = new() { Text = "Treffer übernehmen && umbenennen", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2), Enabled = false };
    private readonly Button _manualRenameButton = new() { Text = "Manuell umbenennen", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2) };
    private readonly Button _skipButton = new() { Text = "Überspringen", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2) };
    private readonly Button _autoAdvanceButton = new() { Text = "Start", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(14, 3, 14, 3) };

    private bool _autoAdvance;

    // Panel1MinSize/Panel2MinSize bewusst NICHT hier gesetzt: der
    // SplitContainer hat zu diesem Zeitpunkt noch seine Default-Breite
    // (150px), kleiner als die Summe der Mindestgroessen - das wirft beim
    // Setzen sofort eine InvalidOperationException. Beides wird stattdessen
    // in OnLoad gesetzt, wenn die tatsaechliche, fertig skalierte Breite
    // bekannt ist.
    private readonly SplitContainer _split = new() { Dock = DockStyle.Fill };

    private FileItem? _current;
    private bool _suppressSelectionSideEffects;

    public MainForm()
    {
        Text = "blöki Trailer-Renamer";
        Width = 1200;
        Height = 780;
        MinimumSize = new Size(960, 620);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(12) };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        root.Controls.Add(BuildFolderRow(), 0, 0);
        root.Controls.Add(BuildSplit(), 0, 1);
        root.Controls.Add(_statusLabel, 0, 2);
        Controls.Add(root);

        _fileList.SelectedIndexChanged += OnFileSelected;
        _searchButton.Click += (_, _) => _ = RunSearchAsync();
        _useResultButton.Click += OnUseResultClicked;
        _manualRenameButton.Click += OnManualRenameClicked;
        _skipButton.Click += (_, _) => SkipCurrentFile();
        _autoAdvanceButton.Click += OnAutoAdvanceClicked;
        _resultsGrid.SelectionChanged += (_, _) => _useResultButton.Enabled = _resultsGrid.SelectedRows.Count > 0;
        _resultsGrid.CellDoubleClick += (_, args) => { if (args.RowIndex >= 0) OnUseResultClicked(null, EventArgs.Empty); };
        _titleBox.TextChanged += (_, _) => { if (_current != null && !_suppressSelectionSideEffects) _current.CurrentTitle = _titleBox.Text; };
        _yearBox.TextChanged += (_, _) => { if (_current != null && !_suppressSelectionSideEffects) _current.CurrentYear = int.TryParse(_yearBox.Text, out var y) ? y : null; };

        SetDetailEnabled(false);
    }

    private Control BuildFolderRow()
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, AutoSize = true, Margin = new Padding(0, 0, 0, 8) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        panel.Controls.Add(new Label { Text = "Ordner:", AutoSize = true, Anchor = AnchorStyles.Left, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 6, 8, 0) }, 0, 0);
        _folderBox.Dock = DockStyle.Fill;
        _folderBox.Margin = new Padding(0, 3, 8, 3);
        panel.Controls.Add(_folderBox, 1, 0);

        var browseButton = new Button { Text = "Durchsuchen…", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2) };
        browseButton.Click += OnBrowseFolder;
        panel.Controls.Add(browseButton, 2, 0);

        var apiKeyButton = new Button { Text = "TMDB-API-Key…", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 2, 10, 2), Margin = new Padding(8, 0, 0, 0) };
        apiKeyButton.Click += (_, _) => EnsureApiKey(forcePrompt: true);
        panel.Controls.Add(apiKeyButton, 3, 0);
        return panel;
    }

    private static DataGridView BuildResultsGrid()
    {
        var grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            RowHeadersVisible = false,
            MultiSelect = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            BackgroundColor = SystemColors.Window,
            BorderStyle = BorderStyle.FixedSingle,
        };
        grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Title", HeaderText = "Titel", FillWeight = 130 });
        grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "OriginalTitle", HeaderText = "Originaltitel", FillWeight = 130 });
        grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Year", HeaderText = "Jahr", AutoSizeMode = DataGridViewAutoSizeColumnMode.None, Width = 55 });
        grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Country", HeaderText = "Land", AutoSizeMode = DataGridViewAutoSizeColumnMode.None, Width = 140 });
        return grid;
    }

    private Control BuildSplit()
    {
        var leftPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1 };
        leftPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        leftPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var toolRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 0, 0, 6) };
        toolRow.Controls.Add(_autoAdvanceButton);
        toolRow.Controls.Add(new Label
        {
            Text = "Automatisch die nächste offene Datei suchen, nachdem ein Treffer übernommen oder übersprungen wurde.",
            AutoSize = true,
            MaximumSize = new Size(220, 0),
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(8, 6, 0, 0),
        });
        leftPanel.Controls.Add(toolRow, 0, 0);
        leftPanel.Controls.Add(_fileList, 0, 1);

        _split.Panel1.Controls.Add(leftPanel);
        _split.Panel2.Controls.Add(BuildDetailPanel());
        return _split;
    }

    // SplitterDistance laesst sich nicht zuverlaessig im Konstruktor setzen:
    // AutoScaleMode.Dpi skaliert die Fensterbreite und die Distanz beim
    // ersten Layout nicht proportional zueinander (bei hoher Text-/DPI-
    // Skalierung schrumpfte dadurch das rechte Detailpanel auf wenige
    // Prozent der Fensterbreite). Stattdessen erst setzen, wenn die Form
    // ihre endgueltige, bereits skalierte Groesse kennt.
    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        _split.SplitterDistance = Math.Max(260, (int)(_split.Width * 0.28));
        _split.Panel1MinSize = 260;
        _split.Panel2MinSize = 460;
    }

    private Control BuildDetailPanel()
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(12, 0, 0, 0) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        panel.Controls.Add(LabeledRow("Original-Dateiname:", _origNameBox), 0, 0);
        panel.Controls.Add(LabeledRow("Erkannter Titel:", _titleBox), 0, 1);

        var yearRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 0, 0, 8) };
        yearRow.Controls.Add(new Label { Text = "Jahr (optional):", AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 6, 8, 0) });
        _yearBox.Margin = new Padding(0, 3, 0, 3);
        yearRow.Controls.Add(_yearBox);
        panel.Controls.Add(yearRow, 0, 2);

        var searchRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 0, 0, 8) };
        searchRow.Controls.Add(_searchButton);
        panel.Controls.Add(searchRow, 0, 3);

        var resultsGroup = new GroupBox { Text = "TMDB-Treffer (Titel, Jahr, Land)", Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8) };
        var resultsInner = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(8) };
        resultsInner.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        resultsInner.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        resultsInner.Controls.Add(_resultsGrid, 0, 0);
        var useResultRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 6, 0, 0) };
        useResultRow.Controls.Add(_useResultButton);
        resultsInner.Controls.Add(useResultRow, 0, 1);
        resultsGroup.Controls.Add(resultsInner);
        panel.Controls.Add(resultsGroup, 0, 4);

        var manualGroup = new GroupBox { Text = "Manuell (kein passender Treffer)", Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0, 0, 0, 8) };
        var manualInner = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(8) };
        manualInner.Controls.Add(new Label
        {
            Text = "Titel oben kopieren, selbst in der IMDb suchen, dann IMDb-ID und Jahr eintragen:",
            AutoSize = true,
            MaximumSize = new Size(360, 0),
            Margin = new Padding(0, 0, 0, 6),
        });
        var manualRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0) };
        manualRow.Controls.Add(new Label { Text = "IMDb-ID:", AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 6, 4, 0) });
        _manualImdbBox.Margin = new Padding(0, 3, 16, 3);
        manualRow.Controls.Add(_manualImdbBox);
        manualRow.Controls.Add(new Label { Text = "Jahr:", AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 6, 4, 0) });
        _manualYearBox.Margin = new Padding(0, 3, 16, 3);
        manualRow.Controls.Add(_manualYearBox);
        manualRow.Controls.Add(_manualRenameButton);
        manualInner.Controls.Add(manualRow);
        manualGroup.Controls.Add(manualInner);
        panel.Controls.Add(manualGroup, 0, 5);

        panel.Controls.Add(new Panel(), 0, 6);

        var bottomRow = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft };
        bottomRow.Controls.Add(_skipButton);
        panel.Controls.Add(bottomRow, 0, 7);

        return panel;
    }

    // Dock=Fill (statt nur AutoSize) ist hier entscheidend: eine
    // AutoSize-TableLayoutPanel richtet sich nach der Mindestbreite ihres
    // Inhalts und wird von der Elternzelle nicht in die Breite gezogen -
    // das Eingabefeld blieb dadurch winzig, egal wie breit das Detailpanel
    // tatsaechlich war.
    private static Control LabeledRow(string labelText, Control field)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.Controls.Add(new Label { Text = labelText, AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 6, 8, 0) }, 0, 0);
        field.Margin = new Padding(0, 3, 0, 3);
        panel.Controls.Add(field, 1, 0);
        return panel;
    }

    private void OnBrowseFolder(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog { Description = "Ordner mit den noch nicht umbenannten Trailern wählen" };
        if (Directory.Exists(_folderBox.Text)) dialog.SelectedPath = _folderBox.Text;
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        _folderBox.Text = dialog.SelectedPath;
        LoadFolder(dialog.SelectedPath);
    }

    private void LoadFolder(string folder)
    {
        var videoFiles = Directory.EnumerateFiles(folder)
            .Where(f => VideoExtensions.Contains(Path.GetExtension(f), StringComparer.OrdinalIgnoreCase))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Dateien, die schon dem blöki-Schema entsprechen, sind bereits
        // fertig - nur die restlichen tauchen in der Liste auf, damit man
        // beim erneuten Einlesen eines Ordners nicht wieder bei null anfängt.
        var alreadyNamedCount = videoFiles.Count(f => BlokiFilename.IsAlreadyNamed(Path.GetFileNameWithoutExtension(f)));
        var files = videoFiles
            .Where(f => !BlokiFilename.IsAlreadyNamed(Path.GetFileNameWithoutExtension(f)))
            .Select(f =>
            {
                var name = Path.GetFileName(f);
                var stem = Path.GetFileNameWithoutExtension(f);
                var guess = FilenameGuesser.Guess(stem);
                return new FileItem { FullPath = f, FileName = name, CurrentTitle = guess.Title, CurrentYear = guess.Year };
            })
            .ToList();

        _fileList.Items.Clear();
        foreach (var item in files) _fileList.Items.Add(item);
        _statusLabel.Text = alreadyNamedCount > 0
            ? $"{files.Count} Video-Datei(en) gefunden ({alreadyNamedCount} bereits im blöki-Schema, ausgeblendet)."
            : $"{files.Count} Video-Datei(en) gefunden.";
        SetDetailEnabled(files.Count > 0);
        if (files.Count > 0) _fileList.SelectedIndex = 0;
    }

    private void RefreshList()
    {
        var selected = _fileList.SelectedIndex;
        // ListBox aktualisiert die angezeigten ToString()-Werte nicht von
        // selbst, wenn sich das zugrundeliegende Objekt aendert - Trick:
        // BeginUpdate/EndUpdate erzwingt ein Neuzeichnen aller Items.
        _fileList.BeginUpdate();
        _fileList.EndUpdate();
        _fileList.Invalidate();
        if (selected >= 0) _fileList.SelectedIndex = selected;
    }

    private void OnFileSelected(object? sender, EventArgs e)
    {
        _current = _fileList.SelectedItem as FileItem;
        _currentMatches.Clear();
        _resultsGrid.Rows.Clear();
        _useResultButton.Enabled = false;
        _manualImdbBox.Text = "";

        _suppressSelectionSideEffects = true;
        _origNameBox.Text = _current?.FileName ?? "";
        _titleBox.Text = _current?.CurrentTitle ?? "";
        _yearBox.Text = _current?.CurrentYear?.ToString() ?? "";
        _manualYearBox.Text = _current?.CurrentYear?.ToString() ?? "";
        _suppressSelectionSideEffects = false;
    }

    private bool SelectNextPending()
    {
        for (var i = 0; i < _fileList.Items.Count; i++)
        {
            if (((FileItem)_fileList.Items[i]!).Status == FileItemStatus.Pending)
            {
                _fileList.SelectedIndex = i;
                return true;
            }
        }
        return false;
    }

    private void SkipCurrentFile()
    {
        if (_current == null) return;
        _current.Status = FileItemStatus.Skipped;
        RefreshList();
        AdvanceAfterProcessing();
    }

    /// <summary>Nach "Treffer übernehmen" oder "Überspringen": springt zur
    /// naechsten offenen Datei und stoesst im Automatik-Modus (Start-Button)
    /// gleich die naechste TMDB-Suche an, ohne dass der User jedes Mal
    /// erneut auf "Bei TMDB suchen" klicken muss.</summary>
    private void AdvanceAfterProcessing()
    {
        var hasNext = SelectNextPending();
        if (!_autoAdvance) return;
        if (!hasNext)
        {
            _autoAdvance = false;
            _autoAdvanceButton.Text = "Start";
            _statusLabel.Text = "Alle Dateien bearbeitet.";
            return;
        }
        _ = RunSearchAsync();
    }

    private void OnAutoAdvanceClicked(object? sender, EventArgs e)
    {
        _autoAdvance = !_autoAdvance;
        _autoAdvanceButton.Text = _autoAdvance ? "Automatik läuft (Stop)" : "Start";
        if (!_autoAdvance) return;

        if (_current == null || _current.Status != FileItemStatus.Pending)
        {
            if (!SelectNextPending())
            {
                _autoAdvance = false;
                _autoAdvanceButton.Text = "Start";
                _statusLabel.Text = "Keine offenen Dateien mehr.";
                return;
            }
        }
        _ = RunSearchAsync();
    }

    private void SetDetailEnabled(bool enabled)
    {
        _titleBox.Enabled = enabled;
        _yearBox.Enabled = enabled;
        _searchButton.Enabled = enabled;
        _manualRenameButton.Enabled = enabled;
        _skipButton.Enabled = enabled;
        _autoAdvanceButton.Enabled = enabled;
    }

    /// <summary>Fragt den TMDB-API-Key ab, falls noch keiner hinterlegt ist
    /// (oder wenn explizit ueber den Button verlangt), und speichert ihn
    /// dauerhaft in %AppData%.</summary>
    private bool EnsureApiKey(bool forcePrompt)
    {
        if (!forcePrompt && !string.IsNullOrWhiteSpace(_settings.TmdbApiKey)) return true;

        using var prompt = new PromptForm(
            "TMDB-API-Key",
            "API-Key (v3 \"API Key\") von https://www.themoviedb.org/settings/api eintragen:",
            _settings.TmdbApiKey);
        if (prompt.ShowDialog(this) != DialogResult.OK || string.IsNullOrWhiteSpace(prompt.Value))
            return !string.IsNullOrWhiteSpace(_settings.TmdbApiKey);

        _settings.TmdbApiKey = prompt.Value;
        _settings.Save();
        return true;
    }

    private async Task RunSearchAsync()
    {
        if (_current == null) return;
        if (!EnsureApiKey(forcePrompt: false)) return;

        var title = _titleBox.Text.Trim();
        if (title.Length == 0)
        {
            MessageBox.Show(this, "Bitte einen Titel eingeben.", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        int? year = int.TryParse(_yearBox.Text, out var y) ? y : null;

        _searchButton.Enabled = false;
        _currentMatches.Clear();
        _resultsGrid.Rows.Clear();
        _statusLabel.Text = $"Suche „{title}“ bei TMDB…";
        try
        {
            using var client = new TmdbClient(_settings.TmdbApiKey);
            var matches = await client.SearchAsync(title, year, CancellationToken.None);
            foreach (var m in matches)
            {
                _currentMatches.Add(m);
                _resultsGrid.Rows.Add(
                    m.Title,
                    m.OriginalTitle ?? "",
                    m.Year?.ToString() ?? "?",
                    m.Countries.Count > 0 ? string.Join(", ", m.Countries) : "?");
            }
            _statusLabel.Text = matches.Count == 0
                ? "Keine Treffer bei TMDB. Titel manuell in der IMDb suchen und unten eintragen."
                : $"{matches.Count} Treffer gefunden.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "TMDB-Suche fehlgeschlagen: " + ex.Message, "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Error);
            _statusLabel.Text = "Fehler bei der TMDB-Suche.";
        }
        finally
        {
            _searchButton.Enabled = true;
        }
    }

    private void OnUseResultClicked(object? sender, EventArgs e)
    {
        if (_current == null || _resultsGrid.SelectedRows.Count == 0) return;
        var match = _currentMatches[_resultsGrid.SelectedRows[0].Index];

        if (match.Year is null)
        {
            MessageBox.Show(this, "Zu diesem Treffer liefert TMDB kein Erscheinungsjahr - bitte unten IMDb-ID und Jahr eintragen und über \"Manuell umbenennen\" fortfahren.", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (string.IsNullOrWhiteSpace(match.ImdbId))
        {
            MessageBox.Show(this, "Zu diesem Treffer liefert TMDB keine IMDb-ID - bitte IMDb-ID unten manuell eintragen und über \"Manuell umbenennen\" fortfahren.", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        RenameCurrentFile(match.Title, match.Year.Value, match.ImdbId);
    }

    private void OnManualRenameClicked(object? sender, EventArgs e)
    {
        if (_current == null) return;

        var title = _titleBox.Text.Trim();
        var imdbId = _manualImdbBox.Text.Trim();
        if (title.Length == 0)
        {
            MessageBox.Show(this, "Bitte einen Titel eingeben.", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (!int.TryParse(_manualYearBox.Text, out var year))
        {
            MessageBox.Show(this, "Bitte ein gültiges Jahr eingeben.", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (!BlokiFilename.IsValidImdbId(imdbId))
        {
            MessageBox.Show(this, "Bitte eine gültige IMDb-ID eingeben (Format: tt1234567).", "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        RenameCurrentFile(title, year, imdbId);
    }

    private void RenameCurrentFile(string title, int year, string imdbId)
    {
        if (_current == null) return;

        var ext = Path.GetExtension(_current.FullPath);
        var newName = BlokiFilename.BuildStem(title, year, imdbId) + ext;
        var directory = Path.GetDirectoryName(_current.FullPath)!;
        var newPath = Path.Combine(directory, newName);

        if (string.Equals(newPath, _current.FullPath, StringComparison.OrdinalIgnoreCase))
        {
            _current.Status = FileItemStatus.Renamed;
            RefreshList();
            AdvanceAfterProcessing();
            return;
        }

        if (File.Exists(newPath))
        {
            using var dialog = new DuplicateFileForm($"Zieldatei existiert bereits - der Trailer scheint schon umbenannt zu sein:\n{newName}");
            if (dialog.ShowDialog(this) == DialogResult.Ignore) SkipCurrentFile();
            return;
        }

        try
        {
            File.Move(_current.FullPath, newPath);
            _current.FullPath = newPath;
            _current.Status = FileItemStatus.Renamed;
            _statusLabel.Text = $"Umbenannt zu: {newName}";
            RefreshList();
            AdvanceAfterProcessing();
        }
        catch (IOException ex)
        {
            MessageBox.Show(this, "Umbenennen fehlgeschlagen: " + ex.Message, "blöki Trailer-Renamer", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
