/** Hardcoded demo login for app store review / QA (no SMS). */
export const DEMO_PHONE_DIGITS = '8888888888';
export const DEMO_OTP = '123456';
export const DEMO_USER_NAME = 'Demo User';

export function phoneDigitsOnly(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits;
}

export function isDemoPhone(mobile: string): boolean {
  return phoneDigitsOnly(mobile) === DEMO_PHONE_DIGITS;
}

export function isDemoOtp(otp: string): boolean {
  return String(otp ?? '').trim() === DEMO_OTP;
}
