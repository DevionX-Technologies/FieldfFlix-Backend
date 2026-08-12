# Backend Stats Implementation

## Overview
Added streak and accuracy tracking to the FieldFlicks backend to support leaderboard and analytics features.

## Database Changes

### Migration: `1763100000000-AddStreakAndAccuracyToUserPoints.ts`

Added columns to `user_points` table:

```sql
-- Streak tracking
current_streak INTEGER DEFAULT 0
longest_streak INTEGER DEFAULT 0
last_activity_date DATE NULL

-- Accuracy tracking
total_sessions INTEGER DEFAULT 0
successful_sessions INTEGER DEFAULT 0
accuracy_percent NUMERIC(5,2) DEFAULT 0
```

## Entity Updates

### `user-points.entity.ts`
Added properties:
- `currentStreak: number` - Current consecutive days streak
- `longestStreak: number` - Best streak achieved
- `lastActivityDate: Date | null` - Last activity date for streak calculation
- `totalSessions: number` - Total recording sessions
- `successfulSessions: number` - Successfully completed recordings
- `accuracyPercent: number` - Percentage of successful sessions

## Service Changes

### `PointsService` - New Methods

#### `updateStreak(userId: string): Promise<void>`
- Called when a user completes a recording
- Checks last activity date
- Increments streak if activity was yesterday
- Resets streak to 1 if gap > 1 day
- Updates longest streak if current exceeds it

#### `updateSessionStats(userId: string, wasSuccessful: boolean): Promise<void>`
- Tracks total sessions and successful completions
- Calculates accuracy percentage
- Called when recording status changes to 'ready'

#### `getStreakAndAccuracy(userId: string)`
Returns:
```typescript
{
  currentStreak: number;
  longestStreak: number;
  accuracy: number;
  totalSessions: number;
}
```

#### Updated `getLeaderboard()`
Now includes in response:
- `streak: number` - User's current streak
- `accuracy: number` - User's accuracy percentage

Query joins `user_points` table to fetch these values.

## Recording Service Updates

### `recording.service.ts`
Modified `awardPointsBestEffort()`:
- After awarding points for RECORDING_CREATE
- Calls `pointsService.updateStreak(userId)`
- Updates user's activity streak automatically

### `recording-highlight.service.ts`
Modified `handleAssetReady()`:
- When recording status → 'ready'
- Calls `pointsService.updateSessionStats(userId, true)`
- Tracks successful session completion

## Calculation Script

### `scripts/calculate-user-stats.ts`

One-time backfill script for existing users:

**What it does:**
1. Finds all users with recordings
2. For each user:
   - Counts total sessions
   - Counts successful sessions (status = 'ready')
   - Calculates accuracy percentage
   - Analyzes recording dates to calculate streaks
   - Updates or creates user_points record

**How to run:**
```bash
npx ts-node scripts/calculate-user-stats.ts
```

**Output example:**
```
✅ User abc123... - Streak: 5/12, Accuracy: 94.2%, Sessions: 17
```

## API Response Updates

### GET `/points/leaderboard`

**Before:**
```json
{
  "rows": [{
    "userId": "...",
    "rank": 1,
    "name": "John",
    "points": 150
  }]
}
```

**After:**
```json
{
  "rows": [{
    "userId": "...",
    "rank": 1,
    "name": "John",
    "points": 150,
    "streak": 7,
    "accuracy": 92.5
  }]
}
```

## Frontend Integration

### Updated `leaderboard.api.ts`
- Now maps backend `streak` and `accuracy` fields
- No longer returns null for these values
- Shows real calculated data

### LeaderboardUser Type
```typescript
{
  accuracy: number | null;  // Shows 0-100 or null
  streakDays: number | null; // Shows current streak or null
}
```

## Deployment Steps

1. **Run migration:**
   ```bash
   npm run migration:run
   ```

2. **Backfill existing data:**
   ```bash
   npx ts-node scripts/calculate-user-stats.ts
   ```

3. **Deploy backend code**
   - Recording service automatically tracks new sessions
   - Streak updates on every recording
   - Accuracy updates when video is ready

4. **Deploy frontend**
   - Leaderboard shows streak and accuracy
   - No code changes needed in UI components
   - Existing null checks handle missing data gracefully

## What Gets Tracked

### Streak Logic
- ✅ Activity = creating a recording
- ✅ Consecutive days maintain streak
- ✅ Miss 1 day = streak resets to 1
- ✅ Longest streak is preserved

### Accuracy Logic
- ✅ Total sessions = all recordings created
- ✅ Successful = recordings that reached 'ready' status
- ✅ Accuracy = (successful / total) × 100
- ❌ Does NOT track failed recordings that never made it to DB

## Monitoring

Check streak/accuracy data:
```sql
SELECT 
  u.name,
  up.current_streak,
  up.longest_streak,
  up.total_sessions,
  up.successful_sessions,
  up.accuracy_percent,
  up.last_activity_date
FROM user_points up
JOIN users u ON u.id = up."userId"
ORDER BY up.current_streak DESC
LIMIT 20;
```

## Future Enhancements

Potential additions:
- Track recording duration for "active minutes"
- Add weekly/monthly accuracy trends
- Streak freeze items (maintain streak when missing a day)
- Streak challenges and achievements
- Accuracy milestones (95%+ club)
