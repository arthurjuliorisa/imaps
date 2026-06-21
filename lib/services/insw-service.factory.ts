import { resolveInswCompanyConfig } from '@/lib/config/insw-company-config';
import { INSWIntegrationService } from '@/lib/services/insw-integration.service';

export function createInswIntegrationService(companyCode: number): INSWIntegrationService {
  const config = resolveInswCompanyConfig(companyCode);

  return new INSWIntegrationService(
    config.apiKey,
    config.uniqueKey,
    config.useTestMode
  );
}

export function createInswPayloadConverter(): INSWIntegrationService {
  return new INSWIntegrationService('', '', true);
}
