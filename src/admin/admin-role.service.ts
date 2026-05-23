import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPhone } from './entities/admin-phone.entity';

/** Baked-in fallback so seed DB removal never locks out the primary admin. */
export const BOOTSTRAP_ADMIN_PHONE_LAST_10 = new Set<string>(['9321538768']);

const FLICK_SHORT_MAX_SEC = 15;
export { FLICK_SHORT_MAX_SEC };

function phoneLast10(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d.length > 0 ? d : null;
}

/**
 * Merges bootstrap numbers with rows in `admin_phones` (added by other admins).
 */
@Injectable()
export class AdminRoleService {
  constructor(
    @InjectRepository(AdminPhone)
    private readonly adminPhoneRepo: Repository<AdminPhone>,
  ) {}

  async isAdminByPhone(phone: string | null | undefined): Promise<boolean> {
    const last = phoneLast10(phone);
    if (!last) return false;
    if (BOOTSTRAP_ADMIN_PHONE_LAST_10.has(last)) return true;
    const row = await this.adminPhoneRepo.findOne({
      where: { phoneLast10: last },
    });
    return !!row;
  }

  async listPhones(): Promise<AdminPhone[]> {
    return this.adminPhoneRepo.find({ order: { createdAt: 'ASC' } });
  }

  async addPhone(
    createdByUserId: string,
    rawPhone: string,
  ): Promise<AdminPhone> {
    const last = phoneLast10(rawPhone);
    if (!last || last.length !== 10) {
      throw new BadRequestException('Invalid phone (need 10 digits).');
    }
    const existing = await this.adminPhoneRepo.findOne({
      where: { phoneLast10: last },
    });
    if (existing) {
      throw new ConflictException('This number is already an admin.');
    }
    const row = this.adminPhoneRepo.create({
      phoneLast10: last,
      createdByUserId,
    });
    return this.adminPhoneRepo.save(row);
  }

  async removePhone(last10: string): Promise<void> {
    if (BOOTSTRAP_ADMIN_PHONE_LAST_10.has(last10)) {
      await this.adminPhoneRepo.delete({ phoneLast10: last10 });
      return;
    }
    const res = await this.adminPhoneRepo.delete({ phoneLast10: last10 });
    if (!res.affected) {
      throw new NotFoundException();
    }
  }
}
