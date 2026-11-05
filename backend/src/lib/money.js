// Money helpers for Fund Me (amounts are integers in minor units: pence, cents, kobo).
export const CURRENCY_SYMBOL = { GBP: '£', USD: '$', EUR: '€', NGN: '₦' };

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 200000, 'GBP' → '£2,000'; 1050 → '£10.50' (decimals only when needed, or always with {cents:true}). */
export function formatMoney(minor, currency, { cents = false } = {}) {
  const n = Math.round(Number(minor) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sym = CURRENCY_SYMBOL[currency] || '';
  const body = group(String(whole)) + (frac || cents ? `.${String(frac).padStart(2, '0')}` : '');
  return `${neg ? '-' : ''}${sym}${body}`;
}

export function percentOf(raised, goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return 0;
  return Math.floor((Number(raised) / g) * 100);
}
