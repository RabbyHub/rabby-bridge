import { CCTP_CHAINS, WORMHOLE_CHAINS } from '../protocols.js';
import type { ParsedBridgeCall } from '../types.js';

export const mayanDestination = (
  system: 'cctp' | 'wormhole', id: bigint, token?: string, normalizedAmount?: bigint
): Partial<ParsedBridgeCall> => {
  const destinationChainId = (system === 'cctp' ? CCTP_CHAINS : WORMHOLE_CHAINS)[id.toString()];
  const destinationChainRef = `${system}:${id}`;
  return {
    destinationChainId, destinationChainRef,
    outputToken: token,
    outputAmountReference: token !== undefined && normalizedAmount !== undefined ? {
      kind: 'normalized', amount: normalizedAmount, decimals: 8,
      token: { protocol: 'token', token, destinationChainId, destinationChainRef },
    } : undefined,
  };
};
