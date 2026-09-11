import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlickShortsService } from './flick-shorts.service';
import { FlickShort } from './entities/flick-short.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { RecordingHighlights } from 'src/recording/entities/recording-highlights.entity';
import { SharedRecording } from 'src/recording/entities/shared-recording.entity';
import { UserService } from 'src/user/user.service';
import { AdminRoleService } from 'src/admin/admin-role.service';
import { PointsService } from 'src/points/points.service';
import { AchievementsService } from 'src/achievements/achievements.service';

describe('FlickShortsService Achievement Telemetry Integration', () => {
  let service: FlickShortsService;
  let flickRepo: jest.Mocked<Repository<FlickShort>>;
  let recordingRepo: jest.Mocked<Repository<Recording>>;
  let highlightsRepo: jest.Mocked<Repository<RecordingHighlights>>;
  let sharedRecordingRepo: jest.Mocked<Repository<SharedRecording>>;
  let userService: jest.Mocked<UserService>;
  let adminRole: jest.Mocked<AdminRoleService>;
  let pointsService: jest.Mocked<PointsService>;
  let achievementsService: jest.Mocked<AchievementsService>;

  beforeEach(async () => {
    flickRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'short-123', createdAt: new Date() })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 'short-123', createdAt: new Date() })),
      remove: jest.fn(),
    } as any;

    recordingRepo = {
      findOne: jest.fn(),
    } as any;

    highlightsRepo = {
      findOne: jest.fn(),
    } as any;

    sharedRecordingRepo = {
      findOne: jest.fn(),
    } as any;

    userService = {
      findOne: jest.fn().mockResolvedValue({ id: 'admin-1', phone_number: '+1234567890', name: 'Admin' }),
    } as any;

    adminRole = {
      isAdminByPhone: jest.fn().mockResolvedValue(true),
    } as any;

    pointsService = {
      awardPoints: jest.fn().mockResolvedValue({} as any),
    } as any;

    achievementsService = {
      recordShortUploaded: jest.fn().mockResolvedValue({} as any),
      recordShortLiked: jest.fn().mockResolvedValue({} as any),
      recordShortShared: jest.fn().mockResolvedValue({} as any),
      recordShortViewed: jest.fn().mockResolvedValue({} as any),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlickShortsService,
        { provide: getRepositoryToken(FlickShort), useValue: flickRepo },
        { provide: getRepositoryToken(Recording), useValue: recordingRepo },
        { provide: getRepositoryToken(RecordingHighlights), useValue: highlightsRepo },
        { provide: getRepositoryToken(SharedRecording), useValue: sharedRecordingRepo },
        { provide: UserService, useValue: userService },
        { provide: AdminRoleService, useValue: adminRole },
        { provide: PointsService, useValue: pointsService },
        { provide: AchievementsService, useValue: achievementsService },
      ],
    }).compile();

    service = module.get<FlickShortsService>(FlickShortsService);
  });

  it('create() dispatches recordShortUploaded to achievements service', async () => {
    recordingRepo.findOne.mockResolvedValueOnce({
      id: 'rec-1',
      mux_playback_id: 'mux-1',
      turf: { sports_supported: ['pickleball'], name: 'Turf 1' },
    } as any);

    const result = await service.create('admin-1', {
      recordingId: 'rec-1',
      sport: 'pickleball',
      title: 'Epic Rally',
      topText: 'Look at this',
      bottomText: 'Amazing',
      aspect: '9:16',
      startSec: 0,
      endSec: 10,
    });

    expect(result.id).toBe('short-123');
    expect(achievementsService.recordShortUploaded).toHaveBeenCalledWith('admin-1', 1, {
      shortId: 'short-123',
      recordingId: 'rec-1',
    });
  });

  it('createFromHighlight() dispatches recordShortUploaded to achievements service', async () => {
    highlightsRepo.findOne.mockResolvedValueOnce({
      id: 'hl-1',
      recordingId: 'rec-1',
      button_click_timestamp: new Date('2026-09-11T10:00:10Z'),
    } as any);

    flickRepo.findOne.mockResolvedValueOnce(null);

    recordingRepo.findOne.mockResolvedValueOnce({
      id: 'rec-1',
      userId: 'user-1',
      startTime: new Date('2026-09-11T10:00:00Z'),
      mux_playback_id: 'mux-1',
      turf: { sports_supported: ['padel'], name: 'Padel Arena' },
    } as any);

    const result = await service.createFromHighlight('user-1', 'hl-1', {
      title: 'Great Smashing Shot',
      topText: 'Smash',
      bottomText: 'Win',
      preRollSec: 5,
    });

    expect(result.id).toBe('short-123');
    expect(achievementsService.recordShortUploaded).toHaveBeenCalledWith('user-1', 1, {
      shortId: 'short-123',
      recordingId: 'rec-1',
    });
  });

  it('addLike() dispatches recordShortLiked to achievements service with current total likes', async () => {
    flickRepo.findOne.mockResolvedValueOnce({
      id: 'short-1',
      approved: true,
      createdByUserId: 'creator-1',
      likedUserIds: [],
      likesCount: 0,
      viewsCount: 10,
      sharesCount: 2,
      comments: [],
      createdAt: new Date(),
    } as any);

    const result = await service.addLike('viewer-1', 'short-1');

    expect(result.likesCount).toBe(1);
    expect(achievementsService.recordShortLiked).toHaveBeenCalledWith('creator-1', 1, {
      shortId: 'short-1',
    });
  });

  it('addShare() increments sharesCount and dispatches recordShortShared', async () => {
    flickRepo.findOne.mockResolvedValueOnce({
      id: 'short-1',
      approved: true,
      createdByUserId: 'creator-1',
      likedUserIds: [],
      likesCount: 5,
      viewsCount: 20,
      sharesCount: 24,
      comments: [],
      createdAt: new Date(),
    } as any);

    const result = await service.addShare('short-1', 'sharer-1');

    expect(result.sharesCount).toBe(25);
    expect(achievementsService.recordShortShared).toHaveBeenCalledWith('creator-1', 25, {
      shortId: 'short-1',
    });
  });

  it('addView() increments viewsCount and dispatches recordShortViewed', async () => {
    flickRepo.findOne.mockResolvedValueOnce({
      id: 'short-1',
      approved: true,
      createdByUserId: 'creator-1',
      likedUserIds: [],
      likesCount: 5,
      viewsCount: 9999,
      sharesCount: 10,
      comments: [],
      createdAt: new Date(),
    } as any);

    const result = await service.addView('short-1', 'viewer-1');

    expect(result.viewsCount).toBe(10000);
    expect(achievementsService.recordShortViewed).toHaveBeenCalledWith('creator-1', 10000, {
      shortId: 'short-1',
    });
  });
});
