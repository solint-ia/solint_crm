import type { Label } from '@/core/domain/label';
import { Badge } from '@/components/ui/badge';

export function LabelChip({ label }: { readonly label: Label }) {
  return <Badge tone={label.tone}>{label.name}</Badge>;
}

export function LabelChips({ labels }: { readonly labels: readonly Label[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
    </div>
  );
}
