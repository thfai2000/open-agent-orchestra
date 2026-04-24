import { createTransport } from 'nodemailer';
import { db } from '../database/index.js';
import { systemSettings } from '../database/schema.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '@oao/shared';

const logger = createLogger('mailer');

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
}

async function getMailConfig(): Promise<MailConfig | null> {
  const setting = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, 'mail') });
  if (!setting?.value) return null;
  const v = setting.value as Record<string, unknown>;
  if (!v.host || !v.port || !v.fromAddress) return null;
  return v as unknown as MailConfig;
}

export async function sendPasswordResetEmail(opts: { to: string; name: string; token: string; workspaceSlug: string }) {
  const config = await getMailConfig();
  if (!config) {
    logger.warn('Mail not configured — skipping password reset email for %s', opts.to);
    return;
  }

  const resetUrl = `${process.env.APP_BASE_URL || 'http://localhost:3002'}/${opts.workspaceSlug}/reset-password?token=${opts.token}`;

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
  });

  const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;

  await transport.sendMail({
    from,
    to: opts.to,
    subject: 'Reset your OAO password',
    text: `Hi ${opts.name},\n\nYou requested a password reset. Click the link below to set a new password (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.\n\nOAO Platform`,
    html: `<p>Hi ${opts.name},</p><p>You requested a password reset. Click the link below to set a new password (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p><p>OAO Platform</p>`,
  });

  logger.info('Password reset email sent to %s', opts.to);
}
