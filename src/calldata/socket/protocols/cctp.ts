import { asBigint, asString, decodeCall } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { CCTP_CHAINS, CCTP_USDC, subtractFees } from '../../protocols.js';
import type { ParsedBridgeCall } from '../../types.js';

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
  const intermediary = receiver === '0x424a31a57f7c63918ecaa2fac38016a8af5a6ec2';
  return { protocolMethod: 'depositForBurn', destinationChainId, destinationChainRef: `cctp:${id}`,
    bridgeReceiver: receiver, receiver: intermediary ? undefined : receiver,
    bridgeToken: asString(a.burnToken), bridgeAmount: asBigint(a.amount),
    bridgeOutputToken: CCTP_USDC[destinationChainId?.toString() ?? ''],
    bridgeOutputAmount: subtractFees(asBigint(a.amount), asBigint(a.maxFee)),
    outputToken: CCTP_USDC[destinationChainId?.toString() ?? ''],
    minOutputAmount: intermediary ? undefined : subtractFees(asBigint(a.amount), asBigint(a.maxFee)),
    // ClaimExecutor's recipient and relay fee are signed on the destination, outside this calldata.
  };
};
