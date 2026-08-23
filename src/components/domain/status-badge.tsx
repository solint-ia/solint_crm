import type { ConversationStatus, Priority } from '@/core/domain/conversation';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from './presentation-maps';

export function StatusBadge({ status }: { readonly status: ConversationStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} withDot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { readonly priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}
