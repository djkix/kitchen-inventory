import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput } from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage, isApiError } from '../../lib/api';

export function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.post<void>('/me/password', values);
      toast.show({ message: 'Mot de passe changé', tone: 'success', durationMs: 3000 });
      form.reset();
      onClose();
    } catch (error) {
      setServerError(isApiError(error, 'unauthenticated') || isApiError(error, 'forbidden') ? 'Mot de passe actuel incorrect.' : errorMessage(error));
    }
  });

  return (
    <Sheet open={open} onClose={onClose} locked={form.formState.isSubmitting} title="Changer le mot de passe">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Mot de passe actuel" type="password" autoComplete="current-password" error={form.formState.errors.currentPassword?.message} {...form.register('currentPassword')} />
        <Input label="Nouveau mot de passe" type="password" autoComplete="new-password" hint="12 caractères au minimum." error={form.formState.errors.newPassword?.message} {...form.register('newPassword')} />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          Enregistrer
        </Button>
      </form>
    </Sheet>
  );
}
