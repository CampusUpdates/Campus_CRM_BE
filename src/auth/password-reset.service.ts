import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from 'src/email/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordResetService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  async requestPasswordReset(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    // 1. Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // 2. Generate secure token
      const rawToken = crypto.randomBytes(32).toString('hex');

      // 3. Hash token for DB
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // 4. Set expiry (30 mins)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 30);

      // 5. Save to DB
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      // 6. Send email
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

      await this.emailService.sendPasswordResetEmail(user.email, resetUrl);
    }

    // Always return generic success message to prevent email enumeration
    return {
      message: 'If an account exists with this email, a password reset link has been sent.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;

    // 1. Hash the provided token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Find token in DB
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date() || !resetToken.user) {
      throw new BadRequestException('This password reset link is invalid or has expired.');
    }

    // 3. Hash new password securely
    const newPasswordHash = await argon2.hash(newPassword);

    // 4. Execute transaction to update password and mark token as used
    await this.prisma.$transaction(async (prisma) => {
      // Update password
      await prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
        },
      });

      // Mark this token as used
      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // Delete other unused tokens for this user
      await prisma.passwordResetToken.deleteMany({
        where: {
          userId: resetToken.userId,
          usedAt: null,
          id: { not: resetToken.id }
        },
      });
    }, { maxWait: 10000, timeout: 30000 });

    return {
      message: 'Password reset successfully.',
    };
  }
}
