import type { OpenApiService } from '@rabby-wallet/rabby-api';
import type { BridgeErrorReporter } from './errors/index.js';
import type { BridgeCheck } from './calldata/types.js';
import type { BRIDGE_ENUM } from './consts.js';

export type DepositBridgeAggregatorId =
  | typeof BRIDGE_ENUM.RELAY
  | typeof BRIDGE_ENUM.ACROSS;

export interface BridgeValidationOptions {
  /** 接收报价过滤和 calldata 校验错误。 */
  onError?: BridgeErrorReporter;
  /** 仅供测试或灰度过渡（后端尚未透传 Relay order_data 前）；生产默认关闭，缺少 Relay 订单数据时必须拒绝。 */
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

export interface DepositBridgeQuote {
  bridge_id?: string;
  approve_contract_id?: string | null;
  to_token_raw_amount?: number | string;
  to_token_raw_amount_hex_str?: string;
  order_data?: unknown;
  tx?: (BridgeTx & { order_data?: unknown }) | null;
}

export interface DepositBridgeValidationParams extends BridgeValidationOptions {
  /** 聚合器 ID；未传时回退 quote.bridge_id，单段式充值仅允许 relay / across。 */
  aggregatorId?: string;
  /** 发起用户地址（付款人与退款人校验基准）。 */
  userAddress: string;
  /** 目标收款人地址（Perps 为用户地址，Gas Account 为官方归集地址；未传时回退 userAddress）。 */
  receiverAddress?: string;
  fromChainId: string;
  fromTokenId: string;
  fromTokenRawAmount: string;
  toChainId: string;
  toTokenId: string;
  /** 期望输出数量（原始整数单位）；未传时从 quote.to_token_raw_amount_hex_str / to_token_raw_amount 读取。 */
  toTokenRawAmount?: string;
  /** 小数滑点，默认 '0'。 */
  slippage?: string | number;
  /** Relay 订单数据；未传时自动读取 quote.order_data 或 quote.tx.order_data。 */
  orderData?: unknown;
}
