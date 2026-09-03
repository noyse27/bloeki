namespace TrailerRenamerGui;

/// <summary>Fehlermeldung "Zieldatei existiert bereits" mit einem zusaetzlichen
/// "Überspringen"-Button neben OK - WinForms' MessageBox erlaubt keine
/// eigenen Button-Beschriftungen, daher ein eigener Mini-Dialog. Liefert
/// DialogResult.Ignore zurueck, wenn der User "Überspringen" waehlt (springt
/// direkt zur naechsten offenen Datei), DialogResult.OK bei "OK" (bleibt auf
/// der aktuellen Datei, z.B. um Titel/Jahr zu korrigieren).</summary>
public sealed class DuplicateFileForm : Form
{
    public DuplicateFileForm(string message)
    {
        Text = "blöki Trailer-Renamer";
        Width = 480;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoScaleMode = AutoScaleMode.Dpi;
        // AutoSize statt fester Height: die Meldung ist mehrzeilig
        // (Dateiname kann lang sein) - bei fester Hoehe wurden die Buttons
        // je nach Zeilenzahl unter den sichtbaren Bereich geschoben.
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;

        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(16),
        };
        panel.Controls.Add(new Label
        {
            Text = message,
            AutoSize = true,
            MaximumSize = new Size(440, 0),
            Margin = new Padding(0, 0, 0, 20),
        });

        var buttonRow = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft };
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, AutoSize = true, Padding = new Padding(10, 2, 10, 2) };
        var skip = new Button { Text = "Überspringen", DialogResult = DialogResult.Ignore, AutoSize = true, Padding = new Padding(10, 2, 10, 2), Margin = new Padding(0, 0, 8, 0) };
        buttonRow.Controls.Add(ok);
        buttonRow.Controls.Add(skip);
        panel.Controls.Add(buttonRow);

        Controls.Add(panel);
        AcceptButton = ok;
    }
}
