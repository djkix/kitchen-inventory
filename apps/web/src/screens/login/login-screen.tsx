import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage, isApiError } from '../../lib/api';
import { AuthLayout } from './auth-layout';

export function LoginScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const next = safeNext(params.get('next'));

  if (auth.state === 'setup_required') return <Navigate to="/installation" replace />;
  if (auth.state === 'authenticated') return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.post<void>('/auth/login', values, { skipAuthRedirect: true });
      await auth.refresh();
      navigate(next, { replace: true });
    } catch (error) {
      if (isApiError(error, 'unauthenticated')) setServerError('Adresse ou mot de passe incorrect.');
      else if (isApiError(error, 'rate_limited')) setServerError('Trop de tentatives. Patientez quelques minutes avant de réessayer.');
      else setServerError(errorMessage(error));
    }
  });

  return (
    <AuthLayout title="Connexion" lead="Retrouvez le stock partagé de la maison.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input label="Adresse e-mail" type="email" autoComplete="username" inputMode="email" autoFocus error={form.formState.errors.email?.message} {...form.register('email')} />
        <Input label="Mot de passe" type="password" autoComplete="current-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          Se connecter
        </Button>
      </form>
    </AuthLayout>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/connexion') || value.startsWith('/installation')) return '/';
  return value;
}
