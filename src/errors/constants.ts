/** Stable reporting codes. Add new entries; do not reuse or rename existing error_code values. */
export const BRIDGE_ERRORS = {
  // input — 调用参数与交易基本信息
  MISSING_BUILD_API: {
    error_code: 'BRIDGE_MISSING_BUILD_API',
    stage: 'input',
    message: 'Bridge API does not provide a build tx method',
  },
  MISSING_QUOTE_API: {
    error_code: 'BRIDGE_MISSING_QUOTE_API',
    stage: 'input',
    message: 'Bridge API does not provide a quote list method',
  },
  DIRECT_PROVIDER_CLIENT_IS_REQUIRED: {
    error_code: 'BRIDGE_DIRECT_PROVIDER_CLIENT_IS_REQUIRED',
    stage: 'input',
    message: 'direct provider client is required',
  },
  FROM_ADDRESS_MISMATCH: {
    error_code: 'BRIDGE_FROM_ADDRESS_MISMATCH',
    stage: 'input',
    message: 'from_address',
  },
  FROM_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_FROM_CHAIN_MISMATCH',
    stage: 'input',
    message: 'from_chain',
  },
  INVALID_SOCKET_API: {
    error_code: 'BRIDGE_INVALID_SOCKET_API',
    stage: 'input',
    message: 'invalid Socket API',
  },
  INVALID_PROVIDER_TIMEOUT: {
    error_code: 'BRIDGE_INVALID_PROVIDER_TIMEOUT',
    stage: 'input',
    message: 'invalid provider timeout',
  },
  INVALID_QUOTE_KEY: {
    error_code: 'BRIDGE_INVALID_QUOTE_KEY',
    stage: 'input',
    message: 'invalid quote key',
  },
  INVALID_TRANSACTION_VALUE: {
    error_code: 'BRIDGE_INVALID_TRANSACTION_VALUE',
    stage: 'input',
    message: 'invalid transaction value',
  },
  SLIPPAGE_IS_REQUIRED_FOR_THIS_API_CALL: {
    error_code: 'BRIDGE_SLIPPAGE_IS_REQUIRED_FOR_THIS_API_CALL',
    stage: 'input',
    message: 'slippage is required for this API call',
  },
  UNSUPPORTED_BRIDGE_AGGREGATOR: {
    error_code: 'BRIDGE_UNSUPPORTED_BRIDGE_AGGREGATOR',
    stage: 'input',
    message: 'unsupported bridge aggregator',
  },
  UNSUPPORTED_CHAIN: {
    error_code: 'BRIDGE_UNSUPPORTED_CHAIN',
    stage: 'input',
    message: 'unsupported chain',
  },
  UNSUPPORTED_DIRECT_PROVIDER: {
    error_code: 'BRIDGE_UNSUPPORTED_DIRECT_PROVIDER',
    stage: 'input',
    message: 'unsupported direct provider',
  },
  UNSUPPORTED_FEE_RATE: {
    error_code: 'BRIDGE_UNSUPPORTED_FEE_RATE',
    stage: 'input',
    message: 'unsupported fee rate',
  },
  UNSUPPORTED_SOURCE_CHAIN: {
    error_code: 'BRIDGE_UNSUPPORTED_SOURCE_CHAIN',
    stage: 'input',
    message: 'unsupported source chain',
  },
  // contract — Router / Spender 白名单
  ROUTER_NOT_ALLOWED: {
    error_code: 'BRIDGE_ROUTER_NOT_ALLOWED',
    stage: 'contract',
    message: 'router is not in the allowlist',
  },
  SPENDER_NOT_ALLOWED: {
    error_code: 'BRIDGE_SPENDER_NOT_ALLOWED',
    stage: 'contract',
    message: 'spender is not in the allowlist',
  },
  // decode — Selector 与 ABI 解码
  ABI_ARRAY_TOO_LONG: {
    error_code: 'BRIDGE_ABI_ARRAY_TOO_LONG',
    stage: 'decode',
    message: 'calldata array is too long',
  },
  ABI_BYTES_OUT_OF_BOUNDS: {
    error_code: 'BRIDGE_ABI_BYTES_OUT_OF_BOUNDS',
    stage: 'decode',
    message: 'calldata bytes overrun',
  },
  CALLDATA_DECODE_FAILED: {
    error_code: 'BRIDGE_CALLDATA_DECODE_FAILED',
    stage: 'decode',
    message: 'calldata does not match the method',
  },
  ABI_WORD_OUT_OF_BOUNDS: {
    error_code: 'BRIDGE_ABI_WORD_OUT_OF_BOUNDS',
    stage: 'decode',
    message: 'calldata ended before the next word',
  },
  ABI_OFFSET_OUT_OF_BOUNDS: {
    error_code: 'BRIDGE_ABI_OFFSET_OUT_OF_BOUNDS',
    stage: 'decode',
    message: 'calldata offset is out of range',
  },
  EXPECTED_ARRAY: {
    error_code: 'BRIDGE_EXPECTED_ARRAY',
    stage: 'decode',
    message: 'expected array',
  },
  EXPECTED_STRING: {
    error_code: 'BRIDGE_EXPECTED_STRING',
    stage: 'decode',
    message: 'expected string',
  },
  EXPECTED_TUPLE: {
    error_code: 'BRIDGE_EXPECTED_TUPLE',
    stage: 'decode',
    message: 'expected tuple',
  },
  EXPECTED_UINT: {
    error_code: 'BRIDGE_EXPECTED_UINT',
    stage: 'decode',
    message: 'expected uint',
  },
  INVALID_ABI_ADDRESS: {
    error_code: 'BRIDGE_INVALID_ABI_ADDRESS',
    stage: 'decode',
    message: 'invalid ABI address',
  },
  INVALID_BOOL: {
    error_code: 'BRIDGE_INVALID_BOOL',
    stage: 'decode',
    message: 'invalid bool',
  },
  INVALID_CALLDATA: {
    error_code: 'BRIDGE_INVALID_CALLDATA',
    stage: 'decode',
    message: 'invalid calldata',
  },
  INVALID_HEX: {
    error_code: 'BRIDGE_INVALID_HEX',
    stage: 'decode',
    message: 'invalid hex',
  },
  INVALID_SELECTOR: {
    error_code: 'BRIDGE_INVALID_SELECTOR',
    stage: 'decode',
    message: 'invalid selector',
  },
  MISSING_CALLDATA: {
    error_code: 'BRIDGE_MISSING_CALLDATA',
    stage: 'decode',
    message: 'missing calldata',
  },
  MISSING_SELECTOR: {
    error_code: 'BRIDGE_MISSING_SELECTOR',
    stage: 'decode',
    message: 'missing selector',
  },
  UNSUPPORTED_ABI_TYPE: {
    error_code: 'BRIDGE_UNSUPPORTED_ABI_TYPE',
    stage: 'decode',
    message: 'unsupported abi type',
  },
  UNSUPPORTED_METHOD: {
    error_code: 'BRIDGE_UNSUPPORTED_METHOD',
    stage: 'decode',
    message: 'unsupported method',
  },
  UNSUPPORTED_CALLDATA_AGGREGATOR: {
    error_code: 'BRIDGE_UNSUPPORTED_CALLDATA_AGGREGATOR',
    stage: 'decode',
    message: 'no calldata parser for this aggregator',
  },
  UNRECOGNIZED_MAYAN_PROTOCOL_CALLDATA: {
    error_code: 'BRIDGE_UNRECOGNIZED_MAYAN_PROTOCOL_CALLDATA',
    stage: 'decode',
    message: 'unrecognized mayan protocol calldata',
  },
  UNRECOGNIZED_SOCKET_BRIDGE_CALLDATA: {
    error_code: 'BRIDGE_UNRECOGNIZED_SOCKET_BRIDGE_CALLDATA',
    stage: 'decode',
    message: 'unrecognized socket bridge calldata',
  },
  UNRECOGNIZED_SOCKET_ROUTER_CALLDATA: {
    error_code: 'BRIDGE_UNRECOGNIZED_SOCKET_ROUTER_CALLDATA',
    stage: 'decode',
    message: 'unrecognized socket router calldata',
  },
  UNSUPPORTED_MAYAN_PROTOCOL_CALLDATA: {
    error_code: 'BRIDGE_UNSUPPORTED_MAYAN_PROTOCOL_CALLDATA',
    stage: 'decode',
    message: 'unsupported Mayan protocol calldata',
  },
  // structure — 协议结构、资产流和目标调用约束
  UNSUPPORTED_NON_EVM_M0_DESTINATION: {
    error_code: 'BRIDGE_UNSUPPORTED_NON_EVM_M0_DESTINATION',
    stage: 'structure',
    message: 'unsupported non-EVM M0 destination',
  },
  M0_REFUND_RECIPIENT_MISMATCH: {
    error_code: 'BRIDGE_M0_REFUND_RECIPIENT_MISMATCH',
    stage: 'structure',
    message: 'M0 refund recipient mismatch',
  },
  M0_RECEIVER_MISMATCH: {
    error_code: 'BRIDGE_M0_RECEIVER_MISMATCH',
    stage: 'structure',
    message: 'M0 receiver mismatch',
  },
  ACROSS_FALLBACK_RECEIVER_MISMATCH: {
    error_code: 'BRIDGE_ACROSS_FALLBACK_RECEIVER_MISMATCH',
    stage: 'structure',
    message: 'Across fallback recipient does not match the payout',
  },
  ACROSS_FALLBACK_TOKEN_MISMATCH: {
    error_code: 'BRIDGE_ACROSS_FALLBACK_TOKEN_MISMATCH',
    stage: 'structure',
    message: 'Across fallback token does not match the payout',
  },
  ACROSS_NATIVE_VALUE_MISMATCH: {
    error_code: 'BRIDGE_ACROSS_NATIVE_VALUE_MISMATCH',
    stage: 'structure',
    message: 'Across native value does not match input amount',
  },
  ACROSS_SWAP_VALUE_MISMATCH: {
    error_code: 'BRIDGE_ACROSS_SWAP_VALUE_MISMATCH',
    stage: 'structure',
    message: 'Across native value does not match swap amount',
  },
  ALLBRIDGE_RECEIVER_MISMATCH: {
    error_code: 'BRIDGE_ALLBRIDGE_RECEIVER_MISMATCH',
    stage: 'structure',
    message: 'AllBridge receiver mismatch',
  },
  CCIP_REQUIRES_ONE_BRIDGE_ASSET: {
    error_code: 'BRIDGE_CCIP_REQUIRES_ONE_BRIDGE_ASSET',
    stage: 'structure',
    message: 'CCIP requires one bridge asset',
  },
  CENTRIFUGE_REFUND_RECIPIENT_MISMATCH: {
    error_code: 'BRIDGE_CENTRIFUGE_REFUND_RECIPIENT_MISMATCH',
    stage: 'structure',
    message: 'Centrifuge refund recipient mismatch',
  },
  HYPERLANE_BALANCE_AMOUNT_REQUIRES_EXECUTION_STATE: {
    error_code: 'BRIDGE_HYPERLANE_BALANCE_AMOUNT_REQUIRES_EXECUTION_STATE',
    stage: 'structure',
    message: 'Hyperlane balance amount requires execution state',
  },
  HYPERLANE_COMMAND_LENGTH_MISMATCH: {
    error_code: 'BRIDGE_HYPERLANE_COMMAND_LENGTH_MISMATCH',
    stage: 'structure',
    message: 'Hyperlane command length mismatch',
  },
  SOCKET_CCTP_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET: {
    error_code: 'BRIDGE_SOCKET_CCTP_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET',
    stage: 'structure',
    message: 'Socket CCTP token does not match bridge asset',
  },
  SOCKET_RFQ_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET: {
    error_code: 'BRIDGE_SOCKET_RFQ_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET',
    stage: 'structure',
    message: 'Socket RFQ token does not match bridge asset',
  },
  SOCKET_ALLOWANCE_AMOUNT_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_ALLOWANCE_AMOUNT_MISMATCH',
    stage: 'structure',
    message: 'Socket allowance does not match the source amount',
  },
  SOCKET_ALLOWANCE_TOKEN_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_ALLOWANCE_TOKEN_MISMATCH',
    stage: 'structure',
    message: 'Socket allowance token does not match the source input',
  },
  SOCKET_DEPOSIT_AMOUNT_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_DEPOSIT_AMOUNT_MISMATCH',
    stage: 'structure',
    message: 'Socket deposit amount does not match net input',
  },
  SOCKET_NATIVE_VALUE_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_NATIVE_VALUE_MISMATCH',
    stage: 'structure',
    message: 'Socket native value does not match source input',
  },
  BRIDGE_FEES_EXCEED_THE_INPUT_AMOUNT: {
    error_code: 'BRIDGE_BRIDGE_FEES_EXCEED_THE_INPUT_AMOUNT',
    stage: 'structure',
    message: 'bridge fees exceed the input amount',
  },
  BRIDGE_OFFSET_EXCEEDS_CALLDATA: {
    error_code: 'BRIDGE_BRIDGE_OFFSET_EXCEEDS_CALLDATA',
    stage: 'structure',
    message: 'bridge offset exceeds calldata',
  },
  BRIDGE_SPLICE_DOES_NOT_TARGET_THE_INPUT_AMOUNT: {
    error_code: 'BRIDGE_BRIDGE_SPLICE_DOES_NOT_TARGET_THE_INPUT_AMOUNT',
    stage: 'structure',
    message: 'bridge splice does not target the input amount',
  },
  INVALID_FASTMCTP_REFERRER_FEE: {
    error_code: 'BRIDGE_INVALID_FASTMCTP_REFERRER_FEE',
    stage: 'structure',
    message: 'invalid FastMCTP referrer fee',
  },
  INVALID_SUPERSET_OMNI_TOKEN_PATH: {
    error_code: 'BRIDGE_INVALID_SUPERSET_OMNI_TOKEN_PATH',
    stage: 'structure',
    message: 'invalid Superset omni-token path',
  },
  INVALID_BRIDGE_OFFSET: {
    error_code: 'BRIDGE_INVALID_BRIDGE_OFFSET',
    stage: 'structure',
    message: 'invalid bridge offset',
  },
  MISSING_HYPERLANE_TRANSFER: {
    error_code: 'BRIDGE_MISSING_HYPERLANE_TRANSFER',
    stage: 'structure',
    message: 'missing Hyperlane transfer',
  },
  MISSING_MEGAETH_DESTINATION_TOKEN: {
    error_code: 'BRIDGE_MISSING_MEGAETH_DESTINATION_TOKEN',
    stage: 'structure',
    message: 'missing MegaETH destination token',
  },
  MISSING_DESTINATION: {
    error_code: 'BRIDGE_MISSING_DESTINATION',
    stage: 'structure',
    message: 'missing destination',
  },
  MISSING_DESTINATION_CHAIN: {
    error_code: 'BRIDGE_MISSING_DESTINATION_CHAIN',
    stage: 'structure',
    message: 'missing destination chain',
  },
  MISSING_MIN_OUTPUT: {
    error_code: 'BRIDGE_MISSING_MIN_OUTPUT',
    stage: 'structure',
    message: 'missing min output',
  },
  MISSING_OUTPUT_TOKEN: {
    error_code: 'BRIDGE_MISSING_OUTPUT_TOKEN',
    stage: 'structure',
    message: 'missing output token',
  },
  MISSING_QUOTE_ID: {
    error_code: 'BRIDGE_MISSING_QUOTE_ID',
    stage: 'structure',
    message: 'missing quote id',
  },
  MISSING_RECEIVER: {
    error_code: 'BRIDGE_MISSING_RECEIVER',
    stage: 'structure',
    message: 'missing receiver',
  },
  MISSING_RELAY_ORDER_ID: {
    error_code: 'BRIDGE_MISSING_RELAY_ORDER_ID',
    stage: 'structure',
    message: 'missing relay order id',
  },
  MISSING_SOURCE_AMOUNT: {
    error_code: 'BRIDGE_MISSING_SOURCE_AMOUNT',
    stage: 'structure',
    message: 'missing source amount',
  },
  MISSING_SOURCE_TOKEN: {
    error_code: 'BRIDGE_MISSING_SOURCE_TOKEN',
    stage: 'structure',
    message: 'missing source token',
  },
  MULTIPLE_SOURCE_ASSETS_ARE_NOT_SUPPORTED: {
    error_code: 'BRIDGE_MULTIPLE_SOURCE_ASSETS_ARE_NOT_SUPPORTED',
    stage: 'structure',
    message: 'multiple source assets are not supported',
  },
  SPOKE_POOL_IS_NOT_IN_THE_ALLOWLIST: {
    error_code: 'BRIDGE_SPOKE_POOL_IS_NOT_IN_THE_ALLOWLIST',
    stage: 'structure',
    message: 'spoke pool is not in the allowlist',
  },
  UNSUPPORTED_HYPERLANE_OPERATION: {
    error_code: 'BRIDGE_UNSUPPORTED_HYPERLANE_OPERATION',
    stage: 'structure',
    message: 'unsupported Hyperlane operation',
  },
  UNSUPPORTED_RELAY_SOURCE_ASSET_LIST: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_SOURCE_ASSET_LIST',
    stage: 'structure',
    message: 'unsupported Relay source asset list',
  },
  UNSUPPORTED_SOCKET_CCTP_TARGET_SPENDER_OR_VALUE: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_CCTP_TARGET_SPENDER_OR_VALUE',
    stage: 'structure',
    message: 'unsupported Socket CCTP target, spender or value',
  },
  UNSUPPORTED_SOCKET_RFQ_TARGET_SPENDER_OR_VALUE: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_RFQ_TARGET_SPENDER_OR_VALUE',
    stage: 'structure',
    message: 'unsupported Socket RFQ target, spender or value',
  },
  UNSUPPORTED_SOCKET_OPERATOR_OR_ROUTER: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_OPERATOR_OR_ROUTER',
    stage: 'structure',
    message: 'unsupported Socket operator or router',
  },
  UNSUPPORTED_DESTINATION_CALL: {
    error_code: 'BRIDGE_UNSUPPORTED_DESTINATION_CALL',
    stage: 'structure',
    message: 'unsupported destination call',
  },
  UNSUPPORTED_NON_EVM_FRAX_RECEIVER: {
    error_code: 'BRIDGE_UNSUPPORTED_NON_EVM_FRAX_RECEIVER',
    stage: 'structure',
    message: 'unsupported non-EVM Frax receiver',
  },
  UNSUPPORTED_SWAPS_XYZ_EXECUTION: {
    error_code: 'BRIDGE_UNSUPPORTED_SWAPS_XYZ_EXECUTION',
    stage: 'structure',
    message: 'unsupported swaps-xyz execution',
  },
  // intent — 解析结果与用户意图的字段比对
  QUOTE_ID_MISMATCH: {
    error_code: 'BRIDGE_QUOTE_ID_MISMATCH',
    stage: 'intent',
    message: 'transaction quote ID does not match the selected quote',
  },
  REQUEST_ID_MISMATCH: {
    error_code: 'BRIDGE_REQUEST_ID_MISMATCH',
    stage: 'intent',
    message: 'transaction request ID does not match the selected quote',
  },
  SOCKET_RFQ_QUOTE_ID_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_RFQ_QUOTE_ID_MISMATCH',
    stage: 'intent',
    message: 'Socket RFQ outer and vault quote IDs do not match',
  },
  DEPOSITOR_MISMATCH: {
    error_code: 'BRIDGE_DEPOSITOR_MISMATCH',
    stage: 'intent',
    message: 'depositor',
  },
  FROM_AMOUNT_MISMATCH: {
    error_code: 'BRIDGE_FROM_AMOUNT_MISMATCH',
    stage: 'intent',
    message: 'from_amount',
  },
  FROM_TOKEN_MISMATCH: {
    error_code: 'BRIDGE_FROM_TOKEN_MISMATCH',
    stage: 'intent',
    message: 'from_token',
  },
  MIN_RECEIVE_MISMATCH: {
    error_code: 'BRIDGE_MIN_RECEIVE_MISMATCH',
    stage: 'intent',
    message: 'min_receive',
  },
  RECEIVER_MISMATCH: {
    error_code: 'BRIDGE_RECEIVER_MISMATCH',
    stage: 'intent',
    message: 'receiver',
  },
  TO_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_TO_CHAIN_MISMATCH',
    stage: 'intent',
    message: 'to_chain',
  },
  TO_TOKEN_MISMATCH: {
    error_code: 'BRIDGE_TO_TOKEN_MISMATCH',
    stage: 'intent',
    message: 'to_token',
  },
  // provider_request — 当前 后端 / 服务商请求、超时和分页
  PROVIDER_HTTP_ERROR: {
    error_code: 'BRIDGE_PROVIDER_HTTP_ERROR',
    stage: 'provider_request',
    message: 'Bridge provider HTTP error',
  },
  LAYERSWAP_LOOKUP_TIMED_OUT: {
    error_code: 'BRIDGE_LAYERSWAP_LOOKUP_TIMED_OUT',
    stage: 'provider_request',
    message: 'LayerSwap lookup timed out',
  },
  LAYERSWAP_ORDER_NOT_FOUND: {
    error_code: 'BRIDGE_LAYERSWAP_ORDER_NOT_FOUND',
    stage: 'provider_request',
    message: 'LayerSwap order was not found within the lookup limit',
  },
  LAYERSWAP_PAGINATION_DID_NOT_ADVANCE: {
    error_code: 'BRIDGE_LAYERSWAP_PAGINATION_DID_NOT_ADVANCE',
    stage: 'provider_request',
    message: 'LayerSwap pagination did not advance',
  },
  SOCKET_QUOTE_REQUEST_REJECTED: {
    error_code: 'BRIDGE_SOCKET_QUOTE_REQUEST_REJECTED',
    stage: 'provider_request',
    message: 'Socket quote request rejected',
  },
  BACKEND_BUILD_REQUEST_FAILED: {
    error_code: 'BRIDGE_BACKEND_BUILD_REQUEST_FAILED',
    stage: 'provider_request',
    message: 'backend build request failed',
  },
  BACKEND_QUOTE_REQUEST_FAILED: {
    error_code: 'BRIDGE_BACKEND_QUOTE_REQUEST_FAILED',
    stage: 'provider_request',
    message: 'backend quote request failed',
  },
  REQUEST_TIMED_OUT: {
    error_code: 'BRIDGE_REQUEST_TIMED_OUT',
    stage: 'provider_request',
    message: 'request timed out',
  },
  SERVICE_REQUEST_FAILED: {
    error_code: 'BRIDGE_SERVICE_REQUEST_FAILED',
    stage: 'provider_request',
    message: 'service request failed',
  },
  UNSUPPORTED_SERVICE_PATH: {
    error_code: 'BRIDGE_UNSUPPORTED_SERVICE_PATH',
    stage: 'provider_request',
    message: 'unsupported service path',
  },
  // provider_response — 服务商响应格式与订单内容
  LAYERSWAP_AMOUNT_EXCEEDS_TOKEN_PRECISION: {
    error_code: 'BRIDGE_LAYERSWAP_AMOUNT_EXCEEDS_TOKEN_PRECISION',
    stage: 'provider_response',
    message: 'LayerSwap amount exceeds token precision',
  },
  LAYERSWAP_BRIDGE_ID_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_BRIDGE_ID_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap bridge id mismatch',
  },
  LAYERSWAP_BRIDGE_INPUT_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_BRIDGE_INPUT_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap bridge input mismatch',
  },
  LAYERSWAP_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_CHAIN_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap chain mismatch',
  },
  LAYERSWAP_QUOTE_TOKEN_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_QUOTE_TOKEN_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap quote token mismatch',
  },
  LAYERSWAP_QUOTED_AMOUNT_CHANGED: {
    error_code: 'BRIDGE_LAYERSWAP_QUOTED_AMOUNT_CHANGED',
    stage: 'provider_response',
    message: 'LayerSwap quoted amount changed',
  },
  LAYERSWAP_RECEIVER_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_RECEIVER_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap receiver mismatch',
  },
  LAYERSWAP_REFUND_RECIPIENT_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_REFUND_RECIPIENT_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap refund recipient mismatch',
  },
  LAYERSWAP_REQUEST_ID_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_REQUEST_ID_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap request id mismatch',
  },
  LAYERSWAP_SOURCE_VALUE_MISMATCH: {
    error_code: 'BRIDGE_LAYERSWAP_SOURCE_VALUE_MISMATCH',
    stage: 'provider_response',
    message: 'LayerSwap source value mismatch',
  },
  RELAY_APPROVAL_MISMATCH: {
    error_code: 'BRIDGE_RELAY_APPROVAL_MISMATCH',
    stage: 'provider_response',
    message: 'Relay approval mismatch',
  },
  RELAY_CANONICAL_DEPOSITORY_MISMATCH: {
    error_code: 'BRIDGE_RELAY_CANONICAL_DEPOSITORY_MISMATCH',
    stage: 'provider_response',
    message: 'Relay canonical depository mismatch',
  },
  RELAY_DISPLAY_AMOUNT_MISMATCH: {
    error_code: 'BRIDGE_RELAY_DISPLAY_AMOUNT_MISMATCH',
    stage: 'provider_response',
    message: 'Relay display amount does not match order',
  },
  RELAY_ORDER_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_RELAY_ORDER_CHAIN_MISMATCH',
    stage: 'provider_response',
    message: 'Relay order chain mismatch',
  },
  RELAY_ORDER_HASH_MISMATCH: {
    error_code: 'BRIDGE_RELAY_ORDER_HASH_MISMATCH',
    stage: 'provider_response',
    message: 'Relay order hash does not match',
  },
  RELAY_PROTOCOL_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_RELAY_PROTOCOL_CHAIN_MISMATCH',
    stage: 'provider_response',
    message: 'Relay protocol chain mismatch',
  },
  RELAY_REFUND_RECIPIENT_MISMATCH: {
    error_code: 'BRIDGE_RELAY_REFUND_RECIPIENT_MISMATCH',
    stage: 'provider_response',
    message: 'Relay refund recipient mismatch',
  },
  RELAY_SOURCE_PAYMENT_MISMATCH: {
    error_code: 'BRIDGE_RELAY_SOURCE_PAYMENT_MISMATCH',
    stage: 'provider_response',
    message: 'Relay source payment mismatch',
  },
  RELAY_SOURCE_VALUE_MISMATCH: {
    error_code: 'BRIDGE_RELAY_SOURCE_VALUE_MISMATCH',
    stage: 'provider_response',
    message: 'Relay source value mismatch',
  },
  SOCKET_RFQ_ORDER_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_RFQ_ORDER_MISMATCH',
    stage: 'provider_response',
    message: 'Socket RFQ order mismatch',
  },
  SOCKET_APPROVAL_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_APPROVAL_MISMATCH',
    stage: 'provider_response',
    message: 'Socket approval mismatch',
  },
  SOCKET_BRIDGE_CHAIN_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_BRIDGE_CHAIN_MISMATCH',
    stage: 'provider_response',
    message: 'Socket bridge chain mismatch',
  },
  SOCKET_BRIDGE_OUTPUT_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_BRIDGE_OUTPUT_MISMATCH',
    stage: 'provider_response',
    message: 'Socket bridge output mismatch',
  },
  SOCKET_PUBLIC_APP_FEE_UNSUPPORTED: {
    error_code: 'BRIDGE_SOCKET_PUBLIC_APP_FEE_UNSUPPORTED',
    stage: 'provider_response',
    message:
      'Socket public API does not support app fees; dedicated client access is required',
  },
  SOCKET_QUOTE_INPUT_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_QUOTE_INPUT_MISMATCH',
    stage: 'provider_response',
    message: 'Socket quote input mismatch',
  },
  SOCKET_SOURCE_QUOTE_MISMATCH: {
    error_code: 'BRIDGE_SOCKET_SOURCE_QUOTE_MISMATCH',
    stage: 'provider_response',
    message: 'Socket source quote mismatch',
  },
  AMBIGUOUS_LAYERSWAP_REQUEST_ID: {
    error_code: 'BRIDGE_AMBIGUOUS_LAYERSWAP_REQUEST_ID',
    stage: 'provider_response',
    message: 'ambiguous LayerSwap request id',
  },
  AMBIGUOUS_RELAY_CHAIN: {
    error_code: 'BRIDGE_AMBIGUOUS_RELAY_CHAIN',
    stage: 'provider_response',
    message: 'ambiguous Relay chain',
  },
  INVALID_LAYERSWAP_AMOUNT: {
    error_code: 'BRIDGE_INVALID_LAYERSWAP_AMOUNT',
    stage: 'provider_response',
    message: 'invalid LayerSwap amount',
  },
  INVALID_LAYERSWAP_OUTPUT_AMOUNT: {
    error_code: 'BRIDGE_INVALID_LAYERSWAP_OUTPUT_AMOUNT',
    stage: 'provider_response',
    message: 'invalid LayerSwap output amount',
  },
  INVALID_LAYERSWAP_SWAP_ID: {
    error_code: 'BRIDGE_INVALID_LAYERSWAP_SWAP_ID',
    stage: 'provider_response',
    message: 'invalid LayerSwap swap id',
  },
  INVALID_ADDRESS: {
    error_code: 'BRIDGE_INVALID_ADDRESS',
    stage: 'provider_response',
    message: 'invalid address',
  },
  INVALID_AMOUNT: {
    error_code: 'BRIDGE_INVALID_AMOUNT',
    stage: 'provider_response',
    message: 'invalid amount',
  },
  INVALID_AMOUNT_EXPONENT: {
    error_code: 'BRIDGE_INVALID_AMOUNT_EXPONENT',
    stage: 'provider_response',
    message: 'invalid amount exponent',
  },
  INVALID_ARRAY: {
    error_code: 'BRIDGE_INVALID_ARRAY',
    stage: 'provider_response',
    message: 'invalid array',
  },
  INVALID_BYTES: {
    error_code: 'BRIDGE_INVALID_BYTES',
    stage: 'provider_response',
    message: 'invalid bytes',
  },
  INVALID_FEE_DISPLAY: {
    error_code: 'BRIDGE_INVALID_FEE_DISPLAY',
    stage: 'provider_response',
    message: 'invalid fee display',
  },
  INVALID_MINIMUM_PRECISION: {
    error_code: 'BRIDGE_INVALID_MINIMUM_PRECISION',
    stage: 'provider_response',
    message: 'invalid minimum precision',
  },
  INVALID_OBJECT: {
    error_code: 'BRIDGE_INVALID_OBJECT',
    stage: 'provider_response',
    message: 'invalid object',
  },
  INVALID_RESPONSE: {
    error_code: 'BRIDGE_INVALID_RESPONSE',
    stage: 'provider_response',
    message: 'invalid response',
  },
  INVALID_SLIPPAGE: {
    error_code: 'BRIDGE_INVALID_SLIPPAGE',
    stage: 'provider_response',
    message: 'invalid slippage',
  },
  INVALID_STRING: {
    error_code: 'BRIDGE_INVALID_STRING',
    stage: 'provider_response',
    message: 'invalid string',
  },
  MISSING_LAYERSWAP_AMOUNT: {
    error_code: 'BRIDGE_MISSING_LAYERSWAP_AMOUNT',
    stage: 'provider_response',
    message: 'missing LayerSwap amount',
  },
  PROVIDER_RESPONSE_IS_NOT_VALID_JSON: {
    error_code: 'BRIDGE_PROVIDER_RESPONSE_IS_NOT_VALID_JSON',
    stage: 'provider_response',
    message: 'provider response is not valid JSON',
  },
  INVALID_SLIPPAGE_PRECISION: {
    error_code: 'BRIDGE_INVALID_SLIPPAGE_PRECISION',
    stage: 'provider_response',
    message: 'slippage must be a fraction with at most four decimals',
  },
  UNSAFE_LAYERSWAP_AMOUNT: {
    error_code: 'BRIDGE_UNSAFE_LAYERSWAP_AMOUNT',
    stage: 'provider_response',
    message: 'unsafe LayerSwap amount',
  },
  UNSAFE_NUMBER: {
    error_code: 'BRIDGE_UNSAFE_NUMBER',
    stage: 'provider_response',
    message: 'unsafe number',
  },
  UNSUPPORTED_LAYERSWAP_NON_EVM_RECEIVER: {
    error_code: 'BRIDGE_UNSUPPORTED_LAYERSWAP_NON_EVM_RECEIVER',
    stage: 'provider_response',
    message: 'unsupported LayerSwap non-EVM receiver',
  },
  UNSUPPORTED_LAYERSWAP_TRANSACTION: {
    error_code: 'BRIDGE_UNSUPPORTED_LAYERSWAP_TRANSACTION',
    stage: 'provider_response',
    message: 'unsupported LayerSwap transaction',
  },
  UNSUPPORTED_RELAY_VM: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_VM',
    stage: 'provider_response',
    message: 'unsupported Relay VM',
  },
  UNSUPPORTED_RELAY_APPROVAL: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_APPROVAL',
    stage: 'provider_response',
    message: 'unsupported Relay approval',
  },
  UNSUPPORTED_RELAY_APPROVAL_COUNT: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_APPROVAL_COUNT',
    stage: 'provider_response',
    message: 'unsupported Relay approval count',
  },
  UNSUPPORTED_RELAY_DEPOSIT: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_DEPOSIT',
    stage: 'provider_response',
    message: 'unsupported Relay deposit',
  },
  UNSUPPORTED_RELAY_DEPOSIT_COUNT: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_DEPOSIT_COUNT',
    stage: 'provider_response',
    message: 'unsupported Relay deposit count',
  },
  UNSUPPORTED_RELAY_DEPOSIT_METHOD: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_DEPOSIT_METHOD',
    stage: 'provider_response',
    message: 'unsupported Relay deposit method',
  },
  UNSUPPORTED_RELAY_ORDER_SHAPE: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_ORDER_SHAPE',
    stage: 'provider_response',
    message: 'unsupported Relay order shape',
  },
  UNSUPPORTED_RELAY_ORDER_VERSION: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_ORDER_VERSION',
    stage: 'provider_response',
    message: 'unsupported Relay order version',
  },
  UNSUPPORTED_RELAY_STEP: {
    error_code: 'BRIDGE_UNSUPPORTED_RELAY_STEP',
    stage: 'provider_response',
    message: 'unsupported Relay step',
  },
  UNSUPPORTED_SOCKET_CCTP_RECEIVER: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_CCTP_RECEIVER',
    stage: 'provider_response',
    message: 'unsupported Socket CCTP receiver',
  },
  UNSUPPORTED_SOCKET_SERVICE_ROUTE: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_SERVICE_ROUTE',
    stage: 'provider_response',
    message: 'unsupported Socket service route',
  },
  UNSUPPORTED_SOCKET_TRANSACTION: {
    error_code: 'BRIDGE_UNSUPPORTED_SOCKET_TRANSACTION',
    stage: 'provider_response',
    message: 'unsupported Socket transaction',
  },
  // provider_binding — 订单、报价缓存与待签交易绑定
  LAYERSWAP_TRANSACTION_IS_REQUIRED: {
    error_code: 'BRIDGE_LAYERSWAP_TRANSACTION_IS_REQUIRED',
    stage: 'provider_binding',
    message: 'LayerSwap transaction is required',
  },
  A_DIRECT_PROVIDER_QUOTE_IS_REQUIRED: {
    error_code: 'BRIDGE_A_DIRECT_PROVIDER_QUOTE_IS_REQUIRED',
    stage: 'provider_binding',
    message: 'a direct provider quote is required',
  },
  PROVIDER_DESTINATION_UNBOUND: {
    error_code: 'BRIDGE_PROVIDER_DESTINATION_UNBOUND',
    stage: 'provider_binding',
    message:
      'destination conditions are not bound to a verified provider transaction',
  },
  INVALID_TRANSACTION: {
    error_code: 'BRIDGE_INVALID_TRANSACTION',
    stage: 'provider_binding',
    message: 'invalid transaction',
  },
  PROVIDER_CLIENT_CONTEXT_CHANGED: {
    error_code: 'BRIDGE_PROVIDER_CLIENT_CONTEXT_CHANGED',
    stage: 'provider_binding',
    message: 'provider client context changed',
  },
  QUOTE_DOES_NOT_MATCH_LOCAL_INTENT: {
    error_code: 'BRIDGE_QUOTE_DOES_NOT_MATCH_LOCAL_INTENT',
    stage: 'provider_binding',
    message: 'quote does not match local intent',
  },
  QUOTE_REQUEST_WAS_INVALIDATED: {
    error_code: 'BRIDGE_QUOTE_REQUEST_WAS_INVALIDATED',
    stage: 'provider_binding',
    message: 'quote request was invalidated',
  },
  QUOTED_AMOUNT_CHANGED: {
    error_code: 'BRIDGE_QUOTED_AMOUNT_CHANGED',
    stage: 'provider_binding',
    message: 'quoted amount changed',
  },
  SOURCE_TRANSACTION_CHANGED: {
    error_code: 'BRIDGE_SOURCE_TRANSACTION_CHANGED',
    stage: 'provider_binding',
    message: 'source transaction changed',
  },
  // completeness — 必须验证的字段缺失
  UNVERIFIED_BRIDGE_FIELDS: {
    error_code: 'BRIDGE_UNVERIFIED_BRIDGE_FIELDS',
    stage: 'completeness',
    message: 'unverified bridge fields',
  },
  // unknown — 未分类异常兜底，不包含外部异常原文
  UNKNOWN: {
    error_code: 'BRIDGE_UNKNOWN',
    stage: 'unknown',
    message: 'unknown bridge error',
  },
} as const;

export type BridgeErrorDefinition = typeof BRIDGE_ERRORS[keyof typeof BRIDGE_ERRORS];
export type BridgeErrorCode = BridgeErrorDefinition['error_code'];
export type BridgeErrorStage = BridgeErrorDefinition['stage'];
