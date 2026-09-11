# 🏆 FieldFlicks Achievement Engine — REST API Documentation

**Authoritative Specification & Reference Guide**  
**Base URL:** `/api/v1/achievements` (also mounted at `/achievements`)  
**Authentication:** Bearer JWT Token (`Authorization: Bearer <jwt_access_token>`)

---

## 1. Overview & Architecture

The FieldFlicks Achievement Engine powers gamification, player progression, and milestone rewards across athletic, creator, social, special, and tier categories.

### Key Architectural Pillars

1. **Deterministic State Machine:** Every user-achievement pair follows a 4-state Finite State Machine:
   $$\text{LOCKED} \xrightarrow{\text{telemetry}} \text{IN\_PROGRESS} \xrightarrow{\text{threshold}} \text{UNLOCKED} \xrightarrow{\text{claim}} \text{CLAIMED}$$
2. **Monotonic Forward Progression (Non-Regression):** Completed (`UNLOCKED` / `CLAIMED`) milestones cannot regress even if underlying telemetry metrics decrease (e.g. broken daily streaks or deleted content).
3. **Idempotent Rewards & Row-Level Locking:** Claiming XP rewards executes within an atomic database transaction with `SELECT FOR UPDATE` row locking to prevent duplicate claims and racing requests.
4. **Redis-Backed Metrics Buffer:** High-frequency activity (views, likes, rapid increments) is buffered in Redis and reliably persisted to PostgreSQL without data loss.
5. **Decoupled Unlock Event Pipeline:** When milestones are met, `AchievementUnlockedEvent` is published, triggering push notifications (FCM) and modal payloads for mobile clients.

---

## 2. API Endpoints Reference

### 2.1 Get Unified Achievement Catalogue & Progress

Retrieves the complete achievement catalog for the authenticated user, complete with normalized progress calculations, FSM status, XP rewards, and summary statistics.

- **HTTP Method:** `GET`
- **Path:** `/api/v1/achievements`
- **Auth Required:** Yes (`Bearer <token>`)

#### Query Parameters

| Parameter  | Type     | Required | Description                                                                  | Example    |
| :--------- | :------- | :------- | :--------------------------------------------------------------------------- | :--------- |
| `category` | `string` | No       | Filter by category (`athlete`, `creator`, `social`, `special`, `level_tier`) | `athlete`  |
| `status`   | `string` | No       | Filter by FSM status (`LOCKED`, `IN_PROGRESS`, `UNLOCKED`, `CLAIMED`)        | `UNLOCKED` |

#### Request Example

```http
GET /api/v1/achievements?category=athlete HTTP/1.1
Host: api.fieldflicks.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Response Example (`200 OK`)

```json
{
  "summary": {
    "totalAchievements": 46,
    "unlockedCount": 3,
    "inProgressCount": 8,
    "lockedCount": 35,
    "totalXpEarned": 1450,
    "unclaimedRewardsCount": 2,
    "currentLevel": 4,
    "currentLevelName": "Pro",
    "nextLevelPoints": 100,
    "levelProgress": 0.85
  },
  "achievements": [
    {
      "id": "ATH_TURF_DEBUT",
      "category": "athlete",
      "tier": "bronze",
      "title": "Turf Debut",
      "description": "Play and complete your first match on a FieldFlicks enabled turf.",
      "requirementText": "Play 1 Match",
      "metricKey": "matches_played",
      "currentProgress": 1,
      "targetValue": 1,
      "progressPercent": 100,
      "progressText": "1 / 1 Match",
      "status": "CLAIMED",
      "xpReward": 100,
      "rewardValue": "+100 XP",
      "isCompleted": true,
      "isRewardClaimed": true,
      "badgeAssetKey": "bronze-picklebat.png",
      "badgeUrl": "bronze-picklebat.png",
      "completedAt": "2026-09-01T10:00:00.000Z",
      "claimedAt": "2026-09-01T10:05:00.000Z"
    },
    {
      "id": "ATH_REGULAR_STARTER",
      "category": "athlete",
      "tier": "silver",
      "title": "Regular Starter",
      "description": "Consistency is key. Play 10 recorded matches.",
      "requirementText": "Play 10 Matches",
      "metricKey": "matches_played",
      "currentProgress": 10,
      "targetValue": 10,
      "progressPercent": 100,
      "progressText": "10 / 10 Matches",
      "status": "UNLOCKED",
      "xpReward": 300,
      "rewardValue": "+300 XP",
      "isCompleted": true,
      "isRewardClaimed": false,
      "badgeAssetKey": "silver-picklebat.png",
      "badgeUrl": "silver-picklebat.png",
      "completedAt": "2026-09-09T08:30:00.000Z",
      "claimedAt": null
    },
    {
      "id": "ATH_CENTURION",
      "category": "athlete",
      "tier": "gold",
      "title": "Centurion",
      "description": "Become a court veteran by recording 50 full matches.",
      "requirementText": "Play 50 Matches",
      "metricKey": "matches_played",
      "currentProgress": 10,
      "targetValue": 50,
      "progressPercent": 20,
      "progressText": "10 / 50 Matches",
      "status": "IN_PROGRESS",
      "xpReward": 1000,
      "rewardValue": "+1,000 XP",
      "isCompleted": false,
      "isRewardClaimed": false,
      "badgeAssetKey": "gold-picklebat.png",
      "badgeUrl": "gold-picklebat.png",
      "completedAt": null,
      "claimedAt": null
    }
  ]
}
```

---

### 2.2 Claim Achievement XP Reward

Validates server-side that the achievement requirements have been satisfied, atomically credits XP reward points to the player's account, computes level-up progression, and prevents duplicate claims.

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/:id/claim`
- **Auth Required:** Yes (`Bearer <token>`)

#### URL Parameters

| Parameter | Type     | Required | Description                   | Example               |
| :-------- | :------- | :------- | :---------------------------- | :-------------------- |
| `id`      | `string` | Yes      | Unique Achievement identifier | `ATH_REGULAR_STARTER` |

#### Request Example

```http
POST /api/v1/achievements/ATH_REGULAR_STARTER/claim HTTP/1.1
Host: api.fieldflicks.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Response Example (`200 OK`)

```json
{
  "achievementId": "ATH_REGULAR_STARTER",
  "title": "Regular Starter",
  "xpAwarded": 300,
  "newTotalXp": 1750,
  "previousLevel": 4,
  "currentLevel": 5,
  "currentLevelName": "Legend",
  "levelUpOccurred": true,
  "claimedAt": "2026-09-09T11:45:00.000Z"
}
```

#### Error Responses

- **`400 Bad Request`**: Milestone requirements not completed yet.
  ```json
  {
    "statusCode": 400,
    "message": "Achievement 'Regular Starter' requirements have not been completed (4/10)",
    "error": "Bad Request"
  }
  ```
- **`404 Not Found`**: Achievement ID does not exist in catalog.
  ```json
  {
    "statusCode": 404,
    "message": "Achievement 'ATH_UNKNOWN' does not exist in the catalog",
    "error": "Not Found"
  }
  ```
- **`409 Conflict`**: Reward already claimed.
  ```json
  {
    "statusCode": 409,
    "message": "Achievement reward for 'Regular Starter' has already been claimed",
    "error": "Conflict"
  }
  ```

---

### 2.3 Record Match Participation Event

Connects match participation events to Athlete match-count achievements (`ATH_TURF_DEBUT`, `ATH_REGULAR_STARTER`, `ATH_CENTURION`).

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/events/match`
- **Auth Required:** Yes (`Bearer <token>`)

#### Request Body

```json
{
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "matchId": "rec_987654321",
  "matchesCount": 1,
  "sport": "Football",
  "turfId": "turf_01"
}
```

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "totalMatchesPlayed": 10,
  "unlockedAchievements": ["ATH_REGULAR_STARTER"]
}
```

---

### 2.4 Record Goal Scoring Event

Connects goal-scoring telemetry to offensive achievements (`ATH_SHARP_SHOOTER`, `ATH_GOAL_MACHINE`).

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/events/goal`
- **Auth Required:** Yes (`Bearer <token>`)

#### Request Body

```json
{
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "goalsCount": 2,
  "matchId": "rec_987654321",
  "highlightId": "hl_54321"
}
```

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "totalGoalsScored": 25,
  "unlockedAchievements": ["ATH_SHARP_SHOOTER"]
}
```

---

### 2.5 Record MVP Award Event

Connects MVP results to `ATH_MVP` (5 MVPs) and `ATH_TURF_LEGEND` (25 MVPs) milestones.

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/events/mvp`
- **Auth Required:** Yes (`Bearer <token>`)

#### Request Body

```json
{
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "count": 1,
  "matchId": "rec_987654321",
  "tournamentId": "tourn_01"
}
```

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "totalMvpMatchesCount": 5,
  "unlockedAchievements": ["ATH_MVP"]
}
```

---

### 2.6 Record Match Streak Updates

Connects win streak and daily activity streak information to `ATH_CONSISTENT_PLAYER` (10-day streak), `SPC_7_DAY_STREAK`, `SPC_30_DAY_STREAK`, `SPC_HOT_STREAK` (15-win streak), and `SPC_PERFECT_RUN` (60 days).

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/events/streak`
- **Auth Required:** Yes (`Bearer <token>`)

#### Request Body

```json
{
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "streakDays": 10,
  "matchWinStreak": 15
}
```

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "streakDays": 10,
  "matchWinStreak": 15,
  "unlockedAchievements": ["ATH_CONSISTENT_PLAYER", "SPC_HOT_STREAK"]
}
```

---

### 2.7 Ingest General Telemetry Metric

Supports direct or Redis-buffered metric increments and peak updates across creator, social, and special categories.

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/events/telemetry`
- **Auth Required:** Yes (`Bearer <token>`)

#### Request Body

```json
{
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "metricKey": "flickshorts_uploaded_count",
  "incrementBy": 1
}
```

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "userId": "d3b07384-d113-4a44-8d9e-0123456789ab",
  "metricKey": "flickshorts_uploaded_count",
  "currentMetricValue": 10,
  "unlockedAchievements": ["CRE_HIGHLIGHT_REEL"]
}
```

---

### 2.8 Flush Redis Metrics Buffer

Immediately drains the Redis/in-memory metrics buffer and persists all pending increments and peaks to PostgreSQL.

- **HTTP Method:** `POST`
- **Path:** `/api/v1/achievements/buffer/flush`
- **Auth Required:** Yes (`Bearer <token>`)

#### Response Example (`200 OK`)

```json
{
  "success": true,
  "flushedUsersCount": 14,
  "stats": {
    "isRedisConnected": true,
    "pendingMemoryUsers": 0,
    "isFlushing": false
  }
}
```

---

## 3. Business Rules & Security Guarantees

1. **State Transition Rules:**
   - Achievements start at `LOCKED`.
   - Any progress $(0 < \text{progress} < \text{target})$ moves to `IN_PROGRESS`.
   - Reaching threshold $(\text{progress} \ge \text{target})$ moves to `UNLOCKED` and dispatches `AchievementUnlockedEvent`.
   - Claiming via `/claim` validates server-side and moves to `CLAIMED`.
2. **Pessimistic Row Locking (`SELECT FOR UPDATE`):**
   - Eliminates race conditions on concurrent claims.
   - Second simultaneous claim attempt immediately receives `409 Conflict`.
3. **Monotonic Progression Guarantee:**
   - `UserAchievement.currentProgress` is computed using `GREATEST(storedProgress, telemetryValue)`.
   - Dropping streaks or deleting media never demotes an `UNLOCKED` or `CLAIMED` achievement.
4. **Normalized Progress Presentation:**
   - Server calculates clamped percentage: `progressPercent = Math.min(100, Math.floor((current / target) * 100))`.
   - Formatted human-readable text is provided directly by server (`12 / 50 Matches`, `Level 4 / 5`).
5. **Unlock Event Notification Pipeline:**
   - Handled asynchronously via `@OnEvent('achievement.unlocked')`.
   - Automatically sends Firebase Cloud Messaging (FCM) pushes to all registered user device tokens.
   - Stores in-app notification row in `notifications` table for modal & notification tray rendering.
