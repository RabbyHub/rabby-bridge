import { expect } from '@jest/globals';
import { InvalidBridgeCalldataError } from '../dist/index.js';

export const expectCalldataError = (validate) => {
  let failure;
  try { validate(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(InvalidBridgeCalldataError);
  for (const error of failure.errors) expect(error).toMatchObject({ pass: false, blocking: true });
  return failure;
};
