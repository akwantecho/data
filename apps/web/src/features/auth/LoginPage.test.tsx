import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('rejects an invalid email before calling the API', async () => {
    const { calls } = stubFetch({});
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/auth/login'))).toBe(false);
  });

  it('requires a password', async () => {
    stubFetch({});
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'admin@alpha-medical.local');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Password is required')).toBeInTheDocument();
  });

  it('posts credentials to the API', async () => {
    const { calls } = stubFetch({ '/auth/login': { body: buildSession() } });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'admin@alpha-medical.local');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      const loginCall = calls.find((call) => call.url.endsWith('/auth/login'));
      expect(loginCall?.init?.method).toBe('POST');
      expect(loginCall?.init?.credentials).toBe('include');
      expect(loginCall?.init?.body).toBe(
        JSON.stringify({ email: 'admin@alpha-medical.local', password: 'Password123!' }),
      );
    });
  });

  it('shows a generic message for wrong credentials', async () => {
    stubFetch({
      '/auth/login': {
        status: 401,
        body: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect.', details: [] },
      },
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'admin@alpha-medical.local');
    await userEvent.type(screen.getByLabelText('Password'), 'WrongPassword1!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  });

  it('explains a rate-limited response', async () => {
    stubFetch({
      '/auth/login': {
        status: 429,
        body: { code: 'RATE_LIMITED', message: 'Too many requests', details: [] },
      },
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'admin@alpha-medical.local');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Too many attempts. Please wait a minute and try again.'),
    ).toBeInTheDocument();
  });

  it('never leaks server detail for an unexpected failure', async () => {
    stubFetch({
      '/auth/login': {
        status: 500,
        body: {
          code: 'INTERNAL_ERROR',
          message: 'The request could not be processed.',
          details: [],
        },
      },
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.type(await screen.findByLabelText('Email'), 'admin@alpha-medical.local');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Sign-in is unavailable right now. Please try again.'),
    ).toBeInTheDocument();
  });
});
