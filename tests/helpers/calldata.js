export const word = (value) => BigInt(value).toString(16).padStart(64, '0');
export const bytes = (value) => word((value.length - 2) / 2) +
  value.slice(2).padEnd(Math.ceil((value.length - 2) / 64) * 64, '0');
