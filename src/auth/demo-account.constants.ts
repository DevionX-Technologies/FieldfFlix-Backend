/** Hardcoded demo login for app store review / QA (no SMS). */
export const DEMO_PHONE_DIGITS = '1111111111';
export const DEMO_OTP = '123456';
export const DEMO_USER_NAME = 'Test User';

export function phoneDigitsOnly(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  if (digits.startsWith('91')) {
    // 91 followed by 10 digits (total 12) or 9 digits (total 11)
    if (digits.length === 12 || digits.length === 11) {
      return digits.slice(2);
    }
    // 91 followed by any sequence of 1s (e.g. 91 + 8 ones = 10 digits, or 91 + 7 ones = 9 digits)
    if (/^1{6,12}$/.test(digits.slice(2))) {
      return digits.slice(2);
    }
    // 91 followed by 8888888888
    if (digits.slice(2) === '8888888888') {
      return digits.slice(2);
    }
  }
  return digits;
}

export function isDemoPhone(mobile: string): boolean {
  const raw = String(mobile ?? '').replace(/\D/g, '');
  if (!raw) return false;

  // Direct match on sequence of 1s (e.g. 11111111, 111111111, 1111111111)
  if (/^1{6,14}$/.test(raw)) return true;

  // 91 prefix followed by sequence of 1s (e.g. 9111111111, 91111111111, 911111111111)
  if (raw.startsWith('91') && /^1{6,12}$/.test(raw.slice(2))) return true;

  // Test phone 8888888888
  if (raw === '8888888888' || raw === '918888888888') return true;

  const stripped = phoneDigitsOnly(mobile);
  return (
    stripped === '11111111' ||
    stripped === '111111111' ||
    stripped === '1111111111' ||
    stripped === '8888888888' ||
    /^1{6,14}$/.test(stripped) ||
    stripped === DEMO_PHONE_DIGITS
  );
}

export function isDemoOtp(otp: string): boolean {
  return String(otp ?? '').trim() === DEMO_OTP;
}
