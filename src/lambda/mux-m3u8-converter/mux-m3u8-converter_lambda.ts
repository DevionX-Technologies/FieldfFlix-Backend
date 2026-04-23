import { Context } from 'aws-lambda';
import { S3Service } from './services/s3.service';
import {
  M3u8ConversionRequest,
  M3u8ConversionResponse,
} from './interfaces/converter.interface';
import { LambdaHandler, LambdaErrorResponse } from './types/lambda.types';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as crypto from 'crypto';
const execAsync = promisify(exec);

type Quality = 'low' | 'medium' | 'high';

type LocalizeResult = {
  localPlaylistPath: string;
  workDir: string;
};

export class M3u8ConverterHandler {
  private s3Service: S3Service;
  private ffmpegPath: string;

  constructor() {
    this.s3Service = new S3Service();
    this.ffmpegPath = '/opt/bin/ffmpeg';
  }

  async handle(
    event: M3u8ConversionRequest & {
      transcode?: boolean;
      forceLocalize?: boolean;
    },
    context: Context,
  ): Promise<M3u8ConversionResponse> {
    const startTime = Date.now();
    console.log('Lambda invoked with event:', {
      requestId: context.awsRequestId,
      m3u8Url: event.muxUrl,
      uploadS3Path: event.uploadS3Path,
      bucketName: event.bucketName,
      quality: event.quality || 'medium',
      transcode: !!event.transcode,
      forceLocalize: !!event.forceLocalize,
    });

    try {
      if (!event.muxUrl || !event.uploadS3Path || !event.bucketName) {
        return this.createErrorResponse(
          'Validation failed',
          'Missing required fields: muxUrl, uploadS3Path, or bucketName',
          context.awsRequestId,
        );
      }

      this.logEnvironment();

      const result = await this.processConversion(event, context.awsRequestId);

      console.log(`Total processing time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      console.error('Handler error:', error);
      return this.createErrorResponse(
        'Internal server error',
        error instanceof Error ? error.message : 'Unknown error',
        context.awsRequestId,
      );
    }
  }

  private async processConversion(
    request: M3u8ConversionRequest & {
      transcode?: boolean;
      forceLocalize?: boolean;
    },
    requestId: string,
  ): Promise<M3u8ConversionResponse> {
    const tempFiles: string[] = [];
    const tempDirs: string[] = [];

    try {
      const outputFileName = this.generateFileName(request.muxUrl);
      const tempFilePath = `/tmp/${outputFileName}`;
      tempFiles.push(tempFilePath);

      console.log(`Starting conversion for ${requestId}`, {
        m3u8Url: request.muxUrl,
        outputFile: outputFileName,
        quality: request.quality || 'medium',
        transcode: !!request.transcode,
      });

      await this.checkFFmpegAvailability();

      const tryDirectFirst = !request.forceLocalize;

      if (tryDirectFirst) {
        try {
          await this.convertViaFfmpegHttp(
            request.muxUrl,
            tempFilePath,
            (request.quality as Quality) || 'medium',
            !!request.transcode,
          );
        } catch (err: any) {
          // Detect SIGSEGV or any immediate crash; fall back to localization
          const sig = err?.signal || '';
          console.warn(
            'Direct ffmpeg over HTTPS failed. Signal:',
            sig,
            'Falling back to localize-on-disk.',
          );
          await this.convertViaLocalizedPlaylist(
            request.muxUrl,
            tempFilePath,
            (request.quality as Quality) || 'medium',
            !!request.transcode,
            tempFiles,
            tempDirs,
          );
        }
      } else {
        await this.convertViaLocalizedPlaylist(
          request.muxUrl,
          tempFilePath,
          (request.quality as Quality) || 'medium',
          !!request.transcode,
          tempFiles,
          tempDirs,
        );
      }

      if (!fs.existsSync(tempFilePath)) {
        throw new Error('Conversion failed - output file not created');
      }

      const fileStats = fs.statSync(tempFilePath);
      console.log(`Conversion completed. File size: ${fileStats.size} bytes`);

      const s3Key = `${request.uploadS3Path}${outputFileName}`;
      console.log(`Uploading to S3: ${request.bucketName}/${s3Key}`);

      const uploadResult = await this.s3Service.uploadFile(
        tempFilePath,
        s3Key,
        request.bucketName,
      );

      console.log(`File uploaded successfully to: ${uploadResult.signedUrl}`);

      this.cleanup(tempFiles, tempDirs);

      return {
        success: true,
        message: 'Conversion completed successfully',
        data: {
          signedUrl: uploadResult.signedUrl,
          s3Path: uploadResult.s3Path,
          bucketName: uploadResult.bucketName,
          fileSize: uploadResult.fileSize,
          fileName: outputFileName,
        },
        requestId,
      };
    } catch (error) {
      console.error('Conversion error:', error);
      this.cleanup(tempFiles, tempDirs);
      throw error;
    }
  }

  // --- Strategy 1: direct ffmpeg over HTTPS (your original path) ---

  private async convertViaFfmpegHttp(
    m3u8Url: string,
    outputPath: string,
    quality: Quality,
    transcode: boolean,
  ): Promise<void> {
    console.log(
      `Converting (direct HTTPS) M3U8 -> MP4: ${m3u8Url} -> ${outputPath}`,
    );
    const cmd = transcode
      ? this.buildFFmpegReencodeCommand(m3u8Url, outputPath, quality)
      : this.buildFFmpegRemuxHttpCommand(m3u8Url, outputPath);
    await this.execFfmpeg(cmd, outputPath);
  }

  // --- Strategy 2: localize playlist & segments, then use file:// only ---

  private async convertViaLocalizedPlaylist(
    m3u8Url: string,
    outputPath: string,
    quality: Quality,
    transcode: boolean,
    tempFiles: string[],
    tempDirs: string[],
  ): Promise<void> {
    console.log('Localizing HLS to /tmp and converting from local playlist…');

    const { localPlaylistPath, workDir } =
      await this.fetchAndLocalizeHls(m3u8Url);
    tempDirs.push(workDir);
    tempFiles.push(localPlaylistPath);

    const cmd = transcode
      ? this.buildFFmpegReencodeLocalCommand(
          localPlaylistPath,
          outputPath,
          quality,
        )
      : this.buildFFmpegRemuxLocalCommand(localPlaylistPath, outputPath);

    await this.execFfmpeg(cmd, outputPath);
  }

  // ---------- FFmpeg command builders ----------

  /** Direct HTTPS remux */
  private buildFFmpegRemuxHttpCommand(
    inputUrl: string,
    outputPath: string,
  ): string {
    return (
      `${this.ffmpegPath} ` +
      `-v debug -hide_banner -nostats -nostdin ` +
      `-protocol_whitelist "file,http,https,tcp,tls,crypto" ` +
      `-user_agent "Mozilla/5.0" ` +
      `-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 ` +
      `-rw_timeout 15000000 -timeout 15000000 -http_persistent 0 ` +
      `-i "${inputUrl}" ` +
      `-map 0:v:0 -map 0:a:0? ` +
      `-c copy -movflags +faststart -bsf:a aac_adtstoasc ` +
      `-y "${outputPath}"`
    );
  }

  /** Local file remux (no HTTPS in ffmpeg) */
  private buildFFmpegRemuxLocalCommand(
    localPlaylistPath: string,
    outputPath: string,
  ): string {
    return (
      `${this.ffmpegPath} ` +
      `-v debug -hide_banner -nostats -nostdin ` +
      `-protocol_whitelist "file,crypto" ` +
      `-i "${localPlaylistPath}" ` +
      `-map 0:v:0 -map 0:a:0? ` +
      `-c copy -movflags +faststart -bsf:a aac_adtstoasc ` +
      `-y "${outputPath}"`
    );
  }

  /** Direct HTTPS re-encode (only if you must) */
  private buildFFmpegReencodeCommand(
    inputUrl: string,
    outputPath: string,
    quality: Quality,
  ): string {
    const qp =
      quality === 'low'
        ? '-c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k'
        : quality === 'high'
          ? '-c:v libx264 -crf 20 -preset fast -c:a aac -b:a 128k'
          : '-c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k';

    return (
      `${this.ffmpegPath} ` +
      `-v debug -hide_banner -nostats -nostdin ` +
      `-protocol_whitelist "file,http,https,tcp,tls,crypto" ` +
      `-user_agent "Mozilla/5.0" ` +
      `-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 ` +
      `-rw_timeout 15000000 -timeout 15000000 -http_persistent 0 ` +
      `-i "${inputUrl}" ` +
      `-map 0:v:0 -map 0:a:0? ${qp} -movflags +faststart ` +
      `-y "${outputPath}"`
    );
  }

  /** Local file re-encode (no HTTPS in ffmpeg) */
  private buildFFmpegReencodeLocalCommand(
    localPlaylistPath: string,
    outputPath: string,
    quality: Quality,
  ): string {
    const qp =
      quality === 'low'
        ? '-c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k'
        : quality === 'high'
          ? '-c:v libx264 -crf 20 -preset fast -c:a aac -b:a 128k'
          : '-c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k';

    return (
      `${this.ffmpegPath} ` +
      `-v debug -hide_banner -nostats -nostdin ` +
      `-protocol_whitelist "file,crypto" ` +
      `-i "${localPlaylistPath}" ` +
      `-map 0:v:0 -map 0:a:0? ${qp} -movflags +faststart ` +
      `-y "${outputPath}"`
    );
  }

  // ---------- Execute ffmpeg and verify output ----------

  private async execFfmpeg(cmd: string, outputPath: string) {
    console.log(`FFmpeg command (${cmd.length} chars): ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 900_000,
      maxBuffer: 1024 * 1024 * 200,
      killSignal: 'SIGTERM',
    });
    if (stdout) console.log('FFmpeg stdout:', stdout.slice(0, 4000));
    if (stderr) console.log('FFmpeg stderr:', stderr.slice(0, 4000));

    if (!fs.existsSync(outputPath)) {
      throw new Error('FFmpeg conversion failed - output file not created');
    }
  }

  // ---------- HLS localization (master/media, segments, keys) ----------

  private async fetchAndLocalizeHls(m3u8Url: string): Promise<LocalizeResult> {
    const workDir = `/tmp/hls_${crypto.randomUUID()}`;
    fs.mkdirSync(workDir, { recursive: true });
    console.log('Localize workDir:', workDir);

    // Resolve to media playlist (choose highest BANDWIDTH if master)
    const mediaUrl = await this.resolveMediaPlaylist(m3u8Url);
    console.log('Resolved media playlist:', mediaUrl);

    // Fetch media playlist text
    const mediaTxt = await this.fetchText(mediaUrl);
    const mediaBase = this.dirOf(mediaUrl);

    // Parse, download keys & segments
    const lines = mediaTxt.split(/\r?\n/);
    const rewritten: string[] = [];
    let seq = 0;

    // Track if AES-128 key section exists; download key if present
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-KEY')) {
        // Example: #EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x...
        const uriMatch = /URI="([^"]+)"/.exec(line);
        if (uriMatch) {
          const keyRemote = this.absUrl(mediaBase, uriMatch[1]);
          const keyName = `key_${seq++}.bin`;
          const keyPath = path.join(workDir, keyName);
          const keyBuf = await this.fetchBin(keyRemote);
          fs.writeFileSync(keyPath, keyBuf);
          const replaced = line.replace(uriMatch[1], keyName);
          rewritten.push(replaced);
          continue;
        }
      }

      if (line.length === 0 || line.startsWith('#')) {
        rewritten.push(line);
        continue;
      }

      // Segment URI (relative or absolute)
      const segRemote = this.absUrl(mediaBase, line.trim());
      const segName = `seg_${seq++}${this.guessExt(segRemote)}`;
      const segPath = path.join(workDir, segName);
      const segBuf = await this.fetchBin(segRemote);
      fs.writeFileSync(segPath, segBuf);
      rewritten.push(segName);
    }

    // Write localized playlist
    const localPlaylistPath = path.join(workDir, 'localized.m3u8');
    fs.writeFileSync(localPlaylistPath, rewritten.join('\n'));
    console.log('Wrote localized playlist:', localPlaylistPath);

    return { localPlaylistPath, workDir };
  }

  private async resolveMediaPlaylist(url: string): Promise<string> {
    const txt = await this.fetchText(url);
    const isMaster = txt.includes('#EXT-X-STREAM-INF');

    if (!isMaster) return url;

    // Parse master: pick variant with highest BANDWIDTH
    const lines = txt.split(/\r?\n/);
    let bestBandwidth = -1;
    let bestUri: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = /BANDWIDTH=(\d+)/.exec(line);
        const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const next = lines[i + 1] || '';
        if (next && !next.startsWith('#')) {
          if (bandwidth > bestBandwidth) {
            bestBandwidth = bandwidth;
            bestUri = next.trim();
          }
        }
      }
    }

    if (!bestUri) {
      throw new Error('Master playlist parsed, but no variants found.');
    }

    const base = this.dirOf(url);
    return this.absUrl(base, bestUri);
  }

  // ---------- small helpers ----------

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' } as any,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  }

  private async fetchBin(url: string): Promise<Buffer> {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' } as any,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const arr = new Uint8Array(await res.arrayBuffer());
    return Buffer.from(arr);
  }

  private dirOf(u: string): string {
    const idx = u.lastIndexOf('/');
    return idx >= 0 ? u.slice(0, idx + 1) : u;
  }

  private absUrl(base: string, maybeRelative: string): string {
    if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
    return new URL(maybeRelative, base).toString();
  }

  private guessExt(u: string): string {
    const p = u.split('?')[0];
    if (p.endsWith('.ts')) return '.ts';
    if (p.endsWith('.m4s')) return '.m4s';
    if (p.endsWith('.mp4')) return '.mp4';
    return '.bin';
  }

  private async checkFFmpegAvailability(): Promise<void> {
    try {
      console.log(`Checking FFmpeg availability at: ${this.ffmpegPath}`);
      const { stdout } = await execAsync(`${this.ffmpegPath} -version`, {
        timeout: 5000,
      });
      console.log('FFmpeg is available:', stdout.split('\n')[0]);
    } catch (error) {
      console.error('FFmpeg check failed:', error);
      throw new Error(
        `FFmpeg is not available at ${this.ffmpegPath}. Ensure your Lambda layer matches AL2023 & x86_64.`,
      );
    }
  }

  private generateFileName(m3u8Url: string): string {
    try {
      const url = new URL(m3u8Url);
      const filename = path.basename(url.pathname, '.m3u8');
      const ts = Date.now();
      return `${filename}_${ts}.mp4`;
    } catch {
      const ts = Date.now();
      const rand = Math.random().toString(36).substring(7);
      return `video_${ts}_${rand}.mp4`;
    }
  }

  private cleanup(tempFiles: string[], tempDirs: string[]): void {
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`Cleaned up temp file: ${file}`);
        }
      } catch (err) {
        console.error(`Failed to cleanup file ${file}:`, err);
      }
    }
    for (const dir of tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          // Best-effort recursive delete
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(`Cleaned up temp dir: ${dir}`);
        }
      } catch (err) {
        console.error(`Failed to cleanup dir ${dir}:`, err);
      }
    }
  }

  private logEnvironment(): void {
    try {
      const df = execSync('df -h /tmp').toString();
      console.log('Disk space /tmp:\n' + df);
    } catch (e) {
      console.log('Could not read /tmp disk space', e);
    }

    try {
      const mem = process.memoryUsage();
      const toMB = (n: number) => Math.round(n / 1024 / 1024);
      console.log('Node memory (MB):', {
        rss: toMB(mem.rss),
        heapTotal: toMB(mem.heapTotal),
        heapUsed: toMB(mem.heapUsed),
        external: toMB(mem.external as number),
        arrayBuffers: toMB((mem as any).arrayBuffers || 0),
      });
    } catch (e) {
      console.log('Could not read memory usage', e);
    }
  }

  private createErrorResponse(
    message: string,
    error: string,
    requestId: string,
  ): LambdaErrorResponse {
    return { success: false, message, error, requestId };
  }
}

export const main: LambdaHandler = async (
  event: M3u8ConversionRequest & {
    transcode?: boolean;
    forceLocalize?: boolean;
  },
  context: Context,
): Promise<M3u8ConversionResponse> => {
  const handler = new M3u8ConverterHandler();
  return handler.handle(event, context);
};
