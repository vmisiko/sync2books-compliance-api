import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

export type SendMailResult = { sent: true } | { sent: false; reason: string };

/**
 * Thin SMTP wrapper. Mirrors the dev-fallback pattern used for
 * `JWT_DASHBOARD_SECRET` (dashboard-identity/infrastructure/dashboard-jwt.secret.ts):
 * if SMTP isn't configured, log once and no-op rather than throwing, so local
 * dev/tests don't need real credentials.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter | null = null;
  private warned = false;

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    if (!host) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'SMTP_HOST is not set — emails will be logged, not sent. Configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM before deploying.',
        );
      }
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    return this.transporter;
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.log(`[mailer disabled] would send "${input.subject}" to ${input.to}`);
      return { sent: false, reason: 'SMTP not configured' };
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments,
    });
    return { sent: true };
  }
}
