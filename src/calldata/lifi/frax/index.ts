import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asBigint, asRecord, asString, type AbiParam } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { LAYERZERO_CHAINS } from '../../protocols.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';
import type { ParsedBridgeCall } from '../../types.js';

const fraxData: AbiParam = { name: 'fraxData', kind: 'tuple', components: [
  { name: 'oft', kind: 'address' }, { name: 'dstEid', kind: 'uint' },
  { name: 'nativeFee', kind: 'uint' }, { name: 'refundRecipient', kind: 'address' },
  { name: 'nonEVMReceiver', kind: 'bytes', size: 32 },
] };

const fill: Parameters<typeof lifiBridgeMethod>[4] = (parsed: ParsedBridgeCall, args) => {
  const data = asRecord(args.fraxData);
  const eid = asBigint(data.dstEid);
  parsed.destinationChainRef = `layerzero:${eid}`;
  parsed.destinationChainId = LAYERZERO_CHAINS[eid.toString()];
  if (!/^0x0*$/.test(asString(data.nonEVMReceiver))) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_NON_EVM_FRAX_RECEIVER);
  const token = { protocol: 'frax' as const, contract: asString(data.oft), token: parsed.bridgeToken,
    destinationChainId: parsed.destinationChainId, destinationChainRef: parsed.destinationChainRef };
  parsed.outputTokenReference = token;
  parsed.outputAmountReference = { kind: 'dust', amount: parsed.bridgeAmount as bigint, token };
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaFrax', '0x678786ea', [fraxData], false, fill),
  lifiBridgeMethod('swapAndStartBridgeTokensViaFrax', '0x07b8e4c7', [fraxData], true, fill),
];
export const compare = knownCompare;
export const check = bridgeShape;
