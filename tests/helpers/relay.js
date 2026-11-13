import { _TypedDataEncoder } from '@ethersproject/hash';
import { readFixture } from './fixtures.js';

const orderTypes = readFixture('providers/relay/order-types.json');
export const hashRelayOrder = (order) => _TypedDataEncoder.hashStruct('Order', orderTypes, order);
