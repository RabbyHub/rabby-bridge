import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import { swapShape } from '../shape.js';
import { lifiSwapMethod } from './swapMethod.js';

export const methods: CalldataMethod[] = [
  lifiSwapMethod('swapTokensSingleV3ERC20ToERC20', '0x4666fc80', false),
  lifiSwapMethod('swapTokensSingleV3ERC20ToNative', '0x733214a3', false),
  lifiSwapMethod('swapTokensSingleV3NativeToERC20', '0xaf7060fd', false),
  lifiSwapMethod('swapTokensMultipleV3ERC20ToERC20', '0x5fd9ae2e', true),
  lifiSwapMethod('swapTokensMultipleV3ERC20ToNative', '0x2c57e884', true),
  lifiSwapMethod('swapTokensMultipleV3NativeToERC20', '0x736eac0b', true),
];

export const compare = (): CompareMask => ({
  fromToken: true,
  fromAmount: true,
  toToken: true,
  toAmount: true,
  receiver: true,
});

export const check = swapShape;
