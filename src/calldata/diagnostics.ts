import type { BridgeErrorContext } from '../errors/index.js';

/** Inspect call structure only. Never retain arguments or scan arbitrary payloads for selectors. */
export const calldataDiagnostics = (data: unknown): BridgeErrorContext => {
  if (typeof data !== 'string') return { calldataFormat: 'missing' };
  const valid = /^0x(?:[0-9a-f]{2})*$/i.test(data);
  const selector = /^0x[0-9a-f]{8}/i.test(data) ? data.slice(0, 10).toLowerCase() : undefined;
  return {
    selector,
    calldataFormat: valid ? (data.length === 2 ? 'empty' : 'valid') : 'invalid',
    ...(valid ? { calldataBytes: (data.length - 2) / 2 } : {}),
  };
};

export const innerCallDiagnostics = (data: string, layer: 'router' | 'protocol'): BridgeErrorContext => {
  const { selector, calldataBytes } = calldataDiagnostics(data);
  return layer === 'router'
    ? { routerSelector: selector, routerCalldataBytes: calldataBytes }
    : { protocolSelector: selector, protocolCalldataBytes: calldataBytes };
};
