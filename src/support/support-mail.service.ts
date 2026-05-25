import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type SupportInboundPayload = {
  submissionId: string;
  issueType: string;
  issueLabel: string;
  fullName: string;
  mobile: string;
  description: string;
};

/**
 * Sends contact/support form submissions via SMTP (e.g. Gmail:
 * host `smtp.gmail.com`, port `587`, app password).
 * When `SMTP_PASS` is unset, outbound mail is skipped (DB row still saved).
 */
@Injectable()
export class SupportMailService {
  private readonly logger = new Logger(SupportMailService.name);

  constructor(private readonly config: ConfigService) {}

  /** True when host auth is configured — send is attempted and failures propagate. */
  isOutboundEnabled(): boolean {
    if (!this.smtpPass()) return false;
    const user =
      this.config.get<string>('SMTP_USER')?.trim() ??
      this.config.get<string>('SUPPORT_CONTACT_FROM')?.trim();
    return !!user;
  }

  private smtpPass(): string | undefined {
    return (
      this.config.get<string>('SMTP_PASS') ??
      this.config.get<string>('SMTP_PASSWORD')
    )?.trim();
  }

  private createTransport(): Transporter | null {
    const pass = this.smtpPass();
    if (!pass || pass.length === 0) return null;

    const host = this.config.get<string>('SMTP_HOST') ?? 'smtp.gmail.com';
    const portRaw = this.config.get<string>('SMTP_PORT') ?? '587';
    const port = Number(portRaw);
    const secureRaw = this.config.get<string>('SMTP_SECURE');
    const secure =
      secureRaw === 'true' || secureRaw === '1' || Number(portRaw) === 465;

    const user =
      this.config.get<string>('SMTP_USER') ??
      this.config.get<string>('SUPPORT_CONTACT_FROM') ??
      '';

    if (!user) {
      this.logger.warn(
        'SMTP_PASS is set but SMTP_USER / SUPPORT_CONTACT_FROM is empty',
      );
      return null;
    }

    return nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  async sendInboundNotification(payload: SupportInboundPayload): Promise<void> {
    const transport = this.createTransport();
    if (!transport) {
      throw new Error(
        'SMTP transporter not created (SMTP_USER/SMTP_PASS required when outbound is enabled)',
      );
    }

    const to =
      this.config.get<string>('SUPPORT_CONTACT_TO') ?? 'admin@fieldflix.com';
    const fromUser =
      this.config.get<string>('SMTP_USER') ??
      this.config.get<string>('SUPPORT_CONTACT_FROM') ??
      to;

    const fromHeader = `FieldFlix Support <${fromUser}>`;
    const subject = `[FieldFlix] ${payload.issueLabel} — ${payload.fullName}`;

    const text = [
      `Submission id: ${payload.submissionId}`,
      `Issue type: ${payload.issueLabel} (${payload.issueType})`,
      `Name: ${payload.fullName}`,
      `Mobile: ${payload.mobile}`,
      '',
      'Message:',
      payload.description,
    ].join('\n');

    await transport.sendMail({
      from: fromHeader,
      to,
      subject,
      text,
    });

    this.logger.log(
      `Support email sent to=${to} submissionId=${payload.submissionId}`,
    );
  }
}
