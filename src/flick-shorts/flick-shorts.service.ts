import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { deriveFlickSportFromTurf } from 'src/common/turf-flick-sport.util';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  AdminRoleService,
  FLICK_SHORT_MAX_SEC,
} from 'src/admin/admin-role.service';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';
import { Recording } from 'src/recording/entities/recording.entity';
import { FlickShort, FlickShortComment } from './entities/flick-short.entity';
import {
  CreateFlickShortDto,
  FlickShortCommentBodyDto,
} from './dto/flick-short.dto';

export type FlickShortPublicDto = {
  id: string;
  recordingId: string;
  sport: string;
  title: string;
  topText: string;
  bottomText: string;
  aspect: '9:16' | '16:9';
  muxPlaybackId: string;
  startSec: number;
  endSec: number;
  approved: boolean;
  likesCount: number;
  viewsCount: number;
  likedByCurrentUser: boolean;
  comments: {
    id: string;
    userName: string | null;
    text: string;
    createdAt: string;
  }[];
  createdAt: string;
};

function resolveClipWindow(dto: CreateFlickShortDto): {
  start: number;
  end: number;
} {
  const start = dto.startSec ?? 0;
  const end = dto.endSec ?? start + FLICK_SHORT_MAX_SEC;
  if (end <= start) {
    throw new BadRequestException('endSec must be greater than startSec');
  }
  if (end - start > FLICK_SHORT_MAX_SEC + 1e-6) {
    throw new BadRequestException(
      `FlickShort clip must be ${FLICK_SHORT_MAX_SEC} seconds or less (inclusive)`,
    );
  }
  return { start, end };
}

@Injectable()
export class FlickShortsService {
  constructor(
    @InjectRepository(FlickShort)
    private readonly flickRepo: Repository<FlickShort>,
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    private readonly userService: UserService,
    private readonly adminRole: AdminRoleService,
  ) {}

  private toPublic(
    s: FlickShort,
    viewerUserId?: string | null,
  ): FlickShortPublicDto {
    const likedUserIds = Array.isArray(s.likedUserIds) ? s.likedUserIds : [];
    return {
      id: s.id,
      recordingId: s.recordingId,
      sport: s.sport,
      title: s.title,
      topText: s.topText,
      bottomText: s.bottomText,
      aspect: s.aspect,
      muxPlaybackId: s.muxPlaybackId,
      startSec: s.startSec,
      endSec: s.endSec,
      approved: s.approved,
      likesCount: s.likesCount,
      viewsCount: s.viewsCount ?? 0,
      likedByCurrentUser: viewerUserId
        ? likedUserIds.includes(String(viewerUserId))
        : false,
      comments: (s.comments ?? []).map((c) => ({
        id: c.id,
        userName: c.userName,
        text: c.text,
        createdAt: c.createdAt,
      })),
      createdAt: s.createdAt.toISOString(),
    };
  }

  private async requireAdminByUserId(userId: string): Promise<void> {
    const u = await this.userService.findOne(userId);
    if (!(await this.adminRole.isAdminByPhone(u.phone_number))) {
      throw new ForbiddenException('Admin only');
    }
  }

  async listPublic(
    sport: string | undefined,
    viewerUserId?: string | null,
  ): Promise<FlickShortPublicDto[]> {
    const qb = this.flickRepo
      .createQueryBuilder('f')
      .where('f.approved = :approved', { approved: true })
      .orderBy('f.createdAt', 'DESC');
    if (sport && sport !== 'all' && sport !== '') {
      qb.andWhere('f.sport = :sport', { sport });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.toPublic(r, viewerUserId));
  }

  async listAllForAdmin(_userId: string): Promise<FlickShortPublicDto[]> {
    await this.requireAdminByUserId(_userId);
    const rows = await this.flickRepo.find({ order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toPublic(r, _userId));
  }

  async create(
    userId: string,
    dto: CreateFlickShortDto,
  ): Promise<FlickShortPublicDto> {
    await this.requireAdminByUserId(userId);
    const { start, end } = resolveClipWindow(dto);
    const rec = await this.recordingRepo.findOne({
      where: { id: dto.recordingId },
      relations: ['turf'],
    });
    if (!rec) {
      throw new NotFoundException('Recording not found');
    }
    if (!rec.mux_playback_id) {
      throw new BadRequestException('Recording is not ready for streaming yet');
    }
    const sport = deriveFlickSportFromTurf(
      rec.turf?.sports_supported,
      rec.turf?.name,
    );
    const row = this.flickRepo.create({
      recordingId: rec.id,
      sport,
      title: dto.title.trim(),
      topText: dto.topText,
      bottomText: dto.bottomText,
      aspect: dto.aspect,
      muxPlaybackId: rec.mux_playback_id,
      startSec: start,
      endSec: end,
      approved: false,
      createdByUserId: userId,
      comments: [],
    });
    const saved = await this.flickRepo.save(row);
    return this.toPublic(saved, userId);
  }

  async deleteAsAdmin(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.requireAdminByUserId(userId);
    const row = await this.flickRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException();
    }
    if (row.approved) {
      throw new BadRequestException('Cannot delete an approved FlickShort');
    }
    await this.flickRepo.remove(row);
    return { ok: true };
  }

  async setApproved(
    userId: string,
    id: string,
    approved: boolean,
  ): Promise<FlickShortPublicDto> {
    await this.requireAdminByUserId(userId);
    const row = await this.flickRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    row.approved = approved;
    const saved = await this.flickRepo.save(row);
    return this.toPublic(saved, userId);
  }

  async addLike(userId: string, id: string): Promise<FlickShortPublicDto> {
    const row = await this.flickRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    if (!row.approved) {
      throw new NotFoundException();
    }
    const likedUserIds = new Set(
      Array.isArray(row.likedUserIds) ? row.likedUserIds.map(String) : [],
    );
    if (likedUserIds.has(String(userId))) {
      likedUserIds.delete(String(userId));
    } else {
      likedUserIds.add(String(userId));
    }
    row.likedUserIds = Array.from(likedUserIds);
    row.likesCount = row.likedUserIds.length;
    const saved = await this.flickRepo.save(row);
    return this.toPublic(saved, userId);
  }

  async addView(
    id: string,
    viewerUserId?: string | null,
  ): Promise<FlickShortPublicDto> {
    const row = await this.flickRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    if (!row.approved) {
      throw new NotFoundException();
    }
    row.viewsCount = (row.viewsCount ?? 0) + 1;
    const saved = await this.flickRepo.save(row);
    return this.toPublic(saved, viewerUserId);
  }

  async addComment(
    userId: string,
    id: string,
    body: FlickShortCommentBodyDto,
  ): Promise<FlickShortPublicDto> {
    const row = await this.flickRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    if (!row.approved) {
      throw new NotFoundException();
    }
    const u = await this.userService.findOne(userId);
    if (!u) {
      throw new NotFoundException();
    }
    const c: FlickShortComment = {
      id: randomUUID(),
      userId: u.id,
      userName: u.name,
      text: body.text.trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    const list = Array.isArray(row.comments) ? [...row.comments] : [];
    list.push(c);
    row.comments = list;
    const saved = await this.flickRepo.save(row);
    return this.toPublic(saved, userId);
  }
}
