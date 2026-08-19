#!/usr/bin/env ts-node

/**
 * One-time script to calculate and populate streak and accuracy stats for existing users.
 *
 * This script:
 * 1. Fetches all users who have recordings
 * 2. For each user, calculates:
 *    - Current streak (consecutive days with recordings)
 *    - Longest streak
 *    - Total sessions (recordings created)
 *    - Successful sessions (recordings that reached 'ready' status)
 *    - Accuracy percentage
 * 3. Updates user_points table with calculated values
 *
 * Run with: npx ts-node scripts/calculate-user-stats.ts
 */

import { DataSource } from 'typeorm';
import { UserPoints } from '../src/points/entities/user-points.entity';
import { Recording } from '../src/recording/entities/recording.entity';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'fieldflicks',
  entities: [UserPoints, Recording],
  synchronize: false,
});

/**
 * Calculate streak from activity dates
 */
function calculateStreaks(dates: Date[]): {
  current: number;
  longest: number;
  lastActivity: Date | null;
} {
  if (dates.length === 0) {
    return { current: 0, longest: 0, lastActivity: null };
  }

  // Sort dates in descending order (newest first)
  const sortedDates = dates.sort((a, b) => b.getTime() - a.getTime());

  // Get unique dates (YYYY-MM-DD)
  const uniqueDates = Array.from(
    new Set(sortedDates.map((d) => d.toISOString().split('T')[0])),
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  if (uniqueDates.length === 0) {
    return { current: 0, longest: 0, lastActivity: null };
  }

  const lastActivity = new Date(uniqueDates[0]);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  // Calculate current streak (must include today or yesterday)
  if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
    currentStreak = 1;
    let expectedDate = new Date(uniqueDates[0]);

    for (let i = 1; i < uniqueDates.length; i++) {
      expectedDate = new Date(expectedDate.getTime() - 24 * 60 * 60 * 1000);
      const expectedDateStr = expectedDate.toISOString().split('T')[0];

      if (uniqueDates[i] === expectedDateStr) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Calculate longest streak
  tempStreak = 1;
  let prevDate = new Date(uniqueDates[0]);

  for (let i = 1; i < uniqueDates.length; i++) {
    const currDate = new Date(uniqueDates[i]);
    const dayDiff = Math.floor(
      (prevDate.getTime() - currDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (dayDiff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
    prevDate = currDate;
  }
  longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

  return { current: currentStreak, longest: longestStreak, lastActivity };
}

async function main() {
  console.log('🚀 Starting user stats calculation...\n');

  try {
    await AppDataSource.initialize();
    console.log('✅ Database connection established\n');

    const recordingRepo = AppDataSource.getRepository(Recording);
    const userPointsRepo = AppDataSource.getRepository(UserPoints);

    // Get all users who have recordings
    const usersWithRecordings = await recordingRepo
      .createQueryBuilder('r')
      .select('DISTINCT r.userId', 'userId')
      .where('r.userId IS NOT NULL')
      .getRawMany<{ userId: string }>();

    console.log(
      `📊 Found ${usersWithRecordings.length} users with recordings\n`,
    );

    let processed = 0;
    let errors = 0;

    for (const { userId } of usersWithRecordings) {
      try {
        // Get all recordings for this user
        const recordings = await recordingRepo.find({
          where: { userId },
          order: { startTime: 'DESC' },
        });

        const totalSessions = recordings.length;
        const successfulSessions = recordings.filter(
          (r) => r.status === 'ready',
        ).length;
        const accuracyPercent =
          totalSessions > 0 ? (successfulSessions / totalSessions) * 100 : 0;

        // Calculate streaks from recording dates
        const activityDates = recordings.map((r) => new Date(r.startTime));
        const { current, longest, lastActivity } =
          calculateStreaks(activityDates);

        // Upsert user_points record
        let userPoints = await userPointsRepo.findOne({ where: { userId } });

        if (!userPoints) {
          userPoints = userPointsRepo.create({
            userId,
            totalPoints: 0,
            currentStreak: current,
            longestStreak: longest,
            lastActivityDate: lastActivity,
            totalSessions,
            successfulSessions,
            accuracyPercent,
          });
        } else {
          userPoints.currentStreak = current;
          userPoints.longestStreak = longest;
          userPoints.lastActivityDate = lastActivity;
          userPoints.totalSessions = totalSessions;
          userPoints.successfulSessions = successfulSessions;
          userPoints.accuracyPercent = accuracyPercent;
        }

        await userPointsRepo.save(userPoints);

        processed++;
        console.log(
          `✅ User ${userId.slice(0, 8)}... - Streak: ${current}/${longest}, Accuracy: ${accuracyPercent.toFixed(1)}%, Sessions: ${totalSessions}`,
        );
      } catch (err) {
        errors++;
        console.error(
          `❌ Error processing user ${userId}: ${(err as Error).message}`,
        );
      }
    }

    console.log(`\n🎉 Completed!`);
    console.log(`   Processed: ${processed} users`);
    console.log(`   Errors: ${errors}`);
  } catch (err) {
    console.error('❌ Fatal error:', (err as Error).message);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
    console.log('\n👋 Database connection closed');
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
