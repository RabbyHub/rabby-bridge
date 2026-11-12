import type { BridgeErrorCode, BridgeErrorStage, BridgeErrorDetail, BridgeErrorContext } from '../errors/index.js';
import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import type { BridgeAggregatorId } from '../consts.js';

export type BridgeTokenReference = {
  protocol: 'token' | 'cctp' | 'oft' | 'frax' | 'ccip' | 'polygon' | 'gnosis' | 'arbitrum' | 'superset' | 'hyperlane' | 'across-native' | 'centrifuge';
  contract?: string;
  token?: string;
  destinationChainId?: bigint;
  destinationChainRef?: string;
  destinationContract?: string;
  tokenId?: string;
};

export type BridgeAmountReference = {
  kind: 'decimals' | 'normalized' | 'dust' | 'scale' | 'fees';
  amount: bigint;
  token: BridgeTokenReference;
  decimals?: number;
  maxFee?: bigint;
};

export type ParsedBridgeCall = {
  aggregatorId: BridgeAggregatorId;
  method: string;
  kind: 'bridge' | 'swap' | 'deposit';
  sourceToken?: string;
  sourceAmount?: bigint;
  destinationChainId?: bigint;
  destinationChainRef?: string;
  receiver?: string;
  /** Refund beneficiaries encoded in this transaction, independent of final delivery. */
  refundRecipients?: string[];
  /** Set when a fixed allowlisted contract satisfies the receiver check. */
  fixedReceiver?: boolean;
  outputToken?: string;
  minOutputAmount?: bigint;
  orderId?: string;
  quoteId?: string;
  referrer?: string;
  protocolMethod?: string;
  spokePool?: string;
  innerTarget?: string;
  depositor?: string;
  bridgeToken?: string;
  bridgeAmount?: bigint;
  bridgeReceiver?: string;
  bridgeOutputToken?: string;
  bridgeOutputAmount?: bigint;
  requestId?: string;
  outputTokenReference?: BridgeTokenReference;
  outputAmountReference?: BridgeAmountReference;
  destinationCallData?: string;
  hasDestinationCall?: boolean;
  unresolvedFields?: string[];
  /** Non-personal call structure retained for unsupported-path diagnostics. */
  diagnostics?: BridgeErrorContext;
};

export type DecodeHit =
  | { ok: true; parsed: ParsedBridgeCall }
  | { ok: false; method?: string; reason: string; error_code: BridgeErrorCode; stage: BridgeErrorStage; errors: BridgeErrorDetail[] };

export type BridgeCheck = {
  ok: boolean;
  aggregatorId: string;
  method?: string;
  reason?: string;
  parsed?: ParsedBridgeCall;
  unverifiedFields?: string[];
  error_code?: BridgeErrorCode;
  stage?: BridgeErrorStage;
  errors: BridgeErrorDetail[];
};

export type BridgeCalldataTx = {
  to?: string;
  from?: string;
  chainId?: string | number | bigint;
  data?: string;
  input?: string;
  value?: string | number | bigint;
};

export const txCalldata = (tx: BridgeCalldataTx): string => tx.data || tx.input || '0x';

export const txValue = (tx: BridgeCalldataTx): bigint => {
  const { value } = tx;
  if (value === undefined || value === null || value === '') {
    return 0n;
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE);
  let amount: bigint;
  try { amount = BigInt(value); }
  catch { throw new BridgeError(BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE); }
  if (amount < 0n) throw new BridgeError(BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE);
  return amount;
};
