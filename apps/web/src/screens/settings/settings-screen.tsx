import { ScreenHeader } from '../../components/shell/app-shell';
import { ListSkeleton } from '../../components/ui/skeleton';

export function SettingsScreen() {
  return (
    <>
      <ScreenHeader title="Réglages" />
      <ListSkeleton rows={3} />
    </>
  );
}
