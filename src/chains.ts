import { CHAINS_ENUM as DBK_CHAINS_ENUM } from '@debank/common';

export const CHAINS_ENUM = DBK_CHAINS_ENUM;

export const EXTRA_CHAINS = [
  'XDC',
  'UNI',
  'RONIN',
  'XLAYER',
  'MONAD',
  'SONIC',
  'LENS',
  'WORLD',
  'STABLE',
  'HYPER',
  'LISK',
  'SEI',
  'GRAVITY',
  'SONEIUM',
  'SWELL',
  'ABS',
  'MORPH',
  'TEMPO',
  'MEGAETH',
  'PLASMA',
  'APE',
  'HEMI',
  'SOPHON',
  'INK',
  'BOB',
  'BERA',
  'PLUME',
  'TAIKO',
  'KATANA',
  'STORY',
  'CYBER',
  'ZIRCUIT',
] as const;

export type ExtraChainEnum = (typeof EXTRA_CHAINS)[number];

export type ChainEnum = DBK_CHAINS_ENUM | ExtraChainEnum;

export const SERVER_ID_TO_CHAIN_ENUM = {
  eth: CHAINS_ENUM.ETH,
  op: CHAINS_ENUM.OP,
  flr: CHAINS_ENUM.FLR,
  cro: CHAINS_ENUM.CRO,
  rsk: CHAINS_ENUM.RSK,
  xdc: 'XDC' as ChainEnum,
  bsc: CHAINS_ENUM.BSC,
  xdai: CHAINS_ENUM.GNOSIS,
  fuse: CHAINS_ENUM.FUSE,
  uni: 'UNI' as ChainEnum,
  matic: CHAINS_ENUM.POLYGON,
  monad: 'MONAD' as ChainEnum,
  sonic: 'SONIC' as ChainEnum,
  opbnb: CHAINS_ENUM.OPBNB,
  lens: 'LENS' as ChainEnum,
  frax: CHAINS_ENUM.FRAX,
  era: CHAINS_ENUM.ERA,
  world: 'WORLD' as ChainEnum,
  stable: 'STABLE' as ChainEnum,
  hyper: 'HYPER' as ChainEnum,
  metis: CHAINS_ENUM.METIS,
  lisk: 'LISK' as ChainEnum,
  sei: 'SEI' as ChainEnum,
  gravity: 'GRAVITY' as ChainEnum,
  soneium: 'SONEIUM' as ChainEnum,
  swell: 'SWELL' as ChainEnum,
  ron: 'RONIN' as ChainEnum,
  xlayer: 'XLAYER' as ChainEnum,
  abs: 'ABS' as ChainEnum,
  morph: 'MORPH' as ChainEnum,
  tempo: 'TEMPO' as ChainEnum,
  megaeth: 'MEGAETH' as ChainEnum,
  mnt: CHAINS_ENUM.MANTLE,
  klay: CHAINS_ENUM.KLAY,
  base: CHAINS_ENUM.BASE,
  plasma: 'PLASMA' as ChainEnum,
  ape: 'APE' as ChainEnum,
  mode: CHAINS_ENUM.MODE,
  arb: CHAINS_ENUM.ARBITRUM,
  celo: CHAINS_ENUM.CELO,
  hemi: 'HEMI' as ChainEnum,
  avax: CHAINS_ENUM.AVAX,
  sophon: 'SOPHON' as ChainEnum,
  ink: 'INK' as ChainEnum,
  linea: CHAINS_ENUM.LINEA,
  bob: 'BOB' as ChainEnum,
  bera: 'BERA' as ChainEnum,
  blast: CHAINS_ENUM.BLAST,
  plume: 'PLUME' as ChainEnum,
  taiko: 'TAIKO' as ChainEnum,
  scrl: CHAINS_ENUM.SCRL,
  katana: 'KATANA' as ChainEnum,
  manta: CHAINS_ENUM.MANTA,
  story: 'STORY' as ChainEnum,
  cyber: 'CYBER' as ChainEnum,
  zircuit: 'ZIRCUIT' as ChainEnum,
  zora: CHAINS_ENUM.ZORA,
} as const satisfies Record<string, ChainEnum>;

export const CHAIN_ENUM_TO_SERVER_ID = Object.fromEntries(
  Object.entries(SERVER_ID_TO_CHAIN_ENUM).map(([serverId, chainEnum]) => [
    chainEnum,
    serverId,
  ])
) as Record<ChainEnum, string>;

export const normalizeChainEnum = (chainId: string): ChainEnum | undefined => {
  if (
    (Object.values(CHAINS_ENUM) as string[]).includes(chainId) ||
    (EXTRA_CHAINS as readonly string[]).includes(chainId)
  ) {
    return chainId as ChainEnum;
  }

  const serverId = chainId.toLowerCase() as keyof typeof SERVER_ID_TO_CHAIN_ENUM;

  return SERVER_ID_TO_CHAIN_ENUM[serverId];
};
