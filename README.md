# rabby-bridge

Minimal bridge SDK for Rabby:

- enumerates supported bridge aggregators and chains
- maintains per-chain spender/router allowlists
- validates backend bridge quotes before returning them
- does not implement calldata decoding

## Test

Run `yarn test` to build the package and execute the Jest suite.
