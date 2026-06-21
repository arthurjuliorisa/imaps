export type SupportedINSWCompanyCode = 1370 | 1380;

export interface INSWCompanyConfig {
  readonly companyCode: SupportedINSWCompanyCode;
  readonly apiKey: string;
  readonly uniqueKeyTest?: string;
  readonly uniqueKeyReal?: string;
  readonly uniqueKey: string;
  readonly npwp?: string;
  readonly useTestMode: boolean;
}

interface INSWCompanyEnvConfig {
  readonly useTestMode: string | undefined;
  readonly apiKey: string | undefined;
  readonly uniqueKeyTest: string | undefined;
  readonly uniqueKeyReal: string | undefined;
  readonly npwp: string | undefined;
}

const SUPPORTED_INSW_COMPANY_CODES = [1370, 1380] as const;

const INSW_COMPANY_ENV_KEYS = {
  1370: {
    useTestMode: 'INSW_1370_USE_TEST_MODE',
    apiKey: 'INSW_1370_API_KEY',
    uniqueKeyTest: 'INSW_1370_UNIQUE_KEY_TEST',
    uniqueKeyReal: 'INSW_1370_UNIQUE_KEY_REAL',
    npwp: 'INSW_1370_NPWP',
  },
  1380: {
    useTestMode: 'INSW_1380_USE_TEST_MODE',
    apiKey: 'INSW_1380_API_KEY',
    uniqueKeyTest: 'INSW_1380_UNIQUE_KEY_TEST',
    uniqueKeyReal: 'INSW_1380_UNIQUE_KEY_REAL',
    npwp: 'INSW_1380_NPWP',
  },
} as const;

export class UnsupportedINSWCompanyError extends Error {
  constructor(companyCode: number) {
    super(`INSW company ${companyCode} is not supported`);
    this.name = 'UnsupportedINSWCompanyError';
  }
}

export class MissingINSWCompanyConfigError extends Error {
  readonly companyCode: SupportedINSWCompanyCode;
  readonly missingVariable: string;

  constructor(companyCode: SupportedINSWCompanyCode, missingVariable: string) {
    super(`INSW configuration is incomplete for company ${companyCode}: ${missingVariable} is missing`);
    this.name = 'MissingINSWCompanyConfigError';
    this.companyCode = companyCode;
    this.missingVariable = missingVariable;
  }
}

export class InvalidINSWCompanyModeError extends Error {
  readonly companyCode: SupportedINSWCompanyCode;
  readonly variableName: string;

  constructor(companyCode: SupportedINSWCompanyCode, variableName: string) {
    super(`Invalid INSW mode for company ${companyCode}: ${variableName} must be "true" or "false"`);
    this.name = 'InvalidINSWCompanyModeError';
    this.companyCode = companyCode;
    this.variableName = variableName;
  }
}

function isSupportedINSWCompanyCode(companyCode: number): companyCode is SupportedINSWCompanyCode {
  return SUPPORTED_INSW_COMPANY_CODES.includes(companyCode as SupportedINSWCompanyCode);
}

function readCompanyEnvConfig(companyCode: SupportedINSWCompanyCode): INSWCompanyEnvConfig {
  const keys = INSW_COMPANY_ENV_KEYS[companyCode];

  return {
    useTestMode: process.env[keys.useTestMode],
    apiKey: process.env[keys.apiKey],
    uniqueKeyTest: process.env[keys.uniqueKeyTest],
    uniqueKeyReal: process.env[keys.uniqueKeyReal],
    npwp: process.env[keys.npwp],
  };
}

function requireEnvValue(
  companyCode: SupportedINSWCompanyCode,
  variableName: string,
  value: string | undefined
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new MissingINSWCompanyConfigError(companyCode, variableName);
  }

  return normalized;
}

function parseUseTestMode(
  companyCode: SupportedINSWCompanyCode,
  variableName: string,
  value: string | undefined
): boolean {
  const normalized = value?.trim();
  if (!normalized) {
    throw new MissingINSWCompanyConfigError(companyCode, variableName);
  }
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new InvalidINSWCompanyModeError(companyCode, variableName);
}

export function resolveInswCompanyConfig(companyCode: number): INSWCompanyConfig {
  if (!isSupportedINSWCompanyCode(companyCode)) {
    throw new UnsupportedINSWCompanyError(companyCode);
  }

  const keys = INSW_COMPANY_ENV_KEYS[companyCode];
  const envConfig = readCompanyEnvConfig(companyCode);
  const useTestMode = parseUseTestMode(companyCode, keys.useTestMode, envConfig.useTestMode);
  const uniqueKeyVariable = useTestMode ? keys.uniqueKeyTest : keys.uniqueKeyReal;
  const uniqueKeyValue = useTestMode ? envConfig.uniqueKeyTest : envConfig.uniqueKeyReal;

  return Object.freeze({
    companyCode,
    apiKey: requireEnvValue(companyCode, keys.apiKey, envConfig.apiKey),
    uniqueKeyTest: envConfig.uniqueKeyTest?.trim() || undefined,
    uniqueKeyReal: envConfig.uniqueKeyReal?.trim() || undefined,
    uniqueKey: requireEnvValue(companyCode, uniqueKeyVariable, uniqueKeyValue),
    npwp: envConfig.npwp?.trim() || undefined,
    useTestMode,
  });
}

export function resolveInswCompanyNpwp(companyCode: number): string {
  if (!isSupportedINSWCompanyCode(companyCode)) {
    throw new UnsupportedINSWCompanyError(companyCode);
  }

  const keys = INSW_COMPANY_ENV_KEYS[companyCode];
  const config = resolveInswCompanyConfig(companyCode);
  return requireEnvValue(companyCode, keys.npwp, config.npwp);
}
