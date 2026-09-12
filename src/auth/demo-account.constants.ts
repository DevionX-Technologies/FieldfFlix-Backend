/** Hardcoded demo login for app store review / QA / local testing (no SMS). */
export const DEMO_PHONE_DIGITS = '8888888888';
export const DEMO_PHONE_DIGITS_2 = '7777777777';
export const DEMO_OTP = '123456';
export const DEMO_USER_NAME = 'Demo User';
export const DEMO_USER_2_NAME = 'Demo User 2';

export function phoneDigitsOnly(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits;
}

export function isDemoPhone(mobile: string): boolean {
  const digits = phoneDigitsOnly(mobile);
  return (
    digits === DEMO_PHONE_DIGITS ||
    digits === DEMO_PHONE_DIGITS_2 ||
    digits === '77777777'
  );
}

export function getDemoUserName(mobile: string): string {
  const digits = phoneDigitsOnly(mobile);
  if (digits === DEMO_PHONE_DIGITS_2 || digits === '77777777') {
    return DEMO_USER_2_NAME;
  }
  return DEMO_USER_NAME;
}

export function isDemoOtp(otp: string): boolean {
  return String(otp ?? '').trim() === DEMO_OTP;
}
