import { asBigint, asString, decodeCall, decodeParameters } from '../../abi.js';
import { NATIVE_TOKEN, isNative } from '../../protocols.js';
import type { ParsedBridgeCall } from '../../types.js';
import { readSelector } from '../../hex.js';

export const readNativeBridge = (data: string, target: string, value: bigint): Partial<ParsedBridgeCall> | undefined => {
  const selector = readSelector(data);
  if (selector === '0x679b6ded') {
    const a = decodeCall([
      { name: 'to', kind: 'address' }, { name: 'l2CallValue', kind: 'uint' }, { name: 'maxSubmissionCost', kind: 'uint' },
      { name: 'excessFeeRefundAddress', kind: 'address' }, { name: 'callValueRefundAddress', kind: 'address' },
      { name: 'gasLimit', kind: 'uint' }, { name: 'maxFeePerGas', kind: 'uint' }, { name: 'data', kind: 'bytes' },
    ], data);
    const destinationChainId = target === '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f' ? 42161n
      : target === '0x1a07cc4bd17e0118bdb54d70990d2158abad7a2d' ? 4663n : undefined;
    const callData = asString(a.data);
    return { protocolMethod: 'createRetryableTicket', destinationChainId,
      refundRecipients: [asString(a.callValueRefundAddress), asString(a.excessFeeRefundAddress)],
      receiver: callData === '0x' ? asString(a.to) : undefined, bridgeReceiver: asString(a.to),
      outputToken: callData === '0x' ? NATIVE_TOKEN : undefined,
      minOutputAmount: callData === '0x' ? asBigint(a.l2CallValue) : undefined,
      destinationCallData: callData === '0x' ? undefined : callData };
  }
  if (selector === '0xd2ce7d65') {
    const a = decodeCall([
      { name: 'token', kind: 'address' }, { name: 'to', kind: 'address' }, { name: 'amount', kind: 'uint' },
      { name: 'maxGas', kind: 'uint' }, { name: 'gasPriceBid', kind: 'uint' }, { name: 'data', kind: 'bytes' },
    ], data);
    const ref = { protocol: 'arbitrum' as const, contract: target, token: asString(a.token), destinationChainId: target === '0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef' ? 42161n : undefined };
    return { protocolMethod: 'outboundTransfer', receiver: asString(a.to),
      destinationChainId: ref.destinationChainId, outputTokenReference: ref, minOutputAmount: asBigint(a.amount) };
  }
  if (selector === '0x838b2520' || selector === '0x9a2ac6d5') {
    const erc20 = selector === '0x838b2520';
    const a = decodeCall([
      ...(erc20 ? [{ name: 'localToken', kind: 'address' as const }, { name: 'remoteToken', kind: 'address' as const }] : []),
      { name: 'to', kind: 'address' }, ...(erc20 ? [{ name: 'amount', kind: 'uint' as const }] : []),
      { name: 'minGasLimit', kind: 'uint' }, { name: 'extraData', kind: 'bytes' },
    ], data);
    return { protocolMethod: erc20 ? 'depositERC20To' : 'depositETHTo',
      destinationChainId: target === '0x3154cf16ccdb4c6d922629664174b904d80f2c35' ? 8453n : undefined,
      receiver: asString(a.to), outputToken: erc20 ? asString(a.remoteToken) : NATIVE_TOKEN,
      minOutputAmount: erc20 ? asBigint(a.amount) : value };
  }
  if (selector === '0x4faa8a26') {
    const a = decodeCall([{ name: 'user', kind: 'address' }], data);
    return { protocolMethod: 'depositEtherFor', destinationChainId: 137n, receiver: asString(a.user),
      outputToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', minOutputAmount: value };
  }
  if (selector === '0xe3dec8fb') {
    const a = decodeCall([{ name: 'user', kind: 'address' }, { name: 'rootToken', kind: 'address' }, { name: 'depositData', kind: 'bytes' }], data);
    const amount = asBigint(decodeParameters([{ name: 'amount', kind: 'uint' }], asString(a.depositData)).amount);
    return { protocolMethod: 'depositFor', destinationChainId: 137n, receiver: asString(a.user), minOutputAmount: amount,
      outputTokenReference: { protocol: 'polygon', contract: target, token: asString(a.rootToken), destinationChainId: 137n } };
  }
  if (selector === '0x8b9e4f93' || selector === '0xad58bdd1') {
    const polygon = selector === '0x8b9e4f93';
    const a = decodeCall([{ name: 'token', kind: 'address' }, { name: 'receiver', kind: 'address' }, { name: 'amount', kind: 'uint' }], data);
    const token = asString(a.token);
    const destinationChainId = polygon ? 137n : 100n;
    let outputToken: string | undefined;
    if (polygon && ['0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', '0x455e53cbb86018ac2b8092fdcd39d8444affc3f6'].includes(token)) outputToken = NATIVE_TOKEN;
    if (!polygon && ['0x6b175474e89094c44da98b954eedeac495271d0f', '0xdc035d45d973e3ec169d2276ddab16f1e407384f'].includes(token)) outputToken = NATIVE_TOKEN;
    if (!polygon && isNative(token)) outputToken = '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1';
    return { protocolMethod: polygon ? 'depositERC20ForUser' : 'relayTokens', destinationChainId,
      receiver: asString(a.receiver), minOutputAmount: asBigint(a.amount), outputToken,
      outputTokenReference: outputToken ? undefined : { protocol: polygon ? 'polygon' : 'gnosis', contract: target, token, destinationChainId } };
  }
  return undefined;
};
