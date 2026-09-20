import { zodResolver } from '@hookform/resolvers/zod';
import { setupSchema, type CurrentUser, type SetupInput } from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage, isApiError } from '../../lib/api';
import { AuthLayout } from '../login/auth-layout';

/** Premier démarrage : création de l'administrateur, uniquement quand la base n'a aucun compte. */
export function SetupScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SetupInput>({ resolver: zodResolver(setupSchema), defaultValues: { email: '', name: '', password: '' } });

  if (auth.state === 'anonymous') return <Navigate to="/connexion" replace />;
  if (auth.state === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.post<CurrentUser>('/auth/setup', values, { skipAuthRedirect: true });
      await auth.refresh();
      navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error, 'conflict') || isApiError(error, 'forbidden')) setServerError('Un compte existe déjà : connectez-vous.');
      else setServerError(errorMessage(error));
    }
  });

  return (
    <AuthLayout title="Installation" lead="Aucun compte n’existe encore. Ce premier compte sera administrateur et pourra inviter les autres membres du foyer.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input label="Votre prénom" autoComplete="given-name" autoFocus error={form.formState.errors.name?.message} {...form.register('name')} />
        <Input label="Adresse e-mail" type="email" autoComplete="username" inputMode="email" error={form.formState.errors.email?.message} {...form.register('email')} />
        <Input
          label="Mot de passe"
          type="password"
          autoComplete="new-password"
          hint="12 caractères au minimum."
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          Créer le compte administrateur
        </Button>
      </form>
    </AuthLayout>
  );
}
