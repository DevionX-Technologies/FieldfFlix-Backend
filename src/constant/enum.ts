export enum Provider {
  Google = 'google',
  Local = 'local',
  Jwt = 'jwt',
}
export enum MessageStatus {
  READ = 'read',
  UNREAD = 'unread',
}

export enum NotificationType {
  RECORDING_START = 'RECORDING_START',
  RECORDING_STOP = 'RECORDING_STOP',
  RECORDING_COMPLETE = 'RECORDING_COMPLETE',
  WELCOME_MESSAGE = 'WELCOME_MESSAGE',
  /** Gamification — fired every time PointsService awards points. The FCM
   *  data payload carries `points`, `eventType`, `totalPoints`, and `label`
   *  so the mobile app can render a celebration toast and refresh the
   *  Profile points pill without a refetch. */
  POINTS_AWARDED = 'POINTS_AWARDED',
}
