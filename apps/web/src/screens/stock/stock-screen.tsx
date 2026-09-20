import { ScreenHeader } from '../../components/shell/app-shell';
import { ListSkeleton } from '../../components/ui/skeleton';

export function StockScreen() {
  return (
    <>
      <ScreenHeader title="Stock" />
      <ListSkeleton />
    </>
  );
}
