import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderGuarded(route = '/system') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>Sign in page</p>} />
      <Route
        path="/system"
        element={
          <ProtectedRoute>
            <p>Protected content</p>
          </ProtectedRoute>
        }
      />
    </Routes>,
    { route },
  );
}

describe('ProtectedRoute', () => {
  it('redirects an unauthenticated visitor to login', async () => {
    stubFetch({});
    renderGuarded();

    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the page for an authenticated user', async () => {
    stubFetch({ '/auth/me': { body: buildSession() } });
    renderGuarded();

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('shows a checking state before the session resolves', () => {
    stubFetch({ '/auth/me': { body: buildSession() } });
    renderGuarded();

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
  });
});
