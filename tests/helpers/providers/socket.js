import { sourceAmountMatches } from '../../../dist/calldata/expect.js';
import { BRIDGE_ERRORS, BridgeError } from '../../../dist/errors/index.js';
import { decodeBridgeCalldataResult } from '../../../dist/calldata/index.js';
import { SOCKET_CCTP_MINT_RECIPIENT } from '../../../dist/calldata/socket/addresses.js';
import { address, bytes, chain, object, text, tokenAddress, transaction, uint } from './data.js';

export const SOCKET_PROVIDER_ROUTES = Object.freeze(['rfq-vault-executor', 'cctp-v2', 'cctp-v2-slow']);

export const socketBridgeId = (value) => text(value).trim().toLowerCase().replace(/ /g, '-').replace(/^circle-cctp/, 'cctp');

export const readSocketQuote = (raw, rawRoute, params) => {
  const result = object(raw), route = object(rawRoute);
  const details = object(object(route.routeDetails).bridgeDetails);
  const bridgeId = socketBridgeId(object(details.protocol).name);
  if (!SOCKET_PROVIDER_ROUTES.includes(bridgeId) || route.userOp !== 'tx') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_SERVICE_ROUTE);
  const input = object(result.input), inputToken = object(input.token);
  const output = object(route.output), outputToken = object(output.token);
  if (uint(result.originChainId) !== chain(params.fromChainId) || uint(result.destinationChainId) !== chain(params.toChainId) ||
      uint(inputToken.chainId) !== chain(params.fromChainId) || uint(outputToken.chainId) !== chain(params.toChainId) ||
      address(result.userAddress) !== address(params.userAddress) || address(result.receiverAddress) !== address(params.userAddress) ||
      tokenAddress(text(inputToken.address), params.fromChainId) !== tokenAddress(params.fromTokenId, params.fromChainId) ||
      !sourceAmountMatches(uint(input.amount), uint(params.fromTokenRawAmount))) throw new BridgeError(BRIDGE_ERRORS.SOCKET_QUOTE_INPUT_MISMATCH);
  const txData = object(route.txData);
  if (txData.kind !== 'evm_tx') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_TRANSACTION);
  const tx = transaction(txData.object, params);
  const decodedResult = decodeBridgeCalldataResult('socket', tx);
  if (!decodedResult.ok) throw new BridgeError(BRIDGE_ERRORS.INVALID_CALLDATA, {}, decodedResult.errors);
  const parsed = decodedResult.parsed;
  const quoteId = bytes(route.quoteId, 32);
  if (!parsed || parsed.quoteId !== quoteId || parsed.depositor !== address(params.userAddress) ||
      parsed.sourceAmount !== uint(input.amount)) throw new BridgeError(BRIDGE_ERRORS.SOCKET_SOURCE_QUOTE_MISMATCH);
  if (bridgeId === 'rfq-vault-executor') {
    if (parsed.protocolMethod !== 'receiveERC20' || parsed.orderId !== quoteId) throw new BridgeError(BRIDGE_ERRORS.SOCKET_RFQ_ORDER_MISMATCH);
  } else if (parsed.protocolMethod !== 'depositForBurn' || parsed.bridgeReceiver !== SOCKET_CCTP_MINT_RECIPIENT) {
    throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_CCTP_RECEIVER);
  }
  const destinationToken = tokenAddress(text(outputToken.address), params.toChainId);
  if (parsed.outputToken && tokenAddress(parsed.outputToken, params.toChainId) !== destinationToken) throw new BridgeError(BRIDGE_ERRORS.SOCKET_BRIDGE_OUTPUT_MISMATCH);
  if (parsed.destinationChainId !== undefined && parsed.destinationChainId !== chain(params.toChainId)) throw new BridgeError(BRIDGE_ERRORS.SOCKET_BRIDGE_CHAIN_MISMATCH);
  const approval = route.approval ? object(route.approval) : undefined;
  const native = tokenAddress(params.fromTokenId, params.fromChainId) === '0x0000000000000000000000000000000000000000';
  if (!native && (!approval || address(approval.tokenAddress) !== tokenAddress(params.fromTokenId, params.fromChainId) ||
      address(approval.userAddress) !== address(params.userAddress) || uint(approval.amount) !== uint(input.amount))) throw new BridgeError(BRIDGE_ERRORS.SOCKET_APPROVAL_MISMATCH);
  return {
    tx, orderId: quoteId, requestId: quoteId,
    approveAddress: native ? '' : address(approval.spenderAddress),
    expectedAmount: uint(output.amount),
    parsed: { ...parsed, destinationChainId: chain(params.toChainId), outputToken: destinationToken,
      minOutputAmount: uint(output.minAmountOut), receiver: address(result.receiverAddress), unresolvedFields: [] },
  };
};
