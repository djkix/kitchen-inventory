import { normalizeReceiptLabel, receiptQuantitySchema, roundQuantity, type LocationNode, type ProductDto, type ReceiptDto, type ReceiptLineDto } from '@kitchen/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { PinIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/toast';
import { errorMessage, newClientOpId } from '../../lib/api';
import { cn } from '../../lib/cn';
import { queryKeys } from '../../lib/queries';
import { receiptsApi } from '../../lib/receipts-api';
import { readScanLocation, writeScanLocation, type ScanLocation } from '../../lib/scan-session';
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
  const wanted = normalizeReceiptLabel(label).split(' ').filter(Boolean);
  const covers = (p: ProductDto) => {
    const names = new Set(normalizeReceiptLabel(p.name).split(' '));
    return wanted.length > 0 && wanted.every((w) => names.has(w));
  };
  return [...candidates].sort((a, b) => Number(covers(b)) - Number(covers(a)));
}

/** EF-29 : un ticket de caisse photographié devient des entrées de stock. */
export function ReceiptScreen() {
  const [location, setLocation] = useState<ScanLocation | null>(() => readScanLocation());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const read = useMutation({
    mutationFn: (file: File) => receiptsApi.read(file, location?.id ?? ''),
    onSuccess: (data) => {
      setReceipt(data);
    },
  });
  const queryClient = useQueryClient();

  const choose = (node: LocationNode) => {
    const next = { id: node.id, name: node.name };
    setLocation(next);
    writeScanLocation(next);
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

      {receipt ? (
        <ReceiptReview
          key={receipt.id}
          receipt={receipt}
          onDone={() => {
            setReceipt(null);
            read.reset();
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

function ReceiptReview({ receipt, onDone }: { receipt: ReceiptDto; onDone: () => void }) {
  const toast = useToast();
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
      toast.show({ message: added === 0 ? 'Rien de nouveau : ce ticket était déjà validé.' : `${added} produit${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au stock`, tone: 'success' });
      onDone();
    },
  });

  if (lines.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <ErrorState title="Aucune ligne lue" message="Le ticket ne contient aucune ligne exploitable. Reprenez la photo à plat, bien éclairée." />
        <Button variant="secondary" block onClick={onDone}>Reprendre une photo</Button>
      </div>
    );
  }

  const count = selected.length;
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
                        {fmt(line.currentQuantity)} → {qty === null ? '?' : fmt(line.currentQuantity + qty)}
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
                      onClick={() => patch(line.id, { productId: candidate.id, checked: true })}
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
      {validate.isError && <p role="alert" className="text-[14px] text-danger">{errorMessage(validate.error)}</p>}
      <Button variant="primary" size="lg" block disabled={count === 0 || hasInvalid} loading={validate.isPending} onClick={() => validate.mutate()}>
        {count === 0 ? 'Rien à ajouter' : `Ajouter ${count} produit${count > 1 ? 's' : ''}`}
      </Button>
      <Button variant="ghost" block disabled={validate.isPending} onClick={onDone}>Abandonner ce ticket</Button>
    </div>
  );
}
