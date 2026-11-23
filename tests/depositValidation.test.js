import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS,
  BridgeError,
  InvalidBridgeCalldataError,
  InvalidBridgeContractError,
  getBridgeRouter,
  validateDepositBridgeQuote,
} from '../dist/index.js';
import { ACROSS_HYPERCORE_HANDLER } from '../dist/calldata/destination.js';
import { bytes, word } from './helpers/calldata.js';
import { readFixture } from './helpers/fixtures.js';
import { hashRelayOrder } from './helpers/relay.js';

const user = '0x1111111111111111111111111111111111111111';
const collector = '0x2222222222222222222222222222222222222222';
const attacker = '0x9999999999999999999999999999999999999999';
const zero = '0x0000000000000000000000000000000000000000';
const arbUsdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const baseUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const hyperEvmUsdc = '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb';
const hyperCoreUsdc = '0x00000000000000000000000000000000';

const relayHyperCoreFixtures = readFixture('providers/relay/hypercore.json');

const hyperCoreMessage = (recipient) =>
  `0x00${'0'.repeat(24)}${recipient.slice(2).toLowerCase()}${'0'.repeat(64)}`;

const buildAcrossDepositV3Tx = ({
  from = user,
  depositor = user,
  recipient = ACROSS_HYPERCORE_HANDLER,
  inputToken = arbUsdc,
  outputToken = hyperEvmUsdc,
  inputAmount = 10000000,
  outputAmount = 9950000,
  destChainId = 999,
  message = hyperCoreMessage(user),
  to = getBridgeRouter('across', 'arb'),
  value = '0x0',
  chainId = 42161,
} = {}) => ({
  from,
  to,
  value,
  chainId,
  data: '0x7b939232' + [
    depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, destChainId,
    zero, 1794499200, 1794501000, 0, 384,
  ].map(word).join('') + bytes(message),
});

const buildAcrossSwapAndBridgeTx = ({
  recipient = ACROSS_HYPERCORE_HANDLER,
  destChainId = 999,
  message = hyperCoreMessage(user),
} = {}) => {
  const spokePool = getBridgeRouter('across', 'arb');
  const depositTuple = [
    arbUsdc, hyperEvmUsdc, 9950000, user, recipient, destChainId,
    zero, 1794499200, 1794501000, 0, 352,
  ].map(word).join('') + bytes(message);
  const swapData = bytes('0x12345678');
  const submissionFees = word(0) + word(zero);
  const depositOffset = (2 + 1 + 9) * 32;
  const routerCalldataOffset = depositOffset + depositTuple.length / 2;
  const tuple = submissionFees +
    word(depositOffset) +
    word(arbUsdc) +
    word(attacker) +
    word(0) +
    word(10000000) +
    word(9980000) +
    word(routerCalldataOffset) +
    word(0) +
    word(spokePool) +
    word(1) +
    depositTuple +
    swapData;
  return {
    from: user,
    to: '0x10d8b8daa26d307489803e10477de69c0492b610',
    value: '0x0',
    chainId: 42161,
    data: '0x110560ad' + word(32) + tuple,
  };
};

const encodeRelayMulticallCalls = (calls) => {
  const encoded = calls.map((item) =>
    word(item.target) + word(item.allowFailure ?? false) + word(item.value ?? 0) + word(128) + bytes(item.data));
  let offset = calls.length * 32;
  const offsets = encoded.map((item) => {
    const current = offset;
    offset += item.length / 2;
    return word(current);
  });
  return word(calls.length) + offsets.join('') + encoded.join('');
};

const buildRelayTransferAndMulticallTx = (innerDepositData, amount = '10000000') => {
  const approvalProxy = '0x5567954cd026cebfe486062cb75848e0f1c12e58';
  const depository = getBridgeRouter('relay', 'arb');
  const approveData = '0x095ea7b3' + word(depository) + word(amount);
  const callArray = encodeRelayMulticallCalls([
    { target: arbUsdc, data: approveData },
    { target: depository, data: innerDepositData },
  ]);
  const tokens = word(1) + word(arbUsdc);
  const amounts = word(1) + word(amount);
  const metadata = `0x${'cd'.repeat(32)}`;
  return {
    from: user,
    to: approvalProxy,
    value: '0x0',
    chainId: 42161,
    data: '0xf9e4bab4' + word(192) + word(256) + word(320) +
      word(user) + word(0) + word(320 + callArray.length / 2) +
      tokens + amounts + callArray + bytes(metadata),
  };
};

describe('validateDepositBridgeQuote — positive cases (Perps & Gas Account)', () => {
  test('Perps via Relay ERC20 depositErc20 + live HyperCore orderData', () => {
    const sample = relayHyperCoreFixtures.perpsErc20;
    const onError = jest.fn();
    const quote = {
      bridge_id: 'relay',
      approve_contract_id: sample.tx.to,
      to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
      order_data: sample.order_data,
      tx: sample.tx,
    };
    const result = validateDepositBridgeQuote(quote, {
      userAddress: user,
      receiverAddress: user,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: 'hyperliquid',
      toTokenId: hyperCoreUsdc,
      onError,
    });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true, receiverPass: true, errors: [] });
    expect(onError).not.toHaveBeenCalled();
  });

  test('Perps via Relay transferAndMulticall (ApprovalProxy v3.2) + HyperCore orderData', () => {
    const sample = relayHyperCoreFixtures.perpsErc20;
    const tx = buildRelayTransferAndMulticallTx(sample.tx.data, sample.fromTokenRawAmount);
    const quote = {
      bridge_id: 'relay',
      approve_contract_id: tx.to,
      to_token_raw_amount: Number(sample.toTokenRawAmount),
      order_data: sample.order_data,
      tx,
    };
    const result = validateDepositBridgeQuote(quote, {
      userAddress: user,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: 'hypercore',
      toTokenId: hyperCoreUsdc,
    });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true, receiverPass: true, errors: [] });
  });

  test('Perps via Relay Native depositNative + HyperCore orderData', () => {
    const sample = relayHyperCoreFixtures.nativeToHypercoreCollector;
    const quote = {
      bridge_id: 'relay',
      approve_contract_id: '',
      to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
      tx: { ...sample.tx, order_data: sample.order_data },
    };
    const result = validateDepositBridgeQuote(quote, {
      userAddress: user,
      receiverAddress: collector,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: 'hyperliquid',
      toTokenId: hyperCoreUsdc,
    });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true, receiverPass: true, errors: [] });
  });

  test('Perps via Across depositV3 and swapAndBridge targeting HyperCore handler', () => {
    for (const tx of [buildAcrossDepositV3Tx(), buildAcrossSwapAndBridgeTx()]) {
      const quote = {
        bridge_id: 'across',
        approve_contract_id: tx.to,
        to_token_raw_amount_hex_str: '0x3b4e9380',
        tx,
      };
      const result = validateDepositBridgeQuote(quote, {
        userAddress: user,
        receiverAddress: user,
        fromChainId: 'arb',
        fromTokenId: arbUsdc,
        fromTokenRawAmount: '10000000',
        toChainId: 'hyperliquid',
        toTokenId: hyperCoreUsdc,
      });
      expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, receiverPass: true, errors: [] });
    }
  });

  test('Gas Account via Relay Native EVM order (collector receiver, user origin refund)', () => {
    const sample = relayHyperCoreFixtures.evmCollector;
    const quote = {
      bridge_id: 'relay',
      approve_contract_id: '',
      to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
      order_data: sample.order_data,
      tx: sample.tx,
    };
    const result = validateDepositBridgeQuote(quote, {
      userAddress: user,
      receiverAddress: collector,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: sample.toChainId,
      toTokenId: sample.toTokenId,
    });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true, receiverPass: true, errors: [] });
  });

  test('Gas Account via Across ERC20 depositV3 (collector receiver, user depositor)', () => {
    const tx = buildAcrossDepositV3Tx({
      depositor: user,
      recipient: collector,
      inputToken: arbUsdc,
      outputToken: baseUsdc,
      destChainId: 8453,
      message: '0x',
    });
    const quote = {
      bridge_id: 'across',
      approve_contract_id: tx.to,
      to_token_raw_amount_hex_str: `0x${(9950000).toString(16)}`,
      tx,
    };
    const result = validateDepositBridgeQuote(quote, {
      userAddress: user,
      receiverAddress: collector,
      fromChainId: 'arb',
      fromTokenId: arbUsdc,
      fromTokenRawAmount: '10000000',
      toChainId: 'base',
      toTokenId: baseUsdc,
    });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true, receiverPass: true, errors: [] });
  });

  test('supports gradual Relay rollout via allowMissingRelayOrder while still checking orderData when present', () => {
    const sample = relayHyperCoreFixtures.perpsErc20;
    const quoteWithoutOrder = {
      bridge_id: 'relay',
      approve_contract_id: sample.tx.to,
      to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
      tx: sample.tx,
    };
    const baseParams = {
      userAddress: user,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: 'hyperliquid',
      toTokenId: hyperCoreUsdc,
    };
    // Strict default rejects missing order_data
    expect(() => validateDepositBridgeQuote(quoteWithoutOrder, baseParams))
      .toThrow(InvalidBridgeCalldataError);

    // Rollout option allows missing order_data while still verifying router/spender/source
    const relaxed = validateDepositBridgeQuote(quoteWithoutOrder, {
      ...baseParams,
      allowMissingRelayOrder: true,
    });
    expect(relaxed).toMatchObject({ pass: true, routerPass: true, fromPass: true, errors: [] });

    // Even with allowMissingRelayOrder: true, a tampered order_data is still rejected
    const badOrder = { ...sample.order_data, salt: '1' };
    expect(() => validateDepositBridgeQuote({ ...quoteWithoutOrder, order_data: badOrder }, {
      ...baseParams,
      allowMissingRelayOrder: true,
    })).toThrow(InvalidBridgeCalldataError);
  });
});

describe('validateDepositBridgeQuote — negative attack cases', () => {
  const acrossQuote = () => {
    const tx = buildAcrossDepositV3Tx();
    return {
      bridge_id: 'across',
      approve_contract_id: tx.to,
      to_token_raw_amount_hex_str: '0x3b4e9380',
      tx,
    };
  };
  const acrossParams = () => ({
    userAddress: user,
    receiverAddress: user,
    fromChainId: 'arb',
    fromTokenId: arbUsdc,
    fromTokenRawAmount: '10000000',
    toChainId: 'hyperliquid',
    toTokenId: hyperCoreUsdc,
  });

  const expectRejected = (fn, expectedClass, expectedCode) => {
    const onError = jest.fn();
    let caught;
    try {
      fn(onError);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(expectedClass);
    expect(caught.errors.map((e) => e.error_code)).toContain(expectedCode);
    expect(onError).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(onError.mock.calls[0][0]);
    expect(serialized).not.toContain(user);
    expect(serialized).not.toContain(attacker);
    expect(serialized).not.toContain(collector);
    return caught;
  };

  test('rejects unsupported aggregators and unsupported source chains', () => {
    for (const badAgg of ['lifi', 'socket', 'unknown', '']) {
      expectRejected(
        (onError) => validateDepositBridgeQuote({ ...acrossQuote(), bridge_id: badAgg }, { ...acrossParams(), aggregatorId: badAgg, onError }),
        BridgeError,
        BRIDGE_ERRORS.UNSUPPORTED_BRIDGE_AGGREGATOR.error_code,
      );
    }
    expectRejected(
      (onError) => validateDepositBridgeQuote(acrossQuote(), { ...acrossParams(), fromChainId: 'cro', onError }),
      BridgeError,
      BRIDGE_ERRORS.UNSUPPORTED_SOURCE_CHAIN.error_code,
    );
  });

  test('rejects missing tx, fake spender, empty ERC20 spender, fake router, and tx.to === fromTokenId', () => {
    expectRejected(
      (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: null }, { ...acrossParams(), onError }),
      BridgeError,
      BRIDGE_ERRORS.INVALID_TRANSACTION.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote({ ...acrossQuote(), approve_contract_id: attacker }, { ...acrossParams(), onError }),
      InvalidBridgeContractError,
      BRIDGE_ERRORS.SPENDER_NOT_ALLOWED.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote({ ...acrossQuote(), approve_contract_id: '' }, { ...acrossParams(), onError }),
      InvalidBridgeContractError,
      BRIDGE_ERRORS.SPENDER_NOT_ALLOWED.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: { ...acrossQuote().tx, to: attacker } }, { ...acrossParams(), onError }),
      InvalidBridgeContractError,
      BRIDGE_ERRORS.ROUTER_NOT_ALLOWED.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: { ...acrossQuote().tx, to: arbUsdc } }, { ...acrossParams(), onError }),
      InvalidBridgeContractError,
      BRIDGE_ERRORS.ROUTER_NOT_ALLOWED.error_code,
    );
  });

  test('rejects tampered/missing tx.from, tampered/missing tx.chainId, and non-zero ERC20 tx.value', () => {
    for (const badFrom of [attacker, '', undefined]) {
      expectRejected(
        (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: { ...acrossQuote().tx, from: badFrom } }, { ...acrossParams(), onError }),
        InvalidBridgeCalldataError,
        BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH.error_code,
      );
    }
    for (const badChain of [1, 8453, undefined, '']) {
      expectRejected(
        (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: { ...acrossQuote().tx, chainId: badChain } }, { ...acrossParams(), onError }),
        InvalidBridgeCalldataError,
        BRIDGE_ERRORS.FROM_CHAIN_MISMATCH.error_code,
      );
    }
    for (const badValue of ['0x1', '1000', '-1', 'not-hex']) {
      expectRejected(
        (onError) => validateDepositBridgeQuote({ ...acrossQuote(), tx: { ...acrossQuote().tx, value: badValue } }, { ...acrossParams(), onError }),
        InvalidBridgeCalldataError,
        BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE.error_code,
      );
    }
  });

  test('rejects tampered calldata source token, excessive amount, Across handler, and HyperCore message receiver', () => {
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        { ...acrossQuote(), tx: buildAcrossDepositV3Tx({ inputToken: baseUsdc }) },
        { ...acrossParams(), onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.FROM_TOKEN_MISMATCH.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        { ...acrossQuote(), tx: buildAcrossDepositV3Tx({ inputAmount: 10020000 }) },
        { ...acrossParams(), onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        { ...acrossQuote(), tx: buildAcrossDepositV3Tx({ recipient: attacker }) },
        { ...acrossParams(), onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL.error_code,
    );
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        { ...acrossQuote(), tx: buildAcrossDepositV3Tx({ message: hyperCoreMessage(attacker) }) },
        { ...acrossParams(), onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.RECEIVER_MISMATCH.error_code,
    );
  });

  test('rejects fake Relay orderData, tampered Relay receiver, and tampered Relay refund', () => {
    const sample = relayHyperCoreFixtures.perpsErc20;
    const baseRelayParams = {
      userAddress: user,
      fromChainId: sample.fromChainId,
      fromTokenId: sample.fromTokenId,
      fromTokenRawAmount: sample.fromTokenRawAmount,
      toChainId: 'hyperliquid',
      toTokenId: hyperCoreUsdc,
    };

    // Fake orderData hash mismatch
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        {
          bridge_id: 'relay',
          approve_contract_id: sample.tx.to,
          to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
          order_data: { ...sample.order_data, salt: '1' },
          tx: sample.tx,
        },
        { ...baseRelayParams, onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH.error_code,
    );

    // Tampered output receiver with recomputed hash
    const tamperedReceiverOrder = structuredClone(sample.order_data);
    tamperedReceiverOrder.output.payments[0].recipient = attacker;
    const oldHash = hashRelayOrder(sample.order_data).slice(2);
    const newReceiverHash = hashRelayOrder(tamperedReceiverOrder).slice(2);
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        {
          bridge_id: 'relay',
          approve_contract_id: sample.tx.to,
          to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
          order_data: tamperedReceiverOrder,
          tx: { ...sample.tx, data: sample.tx.data.replace(oldHash, newReceiverHash) },
        },
        { ...baseRelayParams, onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.RECEIVER_MISMATCH.error_code,
    );

    // Tampered origin refund recipient with recomputed hash
    const tamperedRefundOrder = structuredClone(sample.order_data);
    tamperedRefundOrder.inputs[0].refunds[0].recipient = attacker;
    const newRefundHash = hashRelayOrder(tamperedRefundOrder).slice(2);
    expectRejected(
      (onError) => validateDepositBridgeQuote(
        {
          bridge_id: 'relay',
          approve_contract_id: sample.tx.to,
          to_token_raw_amount_hex_str: `0x${BigInt(sample.toTokenRawAmount).toString(16)}`,
          order_data: tamperedRefundOrder,
          tx: { ...sample.tx, data: sample.tx.data.replace(oldHash, newRefundHash) },
        },
        { ...baseRelayParams, onError },
      ),
      InvalidBridgeCalldataError,
      BRIDGE_ERRORS.RELAY_REFUND_RECIPIENT_MISMATCH.error_code,
    );
  });
});
