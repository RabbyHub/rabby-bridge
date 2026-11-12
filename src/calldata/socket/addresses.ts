/** Source vault that receives every Socket RFQ deposit. Not the destination recipient. */
export const SOCKET_RFQ_VAULT = '0x97caca78ac2a94c67643d07843f85afaa44a3ea5';

/** Circle TokenMessenger V2 used by Socket CCTP. The same address on each EVM chain. */
export const SOCKET_CCTP_MESSENGER = '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d';

/**
 * Fixed destination mint recipient for Socket CCTP.
 * The user's wallet is in a destination signature, not this field.
 */
export const SOCKET_CCTP_MINT_RECIPIENT = '0x424a31a57f7c63918ecaa2fac38016a8af5a6ec2';
