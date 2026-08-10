import { Injectable } from '@nestjs/common';

const TTL_MS = 5 * 60 * 1000;

type Entry = { code: string; exp: number };

@Injectable()
export class PhoneOtpStore {
  private readonly store = new Map<string, Entry>();

  set(mobileDigits: string, code: string): void {
    const key = mobileDigits.replace(/\D/g, '');
    this.store.set(key, { code, exp: Date.now() + TTL_MS });
  }

  /**
   * Returns true if the code matches and removes the entry (one-time use).
   */
  verifyAndConsume(mobileDigits: string, code: string): boolean {
    const key = mobileDigits.replace(/\D/g, '');
    const e = this.store.get(key);
    if (!e || Date.now() > e.exp) {
      this.store.delete(key);
      return false;
    }
    if (e.code !== String(code).trim()) {
      return false;
    }
    this.store.delete(key);
    return true;
  }
}
