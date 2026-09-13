import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { PointsService } from 'src/points/points.service';
import { PaymentService } from 'src/payment/payment.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let paymentServiceMock: any;
  let recordingRepoMock: any;
  let userRepoMock: any;
  let turfRepoMock: any;
  let pointsServiceMock: any;

  beforeEach(async () => {
    paymentServiceMock = {
      getUnlockedRecordingIdsForUser: jest
        .fn()
        .mockResolvedValue(['rec-1', 'rec-2', 'rec-3']),
    };

    recordingRepoMock = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'rec-1',
          status: 'ready',
          mux_playback_id: 'mux-1',
          turfId: 'turf-1',
          startTime: new Date('2026-09-10T10:00:00Z'),
          metadata: { extract_session_key: 'session-A' },
        },
        // Sibling camera for session-A (multi-angle dual camera)
        {
          id: 'rec-2',
          status: 'ready',
          mux_playback_id: 'mux-2',
          turfId: 'turf-1',
          startTime: new Date('2026-09-10T10:00:00Z'),
          metadata: { extract_session_key: 'session-A' },
        },
        // Unfinished/failed recording
        {
          id: 'rec-3',
          status: 'failed',
          mux_playback_id: null,
          turfId: 'turf-2',
          startTime: new Date('2026-09-11T12:00:00Z'),
        },
      ]),
      count: jest.fn().mockResolvedValue(3),
    };

    userRepoMock = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        name: 'Ajay Bade',
        profile_image_path: 'https://example.com/avatar.jpg',
        city: 'Mumbai',
      }),
    };

    turfRepoMock = {
      find: jest.fn().mockResolvedValue([]),
    };

    pointsServiceMock = {
      getMyTotals: jest.fn().mockResolvedValue({
        totalPoints: 600,
        perEvent: [],
        level: 3,
        levelName: 'Pro',
        nextLevelPoints: 1000,
        levelProgress: 60,
      }),
      getStreakAndAccuracy: jest.fn().mockResolvedValue({
        currentStreak: 4,
        longestStreak: 7,
        accuracy: 85,
        totalSessions: 1,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepoMock,
        },
        {
          provide: getRepositoryToken(Recording),
          useValue: recordingRepoMock,
        },
        {
          provide: getRepositoryToken(TurfEntity),
          useValue: turfRepoMock,
        },
        {
          provide: PointsService,
          useValue: pointsServiceMock,
        },
        {
          provide: PaymentService,
          useValue: paymentServiceMock,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserPaidRecordings', () => {
    it('should only return ready/playable recordings that are paid/unlocked', async () => {
      const recordings = await service.getUserPaidRecordings('user-1');
      expect(
        paymentServiceMock.getUnlockedRecordingIdsForUser,
      ).toHaveBeenCalledWith('user-1');
      // rec-3 is failed without playback ID, so only rec-1 and rec-2 should be returned
      expect(recordings.length).toBe(2);
      expect(recordings.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    });

    it('should return empty array if user has no unlocked recordings', async () => {
      paymentServiceMock.getUnlockedRecordingIdsForUser.mockResolvedValueOnce(
        [],
      );
      const recordings = await service.getUserPaidRecordings('user-1');
      expect(recordings).toEqual([]);
      expect(recordingRepoMock.find).not.toHaveBeenCalled();
    });
  });

  describe('getDistinctMatchSessions', () => {
    it('should collapse multi-camera recordings of the same session into 1 session', () => {
      const recordings: any[] = [
        {
          id: 'rec-1',
          turfId: 'turf-1',
          startTime: new Date('2026-09-10T10:00:00Z'),
          metadata: { extract_session_key: 'session-A' },
        },
        {
          id: 'rec-2',
          turfId: 'turf-1',
          startTime: new Date('2026-09-10T10:00:00Z'),
          metadata: { extract_session_key: 'session-A' },
        },
        {
          id: 'rec-4',
          turfId: 'turf-1',
          startTime: new Date('2026-09-12T14:00:00Z'),
          metadata: { extract_session_key: 'session-B' },
        },
      ];

      const distinct = service.getDistinctMatchSessions(recordings);
      expect(distinct.length).toBe(2);
      expect(distinct.map((s) => s.id)).toEqual(['rec-1', 'rec-4']);
    });
  });

  describe('getHomeDashboard', () => {
    it('should return accurate session count and real streak stats', async () => {
      const dashboard = await service.getHomeDashboard('user-1');
      // 2 ready recordings belonging to 1 distinct match session
      expect(dashboard.weeklySnapshot.totalSessions).toBe(1);
      expect(dashboard.weeklySnapshot.streakDays).toBe(4);
      expect(dashboard.weeklySnapshot.accuracyPercent).toBe(85);
      expect(dashboard.weeklySnapshot.xpEarned).toBe(600);
    });
  });

  describe('getAnalytics', () => {
    it('should distribute sessions across days without dumping everything into Sunday', async () => {
      const analytics = await service.getAnalytics('user-1');
      expect(analytics.overview.totalSessions).toBe(1);
      expect(analytics.overview.avgAccuracy).toBe(85);
      expect(analytics.weeklyStats.length).toBe(7);

      // Verify that Sunday is not receiving an artificial dump of lifetime sessions
      const sundayStat = analytics.weeklyStats.find((d) => d.day === 'Sun');
      expect(sundayStat).toBeDefined();
    });
  });
});
