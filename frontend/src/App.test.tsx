import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

describe('App', () => {
  it('renders the setup wizard', async () => {
    // App now routes internally (App.tsx uses <Routes>, see main.tsx for
    // the real BrowserRouter) and "/" itself goes through RootGate, which
    // decides between the wizard and the home screen based on a backend
    // call - navigate straight to /setup instead of relying on that.
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('blöki Setup')).toBeInTheDocument();
  });
});
