import { Route, Routes } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { SetupWizard } from './components/SetupWizard';
import { Footer } from './components/Footer';
import { RootGate } from './pages/RootGate';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { InstructionsPage } from './pages/InstructionsPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';
import { InvitesPage } from './pages/InvitesPage';
import { LobbyPage } from './pages/LobbyPage';
import { CreateTablePage } from './pages/CreateTablePage';
import { TableRoomPage } from './pages/TableRoomPage';
import { DisplayPage } from './pages/DisplayPage';
import { HostAppPage } from './pages/HostAppPage';
import { HostAuthorizePage } from './pages/HostAuthorizePage';
import { LiveGameBoard } from './game/LiveGameBoard';

// TODO(popup): "/spiel/:gameId" still opens in the same tab/window as the
// rest of the app. Launching it as its own popup window on round-start is
// still open (see Playboard UI spec section 8).
export function App() {
  const location = useLocation();
  const hideFooter =
    location.pathname === '/host' ||
    location.pathname === '/host-app' ||
    location.pathname.startsWith('/display/') ||
    location.pathname.startsWith('/spiel/');

  return (
    <>
      <Routes>
        <Route path="/" element={<RootGate />} />
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/anleitung" element={<InstructionsPage />} />
        <Route path="/rangliste" element={<LeaderboardPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/einladungen" element={<InvitesPage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/tisch/neu" element={<CreateTablePage />} />
        <Route path="/tisch/:tableId" element={<TableRoomPage />} />
        <Route path="/spiel/:gameId" element={<LiveGameBoard />} />
        <Route path="/display/:token" element={<DisplayPage />} />
        <Route path="/host" element={<HostAppPage />} />
        <Route path="/host-app" element={<HostAppPage />} />
        <Route path="/host/authorize" element={<HostAuthorizePage />} />
      </Routes>
      {!hideFooter && <Footer />}
    </>
  );
}
