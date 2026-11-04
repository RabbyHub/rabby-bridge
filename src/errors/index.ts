import { BRIDGE_ERRORS } from './constants.js';
import type { BridgeErrorDefinition } from './constants.js';

export { BRIDGE_ERRORS } from './constants.js';
export type { BridgeErrorCode, BridgeErrorStage, BridgeErrorDefinition } from './constants.js';

/** Reporting context deliberately excludes calldata, wallet addresses and provider response bodies. */
export type BridgeErrorContext = {
  aggregatorId?: string;
  chainId?: string;
  bridgeId?: string;
  provider?: string;
  method?: string;
  selector?: string;
  protocolSelector?: string;
  operation?: 'getQuote' | 'buildTx' | 'verifyTx' | 'verifyLayerSwapTx';
  unverifiedFields?: string[];
  httpStatus?: number;
};
export type BridgeErrorDetail = BridgeErrorDefinition & BridgeErrorContext;

export const bridgeFailure = (errors: BridgeErrorDetail[]) => {
  const failures = errors.length ? errors : [BRIDGE_ERRORS.UNKNOWN];
  return { ok: false as const, reason: failures.map((error) => error.message).join(','),
    error_code: failures[0].error_code, stage: failures[0].stage, errors: failures };
};

export class BridgeError extends Error {
  readonly error_code: BridgeErrorDetail['error_code'];
  readonly stage: BridgeErrorDetail['stage'];
  readonly errors: BridgeErrorDetail[];

  constructor(definition: BridgeErrorDefinition, context: BridgeErrorContext = {}, errors?: BridgeErrorDetail[]) {
    const failures = (errors?.length ? errors : [definition]).map((error) => ({ ...error, ...context }));
    super(failures.map((error) => error.message).join(','));
    this.name = 'BridgeError';
    this.errors = failures;
    this.error_code = failures[0].error_code;
    this.stage = failures[0].stage;
  }

  toJSON() {
    return { name: this.name, error_code: this.error_code, stage: this.stage, errors: this.errors };
  }
}

/** Preserve typed SDK failures; never copy an arbitrary transport exception into a report. */
export const asBridgeError = (
  error: unknown, fallback: BridgeErrorDefinition = BRIDGE_ERRORS.UNKNOWN, context: BridgeErrorContext = {}
): BridgeError => {
  if (error instanceof BridgeError) {
    for (const detail of error.errors) Object.assign(detail, context);
    return error;
  }
  return new BridgeError(fallback, context);
};

export type BridgeErrorReport = ReturnType<BridgeError['toJSON']>;
export type BridgeErrorReporter = (error: BridgeErrorReport) => void | Promise<void>;

/** Only used when an invalid quote is filtered; directly thrown failures stay with the caller. */
export const reportBridgeError = (report: BridgeErrorReporter | undefined, error: BridgeError, context: BridgeErrorContext) => {
  if (!report) return;
  try {
    void Promise.resolve(report({ ...error.toJSON(), errors: error.errors.map((item) => ({ ...item, ...context })) }))
      .catch(() => {});
  }
  catch { /* Reporting must not change which transactions pass validation. */ }
};
