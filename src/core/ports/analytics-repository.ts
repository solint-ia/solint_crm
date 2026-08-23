import type { AnalyticsReport, DashboardOverview, PeriodKey } from '../domain/analytics';
import type { Id } from '../domain/shared';

export interface AnalyticsRepository {
  getOverview(accountId: Id, period: PeriodKey): Promise<DashboardOverview>;
  getReport(accountId: Id, period: PeriodKey): Promise<AnalyticsReport>;
}
