import { coversReceiptLabel, isCountableUnit, receiptQuantitySchema, roundQuantity, UNIT_LABELS_FR, type LocationNode, type ProductDto, type ReceiptDto, type ReceiptLineDto } from '@kitchen/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { ListSkeleton } from '../../components/ui/skeleton';
import { PinIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/toast';
import { errorMessage, newClientOpId } from '../../lib/api';
import { cn } from '../../lib/cn';
import { flattenLocations, queryKeys, useLocationsQuery } from '../../lib/queries';
import { receiptsApi } from '../../lib/receipts-api';
import { readScanLocation, reconcileScanLocation, type ScanLocation } from '../../lib/scan-session';
import { LocationPicker } from '../scan/location-picker';
import { PendingLabelsSection } from './pending-labels-section';

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmt = (n: number) => NUMBER_FORMAT.format(roundQuantity(n));

/** Saisie « 1,5 » ou « 1.5 » ; `null` si hors des bornes du schéma partagé. */
function parseQuantity(text: string): number | null {
  const parsed = receiptQuantitySchema.safeParse(Number(text.trim().replace(',', '.')));
  return parsed.success ? parsed.data : null;
}

/**
 * Candidats d'une ligne ambiguë : celui dont le nom couvre tout le libellé
 * d'abord (D6). Le tri est stable, l'ordre de l'API reste celui des autres.
 */
export function orderCandidates(label: string, candidates: readonly ProductDto[]): ProductDto[] {
  // Même définition que la règle serveur (`coversReceiptLabel`) : l'écran ne
  // réinvente pas le test de couverture, sinon il classe autrement qu'elle.
  return [...candidates].sort((a, b) => Number(coversReceiptLabel(label, b.name)) - Number(coversReceiptLabel(label, a.name)));
}

/** Lire et valider changent les libellés en attente : la liste et la pastille de l'onglet doivent suivre. */
function invalidatePendingLabels(queryClient: QueryClient) {
  return Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.pendingLabels }), queryClient.invalidateQueries({ queryKey: queryKeys.pendingLabelCount })]);
}

/** EF-29 : un ticket de caisse photographié devient des entrées de stock. */
export function ReceiptScreen() {
  // Le dernier emplacement du scan sert de défaut, jamais réécrit : choisir un
  // emplacement pour un ticket ne doit pas déplacer le prochain scan. Il est
  // vérifié contre la liste réelle avant la photo, qui coûte un appel au modèle.
  const [picked, setPicked] = useState<ScanLocation | null>(null);
  const locations = useLocationsQuery();
  const location = useMemo(
    () => (locations.data ? reconcileScanLocation(picked ?? readScanLocation(), flattenLocations(locations.data)) : null),
    [locations.data, picked],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Le brouillon vit côté serveur et l'adresse le désigne : une lecture coûte
  // des dizaines de secondes et un appel payant, que rafraîchir ou changer
  // d'application ne doit pas perdre.
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // `staleTime` : le brouillon ne bouge pas tout seul, et la lecture vient
  // d'être posée au cache — sans cela l'écran relirait le ticket juste après
  // l'avoir payé.
  const draft = useQuery({ queryKey: queryKeys.receipt(id ?? ''), queryFn: () => receiptsApi.get(id!), enabled: !!id, staleTime: 5 * 60_000 });
  const receipt = id ? (draft.data ?? null) : null;

  const read = useMutation({
    mutationFn: (file: File) => receiptsApi.read(file, location?.id ?? ''),
    onSuccess: (data) => {
      // Posé au cache avant la navigation : l'écran du ticket s'affiche sans relire.
      queryClient.setQueryData(queryKeys.receipt(data.id), data);
      void navigate(`/courses/${data.id}`, { replace: true });
      void invalidatePendingLabels(queryClient);
    },
  });

  const choose = (node: LocationNode) => {
    const next = { id: node.id, name: node.name };
    setPicked(next);
    setPickerOpen(false);
  };

  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && location) read.mutate(file);
  };

  return (
    <>
      <ScreenHeader title="Courses" subtitle="Ticket de caisse" />
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPicked} data-testid="receipt-file" />

      {id && !receipt ? (
        draft.isError ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <ErrorState title="Ticket introuvable" message={errorMessage(draft.error, 'Ce ticket n’est plus disponible.')} />
            <Button variant="secondary" block onClick={() => void navigate('/courses', { replace: true })}>Revenir aux courses</Button>
          </div>
        ) : (
          <ListSkeleton />
        )
      ) : receipt ? (
        <ReceiptReview
          key={receipt.id}
          receipt={receipt}
          onDone={() => {
            read.reset();
            void navigate('/courses', { replace: true });
            void queryClient.invalidateQueries({ queryKey: queryKeys.stockAll });
            void queryClient.invalidateQueries({ queryKey: queryKeys.locations });
          }}
        />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          <p className="text-[14px] text-muted">Photographiez le ticket : les produits reconnus se cochent, vous corrigez ce qui doit l’être, et le stock se remplit sans scanner les articles un par un.</p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-touch items-center gap-3 rounded-xl border border-line bg-surface px-3.5 text-left active:bg-raised"
          >
            <PinIcon size={18} className="text-accent" />
            <span className="flex-1 text-[15px]">{location ? location.name || 'Emplacement choisi' : 'Choisir l’emplacement'}</span>
            <span className="text-[13px] text-faint">{location ? 'Changer' : 'Requis'}</span>
          </button>
          <Button variant="primary" size="lg" block disabled={!location} loading={read.isPending} onClick={() => input.current?.click()}>
            {read.isPending ? 'Lecture du ticket…' : 'Photographier le ticket'}
          </Button>
          {!location && <p className="text-[13px] text-faint">L’emplacement vaut pour tout le ticket : choisissez-le avant la photo.</p>}
          {read.isError && <ErrorState title="Ticket illisible" message={errorMessage(read.error, 'Le ticket n’a pas pu être lu.')} />}
        </div>
      )}

      <PendingLabelsSection />
      <LocationPicker open={pickerOpen} selectedId={location?.id ?? null} onSelect={choose} onClose={() => setPickerOpen(false)} />
    </>
  );
}

interface LineState {
  checked: boolean;
  quantity: string;
  productId: string | null;
}

function initialState(line: ReceiptLineDto): LineState {
  return { checked: line.state === 'MATCHED', quantity: String(line.quantity), productId: line.state === 'MATCHED' ? (line.product?.id ?? null) : null };
}

/**
 * Le « 3 × » du ticket compte des objets : il ne pré-remplit la quantité que
 * pour un produit qui se compte ainsi. Sinon la case reste vide — « 1 g de
 * Comté » serait faux, c'est à djkix de dire combien.
 */
const prefilledQuantity = (line: ReceiptLineDto, product: ProductDto): string => (isCountableUnit(product.defaultUnit) ? String(line.quantity) : '');

function ReceiptReview({ receipt, onDone }: { receipt: ReceiptDto; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const lines = useMemo(() => [...receipt.lines].sort((a, b) => a.position - b.position), [receipt.lines]);
  const [state, setState] = useState<Record<string, LineState>>(() => Object.fromEntries(lines.map((l) => [l.id, initialState(l)])));
  // Un identifiant par ligne, tiré une fois : un rejeu après coupure ne double rien.
  const opIds = useRef<Record<string, string>>({});
  const patch = (id: string, change: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...(s[id] as LineState), ...change } }));

  const selected = lines.flatMap((line) => {
    const s = state[line.id];
    const quantity = s ? parseQuantity(s.quantity) : null;
    return s?.checked && s.productId && line.state !== 'UNKNOWN' && quantity !== null ? [{ line, productId: s.productId, quantity }] : [];
  });
  const hasInvalid = lines.some((l) => state[l.id]?.checked && parseQuantity(state[l.id]?.quantity ?? '') === null);

  const validate = useMutation({
    mutationFn: () =>
      receiptsApi.validate(receipt.id, {
        lines: selected.map(({ line, productId, quantity }) => ({ id: line.id, productId, quantity, clientOpId: (opIds.current[line.id] ??= newClientOpId()) })),
      }),
    onSuccess: ({ added }) => {
      queryClient.removeQueries({ queryKey: queryKeys.receipt(receipt.id) });
      void invalidatePendingLabels(queryClient);
      toast.show({ message: added === 0 ? 'Rien de nouveau : ce ticket était déjà validé.' : `${added} produit${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au stock`, tone: 'success' });
      onDone();
    },
  });

  const count = selected.length;
  const validated = receipt.status === 'VALIDATED';
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-[13px] text-muted">Dans l’ordre du ticket. Cochez ce qui entre au stock ; la quantité se corrige sur la ligne.</p>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {lines.map((line) => {
          const s = state[line.id] ?? initialState(line);
          const chosen = line.state === 'MATCHED' ? line.product : (line.candidates.find((c) => c.id === s.productId) ?? null);
          const name = chosen?.name ?? line.rawLabel;
          const qty = parseQuantity(s.quantity);
          const unknown = line.state === 'UNKNOWN';
          // `currentQuantity` est calculé d'après le produit de la ligne côté serveur : nul tant
          // qu'elle est ambiguë. Une ligne dont on a choisi le produit n'a donc aucune base connue.
          const baselineKnown = line.state === 'MATCHED';
          const unit = chosen && !isCountableUnit(chosen.defaultUnit) ? UNIT_LABELS_FR[chosen.defaultUnit] : null;
          return (
            <li key={line.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-3">
                {unknown ? (
                  <span className="mt-1 size-5 shrink-0" aria-hidden />
                ) : (
                  <input
                    type="checkbox"
                    aria-label={`Ajouter ${name}`}
                    checked={s.checked}
                    disabled={!s.productId}
                    onChange={(e) => patch(line.id, { checked: e.target.checked })}
                    className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[16px] font-medium">
                    <span className="truncate">{unknown ? line.rawLabel : name}</span>
                    {unknown && <span className="shrink-0 rounded-md bg-soon-deep px-1.5 py-0.5 text-[12px] font-medium text-soon">Nouveau</span>}
                  </p>
                  {!unknown && <p className="truncate text-[13px] text-faint">{line.rawLabel}</p>}
                  {unknown && <p className="text-[13px] text-faint">Produit inconnu : à scanner par son code-barres.</p>}
                </div>
                {!unknown && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantité de ${name}`}
                      value={s.quantity}
                      onChange={(e) => patch(line.id, { quantity: e.target.value })}
                      aria-invalid={qty === null}
                      className={cn('tnum min-h-touch w-16 rounded-xl border bg-ink px-2 text-center text-[16px]', qty === null ? 'border-danger' : 'border-line')}
                    />
                    {chosen && (
                      <span className="tnum text-[13px] text-muted">
                        {baselineKnown ? `${fmt(line.currentQuantity)} → ${qty === null ? '?' : fmt(line.currentQuantity + qty)}` : `+${qty === null ? '?' : fmt(qty)}`}
                        {unit && ` ${unit}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {line.state === 'AMBIGUOUS' && (
                <div role="group" aria-label={`Produit pour ${line.rawLabel}`} className="flex flex-wrap gap-2 pl-8">
                  {orderCandidates(line.rawLabel, line.candidates).map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-pressed={s.productId === candidate.id}
                      onClick={() => patch(line.id, { productId: candidate.id, checked: isCountableUnit(candidate.defaultUnit), quantity: prefilledQuantity(line, candidate) })}
                      className={cn('min-h-[36px] rounded-full border px-3 text-[14px]', s.productId === candidate.id ? 'border-accent bg-accent-deep text-accent' : 'border-line text-fg active:bg-raised')}
                    >
                      {candidate.name}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {validated && <p className="text-[14px] text-muted">Ce ticket a déjà été validé : ses produits sont au stock.</p>}
      {validate.isError && <p role="alert" className="text-[14px] text-danger">{errorMessage(validate.error)}</p>}
      {!validated && <Button variant="primary" size="lg" block disabled={count === 0 || hasInvalid} loading={validate.isPending} onClick={() => validate.mutate()}>
        {count === 0 ? 'Rien à ajouter' : `Ajouter ${count} produit${count > 1 ? 's' : ''}`}
      </Button>}
      <Button variant="ghost" block disabled={validate.isPending} onClick={onDone}>{validated ? 'Revenir aux courses' : 'Abandonner ce ticket'}</Button>
    </div>
  );
}
