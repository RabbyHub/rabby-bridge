import { asBigint, asString, decodeCall } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { CCTP_CHAINS, CCTP_USDC, subtractFees } from '../../protocols.js';
import type { ParsedBridgeCall } from '../../types.js';
import { SOCKET_CCTP_MINT_RECIPIENT } from '../addresses.js';

export const readCctp = (data: string): Partial<ParsedBridgeCall> => {
  const a = decodeCall([
    { name: 'amount', kind: 'uint' }, { name: 'destinationDomain', kind: 'uint' },
    { name: 'mintRecipient', kind: 'bytes', size: 32 }, { name: 'burnToken', kind: 'address' },
    { name: 'destinationCaller', kind: 'bytes', size: 32 }, { name: 'maxFee', kind: 'uint' },
    { name: 'minFinalityThreshold', kind: 'uint' },
  ], data);
  const id = asBigint(a.destinationDomain);
  const destinationChainId = CCTP_CHAINS[id.toString()];
  const receiver = accountFromBytes32(asString(a.mintRecipient));
  const allowlisted = receiver === SOCKET_CCTP_MINT_RECIPIENT;
  return { protocolMethod: 'depositForBurn', destinationChainId, destinationChainRef: `cctp:${id}`,
    bridgeReceiver: receiver, receiver: allowlisted ? undefined : receiver, fixedReceiver: allowlisted,
    bridgeToken: asString(a.burnToken), bridgeAmount: asBigint(a.amount),
    bridgeOutputToken: CCTP_USDC[destinationChainId?.toString() ?? ''],
    bridgeOutputAmount: subtractFees(asBigint(a.amount), asBigint(a.maxFee)),
    outputToken: CCTP_USDC[destinationChainId?.toString() ?? ''],
    minOutputAmount: allowlisted ? undefined : subtractFees(asBigint(a.amount), asBigint(a.maxFee)),
    // ClaimExecutor's recipient and relay fee are signed on the destination, outside this calldata.
  };
};
