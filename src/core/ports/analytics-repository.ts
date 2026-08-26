import type { AnalyticsReport, DashboardOverview, PeriodKey } from '../domain/analytics';
import type { Id } from '../domain/shared';
import type { InboxAccess } from '../domain/user';

export interface AnalyticsRepository {
  getOverview(accountId: Id, period: PeriodKey, inboxAccess: InboxAccess): Promise<DashboardOverview>;
  getReport(accountId: Id, period: PeriodKey, inboxAccess: InboxAccess): Promise<AnalyticsReport>;
}
