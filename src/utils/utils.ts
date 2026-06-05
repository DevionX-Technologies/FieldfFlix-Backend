import { jwtDecode } from 'jwt-decode';
import { UnauthorizedException } from '@nestjs/common';
import {
  HALF_HOUR_SEC,
  recordingUnlockBaseInr,
  recordingUnlockTotalInr,
  parsePlannedDurationSecFromMetadata,
  type RecordingUnlockSport,
} from 'src/utils/recording-pricing';

export function extractDataFromToken(token: string): any {
  try {
    const decoded_token = jwtDecode(token);

    return decoded_token;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedException('Token has expired');
    }
    throw new UnauthorizedException('Invalid token');
  }
}

/**
 * Converts a UTC timestamp to Indian Standard Time (IST)
 * IST is UTC+05:30
 *
 * @param utcTimestamp UTC timestamp (can be Date, string, or number)
 * @returns Date object in IST timezone
 */
export function convertToIST(utcTimestamp: Date | string | number): Date {
  const utcDate = new Date(utcTimestamp);

  // Add 5 hours and 30 minutes (330 minutes) to UTC to get IST
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istDate = new Date(utcDate.getTime() + istOffset);

  return istDate;
}

/**
 * Converts a timestamp to IST and formats it for logging
 *
 * @param timestamp UTC timestamp
 * @returns Formatted IST time string
 */
export function formatToISTString(timestamp: Date | string | number): string {
  const istDate = convertToIST(timestamp);
  return istDate.toISOString().replace('Z', '+05:30');
}

/**
 * Gets the current time in IST
 *
 * @returns Date object representing current time in IST
 */
export function getCurrentIST(): Date {
  return convertToIST(new Date());
}

export function parseRelativeTimestampToSeconds(
  relativeTimestamp: string,
): number {
  const parts = relativeTimestamp.split(':');

  if (parts.length === 2) {
    // MM:SS format
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    return hours * 3600 + minutes * 60 + seconds;
  } else {
    throw new Error(`Invalid relative timestamp format: ${relativeTimestamp}`);
  }
}

export function calculatePaymentAmountFromDuration(
  durationInSeconds: number,
  tier: RecordingUnlockSport = 'pickleball',
): number {
  return recordingUnlockTotalInr(
    recordingUnlockBaseInr(tier, durationInSeconds),
  );
}

/** Pre-tax unlock base from recording metadata (sport + planned timer). */
export function recordingUnlockBaseFromRecording(
  metadata: unknown,
  tier: RecordingUnlockSport,
): number {
  const plannedSec =
    parsePlannedDurationSecFromMetadata(metadata) ?? HALF_HOUR_SEC;
  return recordingUnlockBaseInr(tier, plannedSec);
}

/**
 * Converts seconds to HH:MM:SS.ss format with 2 decimal places for seconds
 */
export function formatDurationToHHMMSS(durationInSeconds: number): string {
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = durationInSeconds % 60;

  // Format seconds with 2 decimal places
  const formattedSeconds = seconds.toFixed(2);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${formattedSeconds}`;
}
