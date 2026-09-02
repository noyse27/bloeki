import './Footer.css';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <p>
        Software: blöki © {year}{' '}
        <a href="https://polze.net/" target="_blank" rel="noopener noreferrer">
          PolzeSoft
        </a>
        .
      </p>
      <p>
        Haftungsausschluss: Sämtliche auf dieser Plattform bereitgestellten Videoinhalte unterliegen der
        ausschließlichen Verantwortung des Instanzbetreibers. PolzeSoft stellt lediglich die Software bereit und
        steht in keiner rechtlichen oder inhaltlichen Verbindung zu den gehosteten Medien.
      </p>
    </footer>
  );
}
