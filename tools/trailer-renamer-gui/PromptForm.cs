namespace TrailerRenamerGui;

/// <summary>Minimaler Eingabedialog fuer einen einzelnen Textwert (aktuell
/// nur fuer den TMDB-API-Key genutzt) - .NET/WinForms hat kein eingebautes
/// InputBox-Aequivalent.</summary>
public sealed class PromptForm : Form
{
    private readonly TextBox _input = new() { Dock = DockStyle.Top, Margin = new Padding(0, 8, 0, 0) };

    public string Value => _input.Text.Trim();

    public PromptForm(string title, string label, string initialValue)
    {
        Text = title;
        Width = 480;
        Height = 160;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoScaleMode = AutoScaleMode.Dpi;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(12) };
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Dock = DockStyle.Top });
        _input.Text = initialValue;
        panel.Controls.Add(_input);

        var buttonRow = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Margin = new Padding(0, 16, 0, 0) };
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, AutoSize = true, Padding = new Padding(10, 2, 10, 2) };
        var cancel = new Button { Text = "Abbrechen", DialogResult = DialogResult.Cancel, AutoSize = true, Padding = new Padding(10, 2, 10, 2), Margin = new Padding(8, 0, 0, 0) };
        buttonRow.Controls.Add(cancel);
        buttonRow.Controls.Add(ok);
        panel.Controls.Add(buttonRow);

        Controls.Add(panel);
        AcceptButton = ok;
        CancelButton = cancel;
    }
}
