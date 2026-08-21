import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  forwardRef,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { RecordingService } from 'src/recording/service/recording.service';
import { UserService } from 'src/user/user.service';
import { AdminRoleService } from './admin-role.service';
import { AddAdminPhoneDto } from './dto/add-admin-phone.dto';
import { Public } from 'src/decorators/public.decorator';

@Controller('admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminController {
  constructor(
    private readonly adminRole: AdminRoleService,
    private readonly userService: UserService,
    // `RecordingModule` is imported in `AdminModule` behind `forwardRef` to
    // break the AdminModule ↔ RecordingModule cycle. The matching forwardRef
    // here lets Nest resolve `RecordingService` lazily — without it the DI
    // container sees `undefined` at construction time.
    @Inject(forwardRef(() => RecordingService))
    private readonly recordingService: RecordingService,
  ) {}

  @Public()
  @Get('migrate-db')
  async migrateDb() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('pg');

    const sourceConfig = {
      host: 'ep-green-paper-aysc1pqc.c-5.us-east-2.aws.neon.tech',
      port: 5432,
      user: 'neondb_owner',
      password: 'npg_OwyVHutfN28n',
      database: 'neondb',
      ssl: { rejectUnauthorized: false },
    };

    const destConfig = {
      host: 'fieldflicks-production-db.czk0ioma2e3z.ap-south-1.rds.amazonaws.com',
      port: 5432,
      user: 'fieldflicks',
      password: 'curJqH6SwDwEFSbawMva',
      database: 'fieldflicks-prod',
      ssl: { rejectUnauthorized: false },
    };

    const source = new Client(sourceConfig);
    const dest = new Client(destConfig);

    try {
      await source.connect();
      await dest.connect();

      await dest.query("SET session_replication_role = 'replica';");

      const tablesRes = await source.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name != 'spatial_ref_sys'
        AND table_type = 'BASE TABLE';
      `);
      const tables = tablesRes.rows.map((r) => r.table_name);

      for (const table of tables) {
        const dataRes = await source.query(`SELECT * FROM "${table}"`);
        const rows = dataRes.rows;

        if (rows.length > 0) {
          try {
            await dest.query(`TRUNCATE TABLE "${table}" CASCADE;`);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (_e) {
            await dest.query(`DELETE FROM "${table}";`);
          }

          const columns = Object.keys(rows[0]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const insertQuery = `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES (${placeholders})`;

          for (const row of rows) {
            const values = columns.map((col) => row[col]);
            await dest.query(insertQuery, values);
          }
        } else {
          try {
            await dest.query(`TRUNCATE TABLE "${table}" CASCADE;`);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (_e) {}
        }
      }

      await dest.query("SET session_replication_role = 'origin';");
      return { success: true, message: 'Migration complete!' };
    } catch (err) {
      return { success: false, message: 'Migration error: ' + err.message };
    } finally {
      await source.end();
      await dest.end();
    }
  }

  /** Any authenticated user: whether they have admin UI access. */
  @Get('me')
  async me(@Req() req: Request & { user: ILocalLoginPayload }) {
    const u = await this.userService.findOne(req.user.user_id);
    const isAdmin = await this.adminRole.isAdminByPhone(u.phone_number);
    return { isAdmin };
  }

  /**
   * Mux-ready recordings for the FlickShort admin picker (no manual UUID paste).
   */
  @Get('recordings-for-flickshorts')
  async recordingsForFlickshorts(
    @Req() req: Request & { user: ILocalLoginPayload },
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.recordingService.listMuxReadyRecordingsForAdmin();
  }

  /**
   * Per-camera recording activity for the current day, grouped by status.
   *
   * Designed for incident triage when the operator sees a spike of "failed"
   * recordings and needs to know whether the failures are concentrated on
   * one Raspberry Pi or spread across the fleet. Response also surfaces the
   * most recent failed recording per camera with its raspberryPiRecordingId
   * so the operator can jump straight to the Pi’s logs.
   *
   *   GET /admin/cameras-today
   */
  @Get('cameras-today')
  async camerasToday(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    return this.recordingService.cameraActivityToday();
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
