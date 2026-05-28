import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private static readonly VERSION = '1.7';
  /** Captured once when the process boots — represents container start time. */
  private static readonly BOOTED_AT = new Date().toISOString();

  /**
   * Health-check string surfaced at `GET /`.
   *
   * Includes build provenance baked into the Docker image at CI time:
   *   - BUILD_SHA  : full commit hash that produced this image
   *   - BUILD_TIME : ISO-8601 UTC timestamp when the image was built
   *   - BUILD_REF  : branch / tag name (e.g. `main`)
   *
   * Anyone can hit the base URL and instantly know which commit + build time
   * is actually live in ECS — useful for verifying a CI/CD push went through.
   */
  getHello(): string {
    const sha = String(process.env.BUILD_SHA ?? 'unknown');
    const shortSha = sha === 'unknown' ? 'unknown' : sha.slice(0, 7);
    const buildTime = String(process.env.BUILD_TIME ?? 'unknown');
    const ref = String(process.env.BUILD_REF ?? 'unknown');
    return [
      'FieldFlicks backend update is live — timestamp alignment fixed and Find My Recording uses strict date/time (+/-1h) and phone filters.',
      `version=${AppService.VERSION}`,
      `sha=${shortSha}`,
      `built=${buildTime}`,
      `ref=${ref}`,
      `booted=${AppService.BOOTED_AT}`,
    ].join(' | ');
  }
}
