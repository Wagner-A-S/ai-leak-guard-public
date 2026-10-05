// Sources for the factual numbering rules are listed in detectors/SOURCES.md.
export function luhn(value) {
  const digits = value.replace(/\D/g, '');
  if (!/^\d+$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0,
    double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

// ISO 13616 national lengths from the SWIFT registry, release 101 (Dec 2025).
export const IBAN_LENGTHS = Object.freeze({
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
});

export function validIban(value) {
  const normalized = value.replace(/[ \t\u00a0-]/g, '').toUpperCase();
  if (
    !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized) ||
    normalized.length !== IBAN_LENGTHS[normalized.slice(0, 2)]
  )
    return false;
  let remainder = 0;
  for (const character of normalized.slice(4) + normalized.slice(0, 4)) {
    const code = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function validSsn(value) {
  const d = value.replace(/\D/g, '');
  return (
    /^\d{9}$/.test(d) &&
    !['000', '666'].includes(d.slice(0, 3)) &&
    Number(d.slice(0, 3)) < 900 &&
    d.slice(3, 5) !== '00' &&
    d.slice(5) !== '0000'
  );
}

export function validSnils(value) {
  const d = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^0+$/.test(d)) return false;
  // Earlier issued low serials have no usable published checksum guarantee.
  if (Number(d.slice(0, 9)) <= 1001998) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (9 - i);
  const checksum =
    sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : sum % 101 === 100 ? 0 : sum % 101;
  return checksum === Number(d.slice(9));
}

export function validSpanishId(value) {
  const normalized = value.replace(/[ -]/g, '').toUpperCase();
  if (!/^(?:\d{8}|[XYZ]\d{7})[A-Z]$/.test(normalized)) return false;
  const number = normalized
    .slice(0, -1)
    .replace(/^[XYZ]/, (letter) => String('XYZ'.indexOf(letter)));
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(number) % 23] === normalized.at(-1);
}

const CF_ODD = {
  0: 1,
  1: 0,
  2: 5,
  3: 7,
  4: 9,
  5: 13,
  6: 15,
  7: 17,
  8: 19,
  9: 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};
export function validCodiceFiscale(value) {
  const d = value.toUpperCase();
  if (
    !/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(
      d,
    )
  )
    return false;
  let sum = 0;
  for (let i = 0; i < 15; i++)
    sum += i % 2 === 0 ? CF_ODD[d[i]] : /\d/.test(d[i]) ? Number(d[i]) : d.charCodeAt(i) - 65;
  return String.fromCharCode(65 + (sum % 26)) === d[15];
}

export function validPesel(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return (
    (10 - (weights.reduce((sum, w, i) => sum + w * Number(value[i]), 0) % 10)) % 10 ===
    Number(value[10])
  );
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function validAadhaar(value) {
  const d = value.replace(/\D/g, '');
  if (!/^[2-9]\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  let c = 0;
  [...d].reverse().forEach((digit, i) => {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(digit)]];
  });
  return c === 0;
}

export function validIpv4(value) {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  );
}

export function validIpv6(value) {
  const zoneRemoved = value.replace(/%[\w.-]{1,32}$/, '');
  if (!zoneRemoved.includes(':') || /[^\da-f:.]/i.test(zoneRemoved)) return false;
  if (zoneRemoved.includes(':::')) return false;
  if ((zoneRemoved.match(/::/g) || []).length > 1) return false;
  if (!zoneRemoved.includes('::') && (zoneRemoved.startsWith(':') || zoneRemoved.endsWith(':')))
    return false;
  const parts = zoneRemoved.split(':');
  const ipv4 = parts.at(-1).includes('.') ? parts.pop() : null;
  if (ipv4 && !validIpv4(ipv4)) return false;
  const groups = parts.filter(Boolean);
  if (groups.some((part) => !/^[\da-f]{1,4}$/i.test(part))) return false;
  const count = groups.length + (ipv4 ? 2 : 0);
  return zoneRemoved.includes('::') ? count < 8 : count === 8;
}
