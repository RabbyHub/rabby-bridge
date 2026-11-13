import type { BridgeErrorContext, BridgeErrorDefinition } from './errors/index.js';
import { BRIDGE_ERRORS, BridgeError, asBridgeError, reportBridgeError } from './errors/index.js';
import { InvalidBridgeCalldataError, validateBridgeCalldata } from './calldata/index.js';
import type { BridgeCallExpectation } from './calldata/expect.js';
import { finishCheck, knownCompare } from './calldata/expect.js';
import type { BridgeCheck } from './calldata/types.js';
import { calldataDiagnostics } from './calldata/diagnostics.js';
import { sanitizeBridgeError } from './errors/sanitize.js';
import { BRIDGE_ENUM } from './consts.js';
import type { BridgeAggregatorId } from './consts.js';
import { getBridgeAltContracts, getBridgeRouter, getBridgeSpender } from './list.js';
import { verifyRelayOrder } from './calldata/relay/order.js';
import type {
  BridgeValidationOptions,
  BridgeValidationResult,
  BridgeQuoteListItem,
  BridgeTx,
} from './types.js';

// ---- 合约白名单 ----

export class InvalidBridgeContractError extends BridgeError {
  constructor(
    public readonly kind: 'spender' | 'router',
    public readonly aggregatorId: BridgeAggregatorId,
    public readonly chainId: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly bridgeId?: string,
  ) {
    super(
      kind === 'router'
        ? BRIDGE_ERRORS.ROUTER_NOT_ALLOWED
        : BRIDGE_ERRORS.SPENDER_NOT_ALLOWED,
      { aggregatorId, chainId, bridgeId },
    );
    this.message = `Invalid bridge ${kind} for ${aggregatorId} on ${chainId}: expected ${expected}, got ${received}`;
    this.name = 'InvalidBridgeContractError';
  }
}

const isSameAddress = (left?: string, right?: string) => {
  if (!left || !right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
};

const shouldValidateBridgeContracts = (aggregatorId: BridgeAggregatorId) =>
  aggregatorId !== BRIDGE_ENUM.NEAR_INTENTS;

export const validateBridgeQuote = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  quote: BridgeQuoteListItem,
) => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return true;
  }

  const expectedSpender = getBridgeSpender(aggregatorId, fromChainId);
  const receivedSpender = quote.approve_contract_id;

  if (!receivedSpender) {
    return true;
  }
  if (!expectedSpender) {
    throw new InvalidBridgeContractError(
      'spender',
      aggregatorId,
      fromChainId,
      'configured spender',
      receivedSpender,
      quote.bridge_id,
    );
  }

  const allowedSpenders = [
    expectedSpender,
    ...getBridgeAltContracts(aggregatorId),
  ];

  if (!allowedSpenders.some((addr) => isSameAddress(addr, receivedSpender))) {
    throw new InvalidBridgeContractError(
      'spender',
      aggregatorId,
      fromChainId,
      expectedSpender,
      receivedSpender,
      quote.bridge_id,
    );
  }

  return true;
};

const validateBridgeRouter = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
): true => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return true;
  }

  const expectedRouter = getBridgeRouter(aggregatorId, fromChainId);
  const allowedRouters = [
    ...(expectedRouter ? [expectedRouter] : []),
    ...getBridgeAltContracts(aggregatorId),
  ];

  if (!allowedRouters.some((addr) => isSameAddress(addr, tx.to))) {
    throw asBridgeError(
      new InvalidBridgeContractError(
        'router',
        aggregatorId,
        fromChainId,
        expectedRouter || allowedRouters.join(',') || 'configured router',
        tx.to,
        bridgeId,
      ),
      BRIDGE_ERRORS.ROUTER_NOT_ALLOWED,
      {
        ...calldataDiagnostics(tx.data),
        pass: false,
        routerPass: false,
        fromPass: false,
        toPass: false,
        receiverPass: false,
        blocking: true,
      },
    );
  }
  return true;
};

// ---- 交易校验与放行 ----

const fieldErrors: Record<
  'fromPass' | 'toPass' | 'receiverPass',
  BridgeErrorDefinition[]
> = {
  fromPass: [
    BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH,
    BRIDGE_ERRORS.FROM_CHAIN_MISMATCH,
    BRIDGE_ERRORS.FROM_TOKEN_MISMATCH,
    BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH,
    BRIDGE_ERRORS.DEPOSITOR_MISMATCH,
    BRIDGE_ERRORS.MISSING_SOURCE_TOKEN,
    BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT,
  ],
  toPass: [
    BRIDGE_ERRORS.TO_CHAIN_MISMATCH,
    BRIDGE_ERRORS.TO_TOKEN_MISMATCH,
    BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH,
    BRIDGE_ERRORS.MISSING_DESTINATION,
    BRIDGE_ERRORS.MISSING_DESTINATION_CHAIN,
    BRIDGE_ERRORS.MISSING_OUTPUT_TOKEN,
    BRIDGE_ERRORS.MISSING_MIN_OUTPUT,
    BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL,
    BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_SHAPE,
  ],
  receiverPass: [
    BRIDGE_ERRORS.RECEIVER_MISMATCH,
    BRIDGE_ERRORS.MISSING_RECEIVER,
    BRIDGE_ERRORS.REFUND_RECIPIENT_MISMATCH,
    BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL,
    BRIDGE_ERRORS.RELAY_REFUND_RECIPIENT_MISMATCH,
    BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH,
    BRIDGE_ERRORS.MISSING_RELAY_ORDER_DATA,
  ],
};

const bindingErrors: BridgeErrorDefinition[] = [
  BRIDGE_ERRORS.QUOTE_ID_MISMATCH,
  BRIDGE_ERRORS.SOCKET_RFQ_QUOTE_ID_MISMATCH,
];

export const checkBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  expectation?: BridgeCallExpectation,
  options: BridgeValidationOptions = {},
  operation: 'buildTx' | 'verifyTx' = 'verifyTx',
): BridgeValidationResult => {
  // 先检查 Router，再解析并核对交易参数。
  const routerPass = validateBridgeRouter(
    aggregatorId,
    fromChainId,
    bridgeId,
    tx,
  );
  let check: BridgeCheck;
  try {
    check = validateBridgeCalldata(aggregatorId, fromChainId, tx, expectation);
  } catch (error) {
    check = {
      ok: false,
      aggregatorId,
      errors: asBridgeError(error, BRIDGE_ERRORS.INVALID_CALLDATA).errors,
    };
  }
  // Relay 目标条件来自与入金 orderId 绑定的 order_data。
  const enforceRelayOrder =
    aggregatorId === BRIDGE_ENUM.RELAY &&
    (options.allowMissingRelayOrder !== true ||
      expectation?.orderData !== undefined);
  if (enforceRelayOrder) {
    const orderErrors =
      expectation?.orderData === undefined
        ? [BRIDGE_ERRORS.MISSING_RELAY_ORDER_DATA]
        : check.parsed?.orderId
          ? verifyRelayOrder(
              expectation.orderData,
              check.parsed,
              fromChainId,
              expectation.userAddress,
              tx.to,
            )
          : [BRIDGE_ERRORS.MISSING_RELAY_ORDER_ID];
    if (orderErrors.length === 0 && check.parsed) {
      // 订单验证通过后，再与用户目标条件比较。
      const verified = finishCheck(
        'relay',
        check.parsed,
        expectation?.toChainId
          ? undefined
          : BRIDGE_ERRORS.MISSING_DESTINATION_CHAIN,
        expectation,
        fromChainId,
        knownCompare(check.parsed),
      );
      check = {
        ...check,
        ok: check.ok && verified.ok,
        unverifiedFields: verified.unverifiedFields,
        errors: [
          ...check.errors,
          ...verified.errors.filter(
            (error) =>
              !check.errors.some(
                (existing) => existing.error_code === error.error_code,
              ),
          ),
        ],
      };
    }
    check = {
      ...check,
      ok: check.ok && orderErrors.length === 0,
      errors: [
        ...check.errors,
        ...orderErrors.filter(
          (error) =>
            !check.errors.some(
              (existing) => existing.error_code === error.error_code,
            ),
        ),
      ],
    };
  }
  const unverifiedFields = check.unverifiedFields ?? [
    'sourceToken',
    'sourceAmount',
    'outputToken',
    'minOutputAmount',
    'receiver',
    ...(expectation?.toChainId ? ['destinationChainId'] : []),
  ];
  // Socket 已核对固定合约和 spender，允许缺少最终收款人或目标链。
  // Relay 生产流程仍须通过上面的订单校验。
  const externalDestination =
    check.parsed &&
    ((aggregatorId === BRIDGE_ENUM.RELAY &&
      check.parsed.destinationChainId === undefined) ||
      (aggregatorId === BRIDGE_ENUM.SOCKET &&
        ['receiveERC20', 'receiveNative', 'depositForBurn'].includes(
          check.parsed.protocolMethod ?? '',
        )));
  // 允许缺失的字段只标记未验证，不阻断、不上报。
  const reportableFields = unverifiedFields.filter((field) => {
    if (!check.parsed) return true;
    if (field === 'outputToken') return false;
    if (field === 'minOutputAmount')
      return check.parsed.minOutputAmount !== undefined;
    return !(
      externalDestination && ['receiver', 'destinationChainId'].includes(field)
    );
  });
  // 未归类的结构错误使所有字段标记失败；已归类错误只影响对应字段。
  const comparable =
    Boolean(expectation && check.parsed) &&
    check.errors.every(
      (error) =>
        bindingErrors.some((item) => item.error_code === error.error_code) ||
        Object.values(fieldErrors).some((group) =>
          group.some((item) => item.error_code === error.error_code),
        ),
    );
  const fieldPass = (field: keyof typeof fieldErrors, required: string[]) =>
    comparable &&
    required.every((item) => !unverifiedFields.includes(item)) &&
    !check.errors.some((error) =>
      fieldErrors[field].some((item) => item.error_code === error.error_code),
    );
  // 放行不要求所有字段标记为 true，允许保留未验证字段。
  const flags = {
    pass: routerPass && !check.errors.length && !reportableFields.length,
    routerPass,
    fromPass: fieldPass('fromPass', ['sourceToken', 'sourceAmount']),
    toPass: fieldPass('toPass', [
      'outputToken',
      'minOutputAmount',
      ...(expectation?.toChainId ? ['destinationChainId'] : []),
    ]),
    receiverPass: fieldPass('receiverPass', ['receiver']),
  };
  const context: BridgeErrorContext = {
    ...check.parsed?.diagnostics,
    ...calldataDiagnostics(tx.data),
    aggregatorId,
    chainId: fromChainId,
    toChainId: expectation?.toChainId,
    bridgeId,
    operation,
    method: check.method,
    ...(check.parsed
      ? {
          hasDestinationCall: Boolean(
            check.parsed.hasDestinationCall ||
            check.parsed.destinationCallData !== undefined,
          ),
        }
      : {}),
    ...flags,
    blocking: true,
  };
  const errors = [
    ...check.errors,
    ...(reportableFields.length
      ? [
          {
            ...BRIDGE_ERRORS.UNVERIFIED_BRIDGE_FIELDS,
            unverifiedFields: reportableFields,
          },
        ]
      : []),
  ].map((error) => sanitizeBridgeError({ ...error, ...context }));
  if (errors.length) {
    const error = new InvalidBridgeCalldataError(
      aggregatorId,
      fromChainId,
      check.method,
      check.reason || errors[0].message,
      errors,
    );
    reportBridgeError(options.onError, error, context);
    throw error;
  }
  return { ...flags, unverifiedFields, errors };
};

export const validateBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  expectation?: BridgeCallExpectation,
  options: BridgeValidationOptions = {},
): BridgeValidationResult =>
  checkBridgeTx(aggregatorId, fromChainId, bridgeId, tx, expectation, options);
