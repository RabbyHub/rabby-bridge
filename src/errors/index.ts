import { BRIDGE_ERRORS } from './constants.js';
import type { BridgeErrorDefinition } from './constants.js';
import { sanitizeBridgeError } from './sanitize.js';

export { BRIDGE_ERRORS } from './constants.js';
export type { BridgeErrorCode, BridgeErrorStage, BridgeErrorDefinition } from './constants.js';

/** Reporting context deliberately excludes calldata, wallet addresses and provider response bodies. */
export type BridgeErrorContext = {
  lite?: boolean;
  blocking?: boolean;
  aggregatorId?: string;
  chainId?: string;
  toChainId?: string;
  bridgeId?: string;
  provider?: string;
  method?: string;
  selector?: string;
  routerSelector?: string;
  protocolSelector?: string;
  destinationSelectors?: string[];
  calldataFormat?: 'missing' | 'empty' | 'valid' | 'invalid';
  calldataBytes?: number;
  routerCalldataBytes?: number;
  protocolCalldataBytes?: number;
  destinationCalldataBytes?: number;
  destinationCallCount?: number;
  hasDestinationCall?: boolean;
  abiOffset?: number;
  abiBufferBytes?: number;
  commandByte?: number;
  commandCount?: number;
  requestKind?: 'relay_chains' | 'relay_quote' | 'socket_quote' | 'layerswap_orders' | 'backend_quote' | 'backend_build';
  operation?: 'getQuote' | 'buildTx' | 'verifyTx' | 'verifyLayerSwapTx';
  unverifiedFields?: string[];
  httpStatus?: number;
};
export type BridgeErrorDetail = BridgeErrorDefinition & BridgeErrorContext;

export const bridgeFailure = (errors: BridgeErrorDetail[]) => {
  const failures = (errors.length ? errors : [BRIDGE_ERRORS.UNKNOWN]).map(sanitizeBridgeError);
  return { ok: false as const, reason: failures.map((error) => error.message).join(','),
    error_code: failures[0].error_code, stage: failures[0].stage, errors: failures };
};

export class BridgeError extends Error {
  readonly error_code: BridgeErrorDetail['error_code'];
  readonly stage: BridgeErrorDetail['stage'];
  readonly errors: BridgeErrorDetail[];

  constructor(definition: BridgeErrorDefinition, context: BridgeErrorContext = {}, errors?: BridgeErrorDetail[]) {
    const failures = (errors?.length ? errors : [definition]).map((error) => sanitizeBridgeError({ ...error, ...context }));
    super(failures.map((error) => error.message).join(','));
    this.name = 'BridgeError';
    this.errors = failures;
    this.error_code = failures[0].error_code;
    this.stage = failures[0].stage;
  }

  toJSON() {
    const errors = (this.errors.length ? this.errors : [BRIDGE_ERRORS.UNKNOWN]).map(sanitizeBridgeError);
    const name = ['BridgeError', 'InvalidBridgeCalldataError', 'InvalidBridgeContractError', 'InvalidBridgeProviderError'].includes(this.name)
      ? this.name : 'BridgeError';
    return { name, error_code: errors[0].error_code, stage: errors[0].stage, errors };
  }
}

/** Preserve typed SDK failures; never copy an arbitrary transport exception into a report. */
export const asBridgeError = (
  error: unknown, fallback: BridgeErrorDefinition = BRIDGE_ERRORS.UNKNOWN, context: BridgeErrorContext = {}
): BridgeError => {
  if (error instanceof BridgeError) {
    error.errors.splice(0, error.errors.length, ...error.errors.map((detail) => sanitizeBridgeError({ ...detail, ...context })));
    return error;
  }
  return new BridgeError(fallback, context);
};

export type BridgeErrorReport = ReturnType<BridgeError['toJSON']>;
export type BridgeErrorReporter = (error: BridgeErrorReport) => void | Promise<void>;

/** Accept a check/decode result or exception; never serialize the result's parsed transaction. */
export const toBridgeErrorReport = (value: unknown): BridgeErrorReport | undefined => {
  if (value instanceof BridgeError) return value.toJSON();
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (result.ok === true) return undefined;
  const errors = Array.isArray(result.errors) ? result.errors.slice(0, 32).map(sanitizeBridgeError) : undefined;
  return new BridgeError(BRIDGE_ERRORS.UNKNOWN, {}, errors).toJSON();
};

/** Only used when an invalid quote is filtered; directly thrown failures stay with the caller. */
export const reportBridgeError = (report: BridgeErrorReporter | undefined, error: BridgeError, context: BridgeErrorContext) => {
  if (!report) return;
  try {
    const payload = asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, context).toJSON();
    void Promise.resolve(report(payload))
      .catch(() => {});
  }
  catch { /* Reporting must not change which transactions pass validation. */ }
};
