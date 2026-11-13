import { BRIDGE_ERRORS, bridgeFailure } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import type { CalldataMethod } from '../abi.js';
import type { BridgeCallExpectation, CompareMask } from '../expect.js';
import { finishCheck } from '../expect.js';
import { matchMethod } from '../match.js';
import type { BridgeCheck, DecodeHit, ParsedBridgeCall } from '../types.js';
import * as across from './across/index.js';
import * as allbridge from './allbridge/index.js';
import * as celer from './celer/index.js';
import * as centrifuge from './centrifuge/index.js';
import * as frax from './frax/index.js';
import * as gaszip from './gaszip/index.js';
import * as garden from './garden/index.js';
import * as intents from './intents/index.js';
import * as layerswap from './layerswap/index.js';
import * as mayan from './mayan/index.js';
import * as m0 from './m0/index.js';
import * as native from './native/index.js';
import * as paxos from './paxos/index.js';
import * as polymer from './polymer/index.js';
import * as relay from './relay/index.js';
import * as squid from './squid/index.js';
import * as stargate from './stargate/index.js';
import * as swap from './swap/index.js';
import { isNative } from '../protocols.js';

type LifiRoute = {
  methods: CalldataMethod[];
  compare: (parsed: ParsedBridgeCall) => CompareMask;
  check: (parsed: ParsedBridgeCall) => BridgeErrorDefinition | undefined;
};

const ROUTES: LifiRoute[] = [
  across,
  allbridge,
  centrifuge,
  garden,
  m0,
  native,
  frax,
  stargate,
  intents,
  polymer,
  layerswap,
  mayan,
  celer,
  paxos,
  relay,
  gaszip,
  squid,
  swap,
];

const METHODS = ROUTES.flatMap((route) => route.methods);

const routeFor = (method: string) =>
  ROUTES.find((route) => route.methods.some((item) => item.name === method));

export const decodeLifi = (data: string, value: bigint): DecodeHit =>
  matchMethod(METHODS, data, value);

export const validateLifi = (
  data: string,
  value: bigint,
  expectation?: BridgeCallExpectation,
  chainId = ''
): BridgeCheck => {
  const hit = decodeLifi(data, value);
  if (!hit.ok) {
    return { ...hit, aggregatorId: 'lifi' };
  }
  const route = routeFor(hit.parsed.method);
  if (!route) {
    return {
      ...bridgeFailure([BRIDGE_ERRORS.UNSUPPORTED_METHOD]),
      aggregatorId: 'lifi',
      method: hit.parsed.method,
      parsed: hit.parsed,
    };
  }
  return finishCheck(
    'lifi',
    hit.parsed,
    hit.parsed.method.endsWith('ViaLayerSwap') && value !== (isNative(hit.parsed.sourceToken ?? '') ? hit.parsed.sourceAmount : 0n)
      ? BRIDGE_ERRORS.LAYERSWAP_SOURCE_VALUE_MISMATCH : route.check(hit.parsed),
    expectation,
    chainId,
    route.compare(hit.parsed)
  );
};
