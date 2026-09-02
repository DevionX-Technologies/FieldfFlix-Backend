import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { PointsService } from 'src/points/points.service';

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
  ) {}

  async getHomeDashboard(userId: string) {
    // 1. Get user profile for greeting
    const user = await this.userRepo.findOne({ where: { id: userId } });

    // 2. Total Sessions (Count of recordings for this user)
    const totalSessions = await this.recordingRepo.count({
      where: { user: { id: userId } }, // assuming user relation is set
    });

    // 3. XP / Streaks / Level
    const pointsData = await this.pointsService.getMyTotals(userId);

    // 4. Fetch recommended courts (random or top rated)
    const recommendedCourts = await this.turfRepo.find({
      take: 2, // just grab 2 for now
    });

    return {
      greeting: {
        greeting: 'Hello',
        userName: user?.name?.split(' ')[0] || 'Player',
        avatarUrl: user?.profile_image_path || '',
        location: user?.city || 'Local',
        hasUnreadNotifications: false, // Could integrate NotificationService later
      },
      weeklySnapshot: {
        improvingPercent: 0, // Mocked/Omitted
        totalSessions,
        accuracyPercent: 0, // Mocked/Omitted
        streakDays: 0, // Mocked/Omitted
        weeklyGoalCompleted: 0,
        weeklyGoalTotal: 0,
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
    const totalSessions = await this.recordingRepo.count({
      where: { user: { id: userId } },
    });

    const pointsData = await this.pointsService.getMyTotals(userId);

    // Provide a skeleton that matches the frontend's OverallAnalyticsData
    return {
      overview: {
        totalSessions,
        winRate: 0,
        avgAccuracy: 0,
        xpEarned: pointsData.totalPoints,
      },
      weeklyStats: [
        { day: 'Mon', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        { day: 'Tue', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        { day: 'Wed', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        { day: 'Thu', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        { day: 'Fri', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        { day: 'Sat', sessionsCount: 0, accuracy: 0, xpEarned: 0 },
        {
          day: 'Sun',
          sessionsCount: totalSessions,
          accuracy: 0,
          xpEarned: pointsData.totalPoints,
        }, // Dump everything into today for demo
      ],
      recentAchievements: [],
      userGoals: [],
      skillMetrics: null, // unsupported
      matchAnalytics: null, // unsupported
      trainingStats: {
        sessions: totalSessions,
        totalHours: Math.floor(totalSessions * 1.5), // guess 1.5hrs per session
        avgDurationMin: 90,
        caloriesBurned: totalSessions * 500,
        consistencyScore: 50,
        currentStreak: 0,
        longestStreak: 0,
        mostActiveDay: 'Sunday',
      },
      coachRecommendations: [],
      insights: [
        {
          id: '1',
          text: `You've completed ${totalSessions} sessions so far.`,
          type: 'neutral',
        },
      ],
    };
  }
}
