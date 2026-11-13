import type { OpenApiService } from '@rabby-wallet/rabby-api';
import type { BridgeErrorReporter } from './errors/index.js';
import type { BridgeCheck } from './calldata/types.js';

export interface BridgeValidationOptions {
  /** 接收报价过滤和 calldata 校验错误。 */
  onError?: BridgeErrorReporter;
  /** 仅供测试；生产环境勿传，缺少 Relay 订单数据时必须拒绝。 */
  allowMissingRelayOrder?: boolean;
}

export type BridgeValidationResult = {
  /** 最终放行结果，允许的未验证字段不影响此值。 */
  pass: boolean;
  routerPass: boolean;
  /** 字段校验结果；false 表示失败或未验证。 */
  fromPass: boolean;
  toPass: boolean;
  /** Socket 固定金库或 ClaimExecutor 路径可在此值为 false 时放行。 */
  receiverPass: boolean;
  /** 未与用户意图比较的字段，包括允许缺失的字段。 */
  unverifiedFields: string[];
  errors: BridgeCheck['errors'];
};

export interface BridgeQuoteListParams extends BridgeValidationOptions {
  userAddress: string;
  fromChainId: string;
  fromTokenId: string;
  fromTokenRawAmount: string;
  toChainId: string;
  toTokenId: string;
  slippage?: string;
  feeRate?: number;
}

export interface BridgeBuildTxParams extends BridgeQuoteListParams {
  bridgeId: string;
  quoteKey?: string | Record<string, unknown>;
  /** 报价输出数量，原始整数单位，未扣滑点。 */
  toTokenRawAmount?: string;
  /** 与本次构建交易对应的 Relay 订单数据。 */
  orderData?: unknown;
}

export type BridgeApi = Pick<
  OpenApiService,
  | 'getBridgeQuoteListV2'
  | 'getBridgeQuoteV2'
  | 'buildBridgeTx'
  | 'getBridgeQuoteTxV2'
>;

export type BridgeQuote = Awaited<ReturnType<BridgeApi['getBridgeQuoteTxV2']>>;

export type BridgeTx =
  | Awaited<ReturnType<BridgeApi['buildBridgeTx']>>
  | NonNullable<BridgeQuote['tx']>;

export type BridgeQuoteListItem = Awaited<
  ReturnType<BridgeApi['getBridgeQuoteV2']>
>[number];
