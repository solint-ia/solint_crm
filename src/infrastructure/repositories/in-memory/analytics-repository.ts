import type { AnalyticsReport, DashboardOverview, PeriodKey } from '@/core/domain/analytics';
import type { Id } from '@/core/domain/shared';
import type { AnalyticsRepository } from '@/core/ports/analytics-repository';
import { OVERVIEW, REPORT } from '@/infrastructure/seed/analytics';
import { buildPeriodSeries } from '@/infrastructure/seed/analytics-series';

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  async getOverview(_accountId: Id, period: PeriodKey): Promise<DashboardOverview> {
    return { ...OVERVIEW, volume: buildPeriodSeries(period).volume };
  }

  async getReport(_accountId: Id, period: PeriodKey): Promise<AnalyticsReport> {
    const series = buildPeriodSeries(period);
    return {
      ...REPORT,
      volume: series.volume,
      previousVolume: series.previousVolume,
      comparison: series.comparison,
    };
  }
}
