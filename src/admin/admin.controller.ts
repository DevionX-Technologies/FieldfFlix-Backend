import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { UserService } from 'src/user/user.service';
import { AdminRoleService } from './admin-role.service';
import { AddAdminPhoneDto } from './dto/add-admin-phone.dto';

@Controller('admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminController {
  constructor(
    private readonly adminRole: AdminRoleService,
    private readonly userService: UserService,
  ) {}

  /** Any authenticated user: whether they have admin UI access. */
  @Get('me')
  async me(@Req() req: Request & { user: ILocalLoginPayload }) {
    const u = await this.userService.findOne(req.user.user_id);
    const isAdmin = await this.adminRole.isAdminByPhone(u.phone_number);
    return { isAdmin };
  }

  @Get('phones')
  async listPhones(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    const rows = await this.adminRole.listPhones();
    return {
      phones: rows.map((r) => ({
        id: r.id,
        phoneLast10: r.phoneLast10,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('phones')
  async addPhone(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: AddAdminPhoneDto,
  ) {
    const adminId = req.user.user_id;
    await this.assertAdmin(adminId);
    const created = await this.adminRole.addPhone(adminId, body.phone);
    return {
      id: created.id,
      phoneLast10: created.phoneLast10,
      createdAt: created.createdAt.toISOString(),
    };
  }

  @Delete('phones/:last10')
  async removePhone(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('last10') last10: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    const d = String(last10).replace(/\D/g, '');
    const last = d.length >= 10 ? d.slice(-10) : d;
    if (last.length !== 10) {
      throw new NotFoundException();
    }
    await this.adminRole.removePhone(last);
    return { ok: true };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const u = await this.userService.findOne(userId);
    if (!(await this.adminRole.isAdminByPhone(u.phone_number))) {
      throw new ForbiddenException('Admin only');
    }
  }
}
