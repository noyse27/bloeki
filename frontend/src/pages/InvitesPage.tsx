import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { InvitesSection } from './InvitesSection';

// Standalone entry point for users who have been granted invite rights
// (app_user.can_create_invites) without being admins - admins already
// have the same InvitesSection embedded in AdminPage, this just gives
// delegated non-admin users somewhere to actually reach it (see
// HomePage.tsx's conditional nav link).
export function InvitesPage() {
  const { auth } = useAuth();

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>
            Bitte zuerst <Link to="/login">anmelden</Link>.
          </p>
        </div>
      </div>
    );
  }
  if (auth.user.role !== 'admin' && !auth.user.canCreateInvites) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Du hast (noch) kein Einladungsrecht. Ein Admin kann es dir im Admin-Bereich erteilen.</p>
          <Link to="/">Zurück zur Startseite</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 720 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Einladungen</h2>
        <InvitesSection token={auth.accessToken} isAdmin={auth.user.role === 'admin'} />
      </div>
    </div>
  );
}
