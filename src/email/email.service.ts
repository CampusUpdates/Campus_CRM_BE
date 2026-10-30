import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('EMAIL_API_KEY');
    this.fromEmail = this.configService.get<string>('EMAIL_FROM') || 'noreply@campus-crm.com';

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('EMAIL_API_KEY is not set. EmailService will log emails instead of sending them.');
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    const subject = 'Password Reset - Campus CRM';
    const html = `
      <h1>Password Reset Request</h1>
      <p>We received a request to reset your password for Campus CRM.</p>
      <p>Click the link below to set a new password. This link will expire in 30 minutes.</p>
      <p><a href="${resetUrl}">Reset Password</a></p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    if (this.resend) {
      try {
        const result = await this.resend.emails.send({
          from: this.fromEmail,
          to,
          subject,
          html,
        });

        if (result.error) {
          this.logger.error(`Failed to send email to ${to}:`, result.error);
          return false;
        }
        return true;
      } catch (error) {
        this.logger.error(`Exception while sending email to ${to}:`, error);
        return false;
      }
    } else {
      // Mock mode for local dev
      this.logger.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[MOCK EMAIL CONTENT] Reset URL: ${resetUrl}`);
      return true;
    }
  }
}
