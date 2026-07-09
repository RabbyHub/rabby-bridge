import { SUPPORTED_AGGREGATORS } from './data.js';

export const BRIDGE_AGGREGATORS = SUPPORTED_AGGREGATORS;

export const BRIDGE_ENUM = {
  LIFI: 'lifi',
  BUNGEE: 'bungee',
  SOCKET: 'socket',
  RELAY: 'relay',
  STARGATE: 'stargate',
  NEAR_INTENTS: 'near_intents',
  MAYAN: 'mayan',
  ACROSS: 'across',
} as const;

export type BridgeAggregatorId = (typeof BRIDGE_AGGREGATORS)[number];
