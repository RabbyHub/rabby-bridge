import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import type { BridgeErrorDefinition } from '../errors/index.js';

export class InvalidBridgeProviderError extends BridgeError {
  readonly reason: string;
  constructor(public readonly provider: string, error: BridgeErrorDefinition | BridgeError | string) {
    super(BRIDGE_ERRORS.INVALID_RESPONSE, { provider }, error instanceof BridgeError ? error.errors : [typeof error === 'string' ? BRIDGE_ERRORS.INVALID_RESPONSE : error]);
    this.reason = typeof error === 'string' ? error : this.message;
    this.message = `Bridge provider validation failed for ${provider}: ${this.reason}`;
    this.name = 'InvalidBridgeProviderError';
  }
}
