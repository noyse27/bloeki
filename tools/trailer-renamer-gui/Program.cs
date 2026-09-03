namespace TrailerRenamerGui;

static class Program
{
    /// <summary>
    ///  Haupteinstiegspunkt der Anwendung.
    /// </summary>
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
