import { useNavigate, useSearchParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { useToast } from '../../components/ui/toast';
import { useUndo } from '../../hooks/use-undo';
import { readScanLocation } from '../../lib/scan-session';
import { ProductForm } from '../scan/product-form';

/** EF-05 : création manuelle hors scan (vrac, bocaux, restes), pré-remplie par l'URL. */
export function ProductFormScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const undo = useUndo();
  const remembered = readScanLocation();

  return (
    <>
      <ScreenHeader title="Nouveau produit" back="/" />
      <div className="px-4 pb-6">
        <ProductForm
          defaults={{ barcode: params.get('barcode'), name: params.get('name') ?? '', locationId: remembered?.id }}
          onSaved={(result) => {
            void undo.invalidateStock();
            toast.show({ message: `${result.product.name} ajouté au stock`, tone: 'success', durationMs: 3000 });
            navigate(`/stock/${result.stock.item.id}`, { replace: true });
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </>
  );
}
