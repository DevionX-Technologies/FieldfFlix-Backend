import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { PointsService } from 'src/points/points.service';
import { PaymentService } from 'src/payment/payment.service';

export interface DistinctMatchSession {
  id: string;
  turfId: string | null;
  startTime: Date;
  recording: Recording;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(TurfEntity)
    private readonly turfRepo: Repository<TurfEntity>,
    private readonly pointsService: PointsService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Sessions definition:
   * Number of match videos of the game the user paid for and has access to.
   * - Must be paid/unlocked (either user paid, or group unlocked for the circle/recording)
   * - Must be ready/completed (playable video)
   * - Deduplicated across multi-camera setups (e.g. 2 NVR channels for 1 game session count as 1 match session)
   */
  async getUserPaidRecordings(userId: string): Promise<Recording[]> {
    try {
      const unlockedIds =
        await this.paymentService.getUnlockedRecordingIdsForUser(userId);
      if (!unlockedIds || unlockedIds.length === 0) {
        return [];
      }

      const recordings = await this.recordingRepo.find({
        where: { id: In(unlockedIds) },
        order: { startTime: 'DESC' },
      });

      return recordings.filter(
        (r) =>
          r.status === 'ready' ||
          r.status === 'completed' ||
          Boolean(r.mux_playback_id),
      );
    } catch (error) {
      this.logger.error('Failed to get user paid recordings', error);
      return [];
    }
  }

  /**
   * Group multi-channel recordings into distinct match sessions.
   */
  getDistinctMatchSessions(recordings: Recording[]): DistinctMatchSession[] {
    const sessionMap = new Map<string, DistinctMatchSession>();

    for (const r of recordings) {
      const sessionKey = r.metadata?.extract_session_key?.toString().trim();
      let key = '';
      if (sessionKey) {
        key = `session:${sessionKey}`;
      } else if (r.turfId && r.startTime) {
        const startMin = Math.floor(new Date(r.startTime).getTime() / 60000);
        key = `turf:${r.turfId}:${startMin}`;
      } else {
        key = `rec:${r.id}`;
      }

      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          id: r.id,
          turfId: r.turfId ?? null,
          startTime: new Date(r.startTime || r.updated_at || Date.now()),
          recording: r,
        });
      }
    }

    return Array.from(sessionMap.values());
  }

  private getStartOfWeekMonday(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 is Sun, 1 is Mon...
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
  }

  async getHomeDashboard(userId: string) {
    // 1. Get user profile for greeting
    const user = await this.userRepo.findOne({ where: { id: userId } });

    // 2. Total Sessions (Distinct paid & ready match sessions)
    const paidRecordings = await this.getUserPaidRecordings(userId);
    const distinctSessions = this.getDistinctMatchSessions(paidRecordings);
    const totalSessions = distinctSessions.length;

    // 3. XP / Streaks / Accuracy
    const [pointsData, streakData] = await Promise.all([
      this.pointsService.getMyTotals(userId),
      this.pointsService.getStreakAndAccuracy(userId),
    ]);

    // 4. Current week vs previous week calculations
    const now = new Date();
    const monday = this.getStartOfWeekMonday(now);
    const sundayEnd = new Date(monday);
    sundayEnd.setDate(monday.getDate() + 6);
    sundayEnd.setHours(23, 59, 59, 999);

    const prevMonday = new Date(monday);
    prevMonday.setDate(monday.getDate() - 7);
    const prevSundayEnd = new Date(monday);
    prevSundayEnd.setMilliseconds(-1);

    const thisWeekSessions = distinctSessions.filter(
      (s) => s.startTime >= monday && s.startTime <= sundayEnd,
    );
    const prevWeekSessions = distinctSessions.filter(
      (s) => s.startTime >= prevMonday && s.startTime <= prevSundayEnd,
    );

    let improvingPercent = 0;
    if (prevWeekSessions.length > 0) {
      improvingPercent = Math.max(
        0,
        Math.round(
          ((thisWeekSessions.length - prevWeekSessions.length) /
            prevWeekSessions.length) *
            100,
        ),
      );
    } else if (thisWeekSessions.length > 0) {
      improvingPercent = 100;
    }

    // 5. Fetch recommended courts
    const recommendedCourts = await this.turfRepo.find({
      take: 2,
    });

    return {
      greeting: {
        greeting: 'Hello',
        userName: user?.name?.split(' ')[0] || 'Player',
        avatarUrl: user?.profile_image_path || '',
        location: user?.city || 'Local',
        hasUnreadNotifications: false,
      },
      weeklySnapshot: {
        improvingPercent,
        totalSessions,
        accuracyPercent: streakData.accuracy,
        streakDays: streakData.currentStreak,
        weeklyGoalCompleted: thisWeekSessions.length,
        weeklyGoalTotal: 5,
        xpEarned: pointsData.totalPoints,
        circleAvatars: [],
        circleMoreCount: 0,
      },
      recommendedCourts: recommendedCourts.map((t) => ({
        id: t.id,
        name: t.name,
        location: t.address_line || t.location || 'Unknown',
        distance: 'Local',
        rating: 4.5,
        availableCourts: 1,
        imageUrl:
          'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=800&q=80',
        pricePerHour: t.hourly_rate || 0,
      })),
    };
  }

  async getAnalytics(userId: string) {
    const paidRecordings = await this.getUserPaidRecordings(userId);
    const distinctSessions = this.getDistinctMatchSessions(paidRecordings);
    const totalSessions = distinctSessions.length;

    const [pointsData, streakData] = await Promise.all([
      this.pointsService.getMyTotals(userId),
      this.pointsService.getStreakAndAccuracy(userId),
    ]);

    const now = new Date();
    const monday = this.getStartOfWeekMonday(now);
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let maxDay = '—';
    let maxSessions = 0;

    const weeklyStats = dayLabels.map((dayLabel, index) => {
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + index);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const daySessions = distinctSessions.filter(
        (s) => s.startTime >= dayStart && s.startTime <= dayEnd,
      );

      if (daySessions.length > maxSessions) {
        maxSessions = daySessions.length;
        maxDay = dayLabel;
      }

      return {
        day: dayLabel,
        sessionsCount: daySessions.length,
        accuracy: daySessions.length > 0 ? streakData.accuracy || 80 : 0,
        xpEarned: daySessions.length * 150,
      };
    });

    return {
      overview: {
        totalSessions,
        winRate: totalSessions > 0 ? 75 : 0,
        avgAccuracy: streakData.accuracy,
        xpEarned: pointsData.totalPoints,
      },
      weeklyStats,
      recentAchievements: [],
      userGoals: [],
      skillMetrics: null,
      matchAnalytics: null,
      trainingStats: {
        sessions: totalSessions,
        totalHours: Math.round(totalSessions * 1.5 * 10) / 10,
        avgDurationMin: 90,
        caloriesBurned: totalSessions * 500,
        consistencyScore: Math.min(
          100,
          Math.max(0, streakData.currentStreak * 20),
        ),
        currentStreak: streakData.currentStreak,
        longestStreak: streakData.longestStreak,
        mostActiveDay: maxDay !== '—' ? maxDay : 'Sunday',
      },
      coachRecommendations: [],
      insights: [
        {
          id: '1',
          text: `You've completed ${totalSessions} paid session${totalSessions === 1 ? '' : 's'} so far.`,
          type: 'neutral',
        },
      ],
    };
  }
}
