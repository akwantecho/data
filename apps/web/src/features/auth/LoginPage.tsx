import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../lib/api-client';
import { LoadingState } from '../../components/states';
import { login, SESSION_QUERY_KEY } from './session';
import { useSession } from './session-context';

const credentialsSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type Credentials = z.infer<typeof credentialsSchema>;

export function LoginPage() {
  const { isAuthenticated, isLoading } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Credentials>({ defaultValues: { email: '', password: '' } });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/system', { replace: true });
    },
  });

  if (isLoading) {
    return <LoadingState label="Checking your session…" />;
  }

  if (isAuthenticated) {
    return <Navigate to="/system" replace />;
  }

  const onSubmit = handleSubmit((values) => {
    const parsed = credentialsSchema.safeParse(values);

    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  });

  return (
    <div className="auth-layout">
      <section className="card auth-card">
        <header className="stack">
          <span className="brand">
            Strategic Intelligence
            <span className="brand__subtitle">Sign in</span>
          </span>
        </header>

        <form className="stack" onSubmit={onSubmit} noValidate>
          <div className="form-field">
            <label className="form-field__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="form-field__input"
              aria-invalid={errors.email ? 'true' : undefined}
              {...register('email', { validate: validateEmail })}
            />
            {errors.email ? (
              <p className="form-field__error" role="alert">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div className="form-field">
            <label className="form-field__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="form-field__input"
              aria-invalid={errors.password ? 'true' : undefined}
              {...register('password', { required: 'Password is required' })}
            />
            {errors.password ? (
              <p className="form-field__error" role="alert">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          {mutation.isError ? (
            <p className="form-error" role="alert">
              {describeLoginError(mutation.error)}
            </p>
          ) : null}

          <button className="button button--primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}

/** The Zod schema is the single definition of a valid email, reused by the form. */
function validateEmail(value: string): true | string {
  const result = credentialsSchema.shape.email.safeParse(value);
  return result.success || (result.error.issues[0]?.message ?? 'Enter a valid email address');
}

/** Never echo server internals; map known codes to guidance the user can act on. */
function describeLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (error.code === 'FORBIDDEN') {
      return error.message;
    }
    if (error.status === 401) {
      return 'Email or password is incorrect.';
    }
  }

  return 'Sign-in is unavailable right now. Please try again.';
}
