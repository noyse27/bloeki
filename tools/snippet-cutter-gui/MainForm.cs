namespace SnippetCutterGui;

public sealed class MainForm : Form
{
    private readonly TextBox _sourceBox = new() { ReadOnly = true };
    private readonly TextBox _targetBox = new() { ReadOnly = true };
    private readonly NumericUpDown _startSeconds = new() { Minimum = 0, Maximum = 36000, Value = 30, Width = 80 };
    private readonly NumericUpDown _lengthSeconds = new() { Minimum = 1, Maximum = 36000, Value = 25, Width = 80 };
    private readonly ComboBox _format = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 100 };
    private readonly Button _startButton = new() { Text = "Start", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(14, 4, 14, 4) };
    private readonly Button _cancelButton = new() { Text = "Abbrechen", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(14, 4, 14, 4), Enabled = false };
    private readonly ProgressBar _progressBar = new() { Dock = DockStyle.Fill, Minimum = 0, Maximum = 100, Height = 23 };
    private readonly ListBox _log = new() { Dock = DockStyle.Fill, HorizontalScrollbar = true, IntegralHeight = false };
    private readonly Label _statusLabel = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Text = "Bereit." };

    private CancellationTokenSource? _cts;

    public MainForm()
    {
        Text = "blöki Snippet-Cutter";
        Width = 900;
        Height = 620;
        MinimumSize = new Size(720, 420);
        StartPosition = FormStartPosition.CenterScreen;
        // Skaliert die ganze Form (inkl. aller AutoSize-Spaltenbreiten unten)
        // mit der tatsaechlichen System-DPI/Textgroesse mit - feste
        // Pixelbreiten fuer Beschriftungen/Buttons haben bei hoeherer
        // Skalierung sonst zu abgeschnittenem Text gefuehrt (siehe
        // BuildPathRow/BuildActionRow: AutoSize-Spalten statt Absolute-Pixel).
        AutoScaleMode = AutoScaleMode.Dpi;

        _format.Items.Add("mp4");
        _format.SelectedIndex = 0;

        // Bequemer Default fuer den ueblichen Fall - ueberschreibbar per
        // "Durchsuchen…". Existiert der Pfad auf dieser Maschine nicht,
        // bleibt das Feld einfach leer (kein Fehler).
        const string defaultSource = @"V:\#trailer";
        if (Directory.Exists(defaultSource)) _sourceBox.Text = defaultSource;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 7,
            Padding = new Padding(12),
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        root.Controls.Add(BuildPathRow("Quellordner:", _sourceBox, OnBrowseSource), 0, 0);
        root.Controls.Add(BuildPathRow("Zielordner:", _targetBox, OnBrowseTarget), 0, 1);
        root.Controls.Add(BuildParamsRow(), 0, 2);
        root.Controls.Add(BuildButtonRow(), 0, 3);
        root.Controls.Add(BuildProgressRow(), 0, 4);
        root.Controls.Add(_log, 0, 5);
        root.Controls.Add(_statusLabel, 0, 6);

        Controls.Add(root);

        _startButton.Click += OnStartClicked;
        _cancelButton.Click += (_, _) => _cts?.Cancel();
    }

    // Spalten 0 und 2 (Label, Button) sind AutoSize statt einer festen
    // Pixelbreite - eine feste Breite reichte bei groesserer Windows-
    // Textskalierung (>100% DPI) nicht mehr aus und schnitt den Text ab.
    private static Control BuildPathRow(string labelText, TextBox box, EventHandler onBrowse)
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 8),
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var label = new Label
        {
            Text = labelText,
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(0, 6, 8, 0),
        };
        box.Dock = DockStyle.Fill;
        box.Margin = new Padding(0, 3, 8, 3);
        var browseButton = new Button
        {
            Text = "Durchsuchen…",
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(10, 2, 10, 2),
            Anchor = AnchorStyles.Right,
        };
        browseButton.Click += onBrowse;

        panel.Controls.Add(label, 0, 0);
        panel.Controls.Add(box, 1, 0);
        panel.Controls.Add(browseButton, 2, 0);
        return panel;
    }

    private Control BuildParamsRow()
    {
        var panel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 0, 0, 8),
        };

        void AddLabeled(string text, Control control)
        {
            panel.Controls.Add(new Label { Text = text, AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 8, 4, 0) });
            control.Margin = new Padding(0, 4, 24, 4);
            panel.Controls.Add(control);
        }

        AddLabeled("Startsekunde:", _startSeconds);
        AddLabeled("Länge (Sek.):", _lengthSeconds);
        AddLabeled("Zielformat:", _format);
        return panel;
    }

    private Control BuildButtonRow()
    {
        var panel = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 0, 0, 8),
        };
        _cancelButton.Margin = new Padding(8, 0, 0, 0);
        panel.Controls.Add(_startButton);
        panel.Controls.Add(_cancelButton);
        return panel;
    }

    // Eigene Zeile statt neben den Buttons in derselben Reihe: ein
    // AutoSize-FlowLayoutPanel neben einem Dock=Fill-Control in derselben
    // TableLayoutPanel-Zelle fuehrte dazu, dass der zweite Button (Abbrechen)
    // aus dem Sichtbereich der Spalte herausfiel (Spaltenbreite wurde vor
    // dem vollstaendigen Layout des FlowLayoutPanel fixiert). Der
    // Fortschrittsbalken bekommt so seine eigene, ueber die volle Breite
    // gehende Zeile - unproblematisch, da eine ProgressBar ohnehin keinen
    // "natuerlichen" Inhalt hat, an dem sie sich orientieren muesste.
    private Control BuildProgressRow()
    {
        var panel = new Panel { Dock = DockStyle.Fill, Height = 29, Margin = new Padding(0, 0, 0, 8) };
        _progressBar.Dock = DockStyle.Fill;
        panel.Controls.Add(_progressBar);
        return panel;
    }

    private void OnBrowseSource(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog { Description = "Quellordner mit den Original-Trailern wählen" };
        if (Directory.Exists(_sourceBox.Text)) dialog.SelectedPath = _sourceBox.Text;
        if (dialog.ShowDialog(this) == DialogResult.OK) _sourceBox.Text = dialog.SelectedPath;
    }

    private void OnBrowseTarget(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog { Description = "Zielordner für die geschnittenen Snippets wählen" };
        if (Directory.Exists(_targetBox.Text)) dialog.SelectedPath = _targetBox.Text;
        if (dialog.ShowDialog(this) == DialogResult.OK) _targetBox.Text = dialog.SelectedPath;
    }

    private async void OnStartClicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_sourceBox.Text) || !Directory.Exists(_sourceBox.Text))
        {
            MessageBox.Show(this, "Bitte einen gültigen Quellordner wählen.", "blöki Snippet-Cutter", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (string.IsNullOrWhiteSpace(_targetBox.Text))
        {
            MessageBox.Show(this, "Bitte einen Zielordner wählen.", "blöki Snippet-Cutter", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        SetRunning(true);
        _log.Items.Clear();
        _progressBar.Value = 0;
        _statusLabel.Text = "Prüfe ffmpeg/ffprobe…";

        var (ffmpegOk, ffmpegMessage) = await Cutter.CheckFfmpegAvailableAsync();
        if (!ffmpegOk)
        {
            _log.Items.Add(ffmpegMessage);
            MessageBox.Show(
                this,
                ffmpegMessage + "\n\nffmpeg installieren (z.B. via winget: winget install Gyan.FFmpeg) und sicherstellen, dass ffmpeg.exe/ffprobe.exe im PATH liegen - danach dieses Programm neu starten.",
                "ffmpeg nicht gefunden",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            SetRunning(false);
            return;
        }

        var options = new CutterOptions(
            _sourceBox.Text,
            _targetBox.Text,
            (double)_startSeconds.Value,
            (double)_lengthSeconds.Value);

        var progress = new Progress<CutterProgress>(p =>
        {
            _log.Items.Add(p.Message);
            _log.TopIndex = _log.Items.Count - 1;
            if (p.Total > 0) _progressBar.Value = Math.Min(100, (int)(100.0 * p.Scanned / p.Total));
            _statusLabel.Text = $"Läuft… ({p.Scanned}/{p.Total})";
        });

        _cts = new CancellationTokenSource();
        try
        {
            var summary = await Cutter.RunAsync(options, progress, _cts.Token);
            _statusLabel.Text = $"Fertig: {summary.Cut} geschnitten, {summary.SkippedExisting} übersprungen, {summary.Failed} fehlgeschlagen.";
            _log.Items.Add("");
            _log.Items.Add("--- Zusammenfassung ---");
            _log.Items.Add($"Gescannt:        {summary.Scanned}");
            _log.Items.Add($"Neu geschnitten: {summary.Cut}");
            _log.Items.Add($"Übersprungen:    {summary.SkippedExisting} (bereits vorhanden)");
            _log.Items.Add($"Fehlgeschlagen:  {summary.Failed}");
            if (summary.Unmatched.Count > 0)
            {
                _log.Items.Add($"{summary.Unmatched.Count} Datei(en) ohne passendes Namensmuster oder mit Problemen:");
                foreach (var name in summary.Unmatched) _log.Items.Add($"  - {name}");
            }
            _log.TopIndex = _log.Items.Count - 1;
        }
        catch (OperationCanceledException)
        {
            _statusLabel.Text = "Abgebrochen.";
            _log.Items.Add("Abgebrochen.");
        }
        catch (Exception ex)
        {
            _statusLabel.Text = "Fehler: " + ex.Message;
            _log.Items.Add("Unerwarteter Fehler: " + ex);
        }
        finally
        {
            _cts.Dispose();
            _cts = null;
            SetRunning(false);
        }
    }

    private void SetRunning(bool running)
    {
        _startButton.Enabled = !running;
        _cancelButton.Enabled = running;
        _sourceBox.Enabled = !running;
        _targetBox.Enabled = !running;
        _startSeconds.Enabled = !running;
        _lengthSeconds.Enabled = !running;
        _format.Enabled = !running;
    }
}
