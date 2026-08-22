import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';
import { TraceabilityRepository } from '@/lib/repositories/traceability.repository';

type FreshnessReader = Pick<TraceabilityRepository, 'isTraceabilityStale'>;
type TraceabilityRecalculator = Pick<OutgoingGoodsRepository, 'recalculateTraceabilityForOutgoing'>;

export class TraceabilityFreshnessService {
  constructor(
    private readonly freshnessRepository: FreshnessReader = new TraceabilityRepository(),
    private readonly recalculationRepository: TraceabilityRecalculator = new OutgoingGoodsRepository()
  ) {}

  /** Returns true only when this view caused a stale snapshot to be rebuilt. */
  async ensureFreshTraceability(outgoingGoodId: number, companyCode: number): Promise<boolean> {
    if (!(await this.freshnessRepository.isTraceabilityStale(outgoingGoodId, companyCode))) {
      return false;
    }

    await this.recalculationRepository.recalculateTraceabilityForOutgoing(outgoingGoodId, companyCode);
    return true;
  }
}

export const traceabilityFreshnessService = new TraceabilityFreshnessService();
