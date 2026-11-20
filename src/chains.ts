/**
 * Chain enums this package knows about: every chain that appears in the bridge
 * support lists and router/spender allowlists.
 *
 * The string values are persisted by clients (storage, analytics), so they
 * must never change. Add new chains here (and to `SERVER_ID_TO_CHAIN_ENUM`)
 * instead of casting string literals.
 */
export const CHAINS_ENUM = {
  ABS: 'ABS',
  APE: 'APE',
  ARBITRUM: 'ARBITRUM',
  ARC: 'ARC',
  AVAX: 'AVAX',
  BASE: 'BASE',
  BERA: 'BERA',
  BLAST: 'BLAST',
  BOB: 'BOB',
  BSC: 'BSC',
  CELO: 'CELO',
  CRO: 'CRO',
  CYBER: 'CYBER',
  ELYSIUM: 'ELYSIUM',
  ERA: 'ERA',
  ETH: 'ETH',
  FLR: 'FLR',
  FRAX: 'FRAX',
  FUSE: 'FUSE',
  GNOSIS: 'GNOSIS',
  GRAVITY: 'GRAVITY',
  HEMI: 'HEMI',
  HOOD: 'HOOD',
  HYPER: 'HYPER',
  INK: 'INK',
  KATANA: 'KATANA',
  KLAY: 'KLAY',
  LENS: 'LENS',
  LINEA: 'LINEA',
  LISK: 'LISK',
  MANTA: 'MANTA',
  MANTLE: 'MANTLE',
  MEGAETH: 'MEGAETH',
  METIS: 'METIS',
  MODE: 'MODE',
  MONAD: 'MONAD',
  MORPH: 'MORPH',
  OP: 'OP',
  OPBNB: 'OPBNB',
  PLASMA: 'PLASMA',
  PLUME: 'PLUME',
  POLYGON: 'POLYGON',
  RONIN: 'RONIN',
  RSK: 'RSK',
  SCRL: 'SCRL',
  SEI: 'SEI',
  SONEIUM: 'SONEIUM',
  SONIC: 'SONIC',
  SOPHON: 'SOPHON',
  STABLE: 'STABLE',
  STORY: 'STORY',
  SWELL: 'SWELL',
  TAIKO: 'TAIKO',
  TEMPO: 'TEMPO',
  UNI: 'UNI',
  WORLD: 'WORLD',
  XDC: 'XDC',
  XLAYER: 'XLAYER',
  ZIRCUIT: 'ZIRCUIT',
  ZORA: 'ZORA',
} as const;

/** Closed union of the chain enums listed in `CHAINS_ENUM`. */
export type KnownChainEnum = (typeof CHAINS_ENUM)[keyof typeof CHAINS_ENUM];

/** Open chain enum: any chain name, with the known ones offered for autocomplete. */
export type ChainEnum = KnownChainEnum | (string & {});

export const SERVER_ID_TO_CHAIN_ENUM = {
  eth: CHAINS_ENUM.ETH,
  op: CHAINS_ENUM.OP,
  flr: CHAINS_ENUM.FLR,
  cro: CHAINS_ENUM.CRO,
  rsk: CHAINS_ENUM.RSK,
  xdc: CHAINS_ENUM.XDC,
  bsc: CHAINS_ENUM.BSC,
  xdai: CHAINS_ENUM.GNOSIS,
  fuse: CHAINS_ENUM.FUSE,
  uni: CHAINS_ENUM.UNI,
  matic: CHAINS_ENUM.POLYGON,
  monad: CHAINS_ENUM.MONAD,
  sonic: CHAINS_ENUM.SONIC,
  opbnb: CHAINS_ENUM.OPBNB,
  lens: CHAINS_ENUM.LENS,
  frax: CHAINS_ENUM.FRAX,
  era: CHAINS_ENUM.ERA,
  world: CHAINS_ENUM.WORLD,
  stable: CHAINS_ENUM.STABLE,
  hyper: CHAINS_ENUM.HYPER,
  metis: CHAINS_ENUM.METIS,
  lisk: CHAINS_ENUM.LISK,
  sei: CHAINS_ENUM.SEI,
  gravity: CHAINS_ENUM.GRAVITY,
  soneium: CHAINS_ENUM.SONEIUM,
  swell: CHAINS_ENUM.SWELL,
  ron: CHAINS_ENUM.RONIN,
  xlayer: CHAINS_ENUM.XLAYER,
  abs: CHAINS_ENUM.ABS,
  morph: CHAINS_ENUM.MORPH,
  tempo: CHAINS_ENUM.TEMPO,
  megaeth: CHAINS_ENUM.MEGAETH,
  mnt: CHAINS_ENUM.MANTLE,
  klay: CHAINS_ENUM.KLAY,
  base: CHAINS_ENUM.BASE,
  plasma: CHAINS_ENUM.PLASMA,
  ape: CHAINS_ENUM.APE,
  mode: CHAINS_ENUM.MODE,
  arb: CHAINS_ENUM.ARBITRUM,
  celo: CHAINS_ENUM.CELO,
  hemi: CHAINS_ENUM.HEMI,
  avax: CHAINS_ENUM.AVAX,
  sophon: CHAINS_ENUM.SOPHON,
  ink: CHAINS_ENUM.INK,
  linea: CHAINS_ENUM.LINEA,
  bob: CHAINS_ENUM.BOB,
  bera: CHAINS_ENUM.BERA,
  blast: CHAINS_ENUM.BLAST,
  plume: CHAINS_ENUM.PLUME,
  taiko: CHAINS_ENUM.TAIKO,
  scrl: CHAINS_ENUM.SCRL,
  katana: CHAINS_ENUM.KATANA,
  manta: CHAINS_ENUM.MANTA,
  story: CHAINS_ENUM.STORY,
  cyber: CHAINS_ENUM.CYBER,
  zircuit: CHAINS_ENUM.ZIRCUIT,
  hood: CHAINS_ENUM.HOOD,
  arc: CHAINS_ENUM.ARC,
  elysium: CHAINS_ENUM.ELYSIUM,
  zora: CHAINS_ENUM.ZORA,
} as const satisfies Record<string, KnownChainEnum>;

export const CHAIN_ENUM_TO_SERVER_ID = Object.fromEntries(
  Object.entries(SERVER_ID_TO_CHAIN_ENUM).map(([serverId, chainEnum]) => [
    chainEnum,
    serverId,
  ])
) as Record<KnownChainEnum, string>;

const KNOWN_CHAIN_ENUMS: readonly string[] = Object.values(CHAINS_ENUM);

export const normalizeChainEnum = (
  chainId: string
): KnownChainEnum | undefined => {
  if (KNOWN_CHAIN_ENUMS.includes(chainId)) {
    return chainId as KnownChainEnum;
  }

  const serverId = chainId.toLowerCase() as keyof typeof SERVER_ID_TO_CHAIN_ENUM;

  return SERVER_ID_TO_CHAIN_ENUM[serverId];
};
