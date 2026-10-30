import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, ActivityType } from '@prisma/client';
import { UserContextService } from '../common/services/user-context.service';

const MODEL_ACTIVITY_MAP: Record<string, ActivityType> = {
  Lead: ActivityType.LEAD,
  LeadAssignment: ActivityType.LEAD,
  CollegeLeadPitch: ActivityType.LEAD,
  User: ActivityType.USER,
  Role: ActivityType.USER,
  Permission: ActivityType.USER,
  College: ActivityType.COLLEGE,
  Course: ActivityType.COLLEGE,
  CollegeCourse: ActivityType.COLLEGE,
  Candidate: ActivityType.CANDIDATE,
  Interview: ActivityType.INTERVIEW,
  Attendance: ActivityType.ATTENDANCE,
  Notification: ActivityType.NOTIFICATION,
  Tpc: ActivityType.TPC,
};

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private fallbackUserId: string | null = null;

  constructor(private readonly userContextService: UserContextService) {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    const self = this;

    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            let result;
            let attempts = 0;
            const maxAttempts = 10;
            while (attempts < maxAttempts) {
              try {
                result = await query(args);
                break;
              } catch (err: any) {
                attempts++;
                const errCode = err?.code;
                const errMsg = err?.message || '';
                const isTransient =
                  errCode !== 'P2028' &&
                  !errMsg.includes('Transaction') &&
                  (errCode === 'P1001' ||
                    errCode === 'P1002' ||
                    errCode === 'P1003' ||
                    errCode === 'P1017' ||
                    errCode === 'P2024' ||
                    errCode === '26000' ||
                    errCode === '42P05' ||
                    errMsg.includes("Can't reach database server") ||
                    errMsg.includes('Connection reset') ||
                    errMsg.includes('Closed connection') ||
                    errMsg.includes('EMAXCONNSESSION') ||
                    errMsg.includes('max clients') ||
                    errMsg.includes('prepared statement') ||
                    errMsg.includes('timeout') ||
                    errMsg.includes('EngineTerminatedError'));

                if (isTransient && attempts < maxAttempts) {
                  if (attempts >= 6) {
                    console.warn(
                      `[PrismaService] Transient DB connection pool glitch (${errCode || 'pool'}, attempt ${attempts}/${maxAttempts}). Retrying in backoff...`,
                    );
                  }
                  const jitter = Math.floor(Math.random() * 150);
                  await new Promise((res) =>
                    setTimeout(res, 200 * attempts + jitter),
                  );
                } else {
                  throw err;
                }
              }
            }

            if (
              model &&
              model !== 'ActivityLog' &&
              WRITE_OPERATIONS.has(operation)
            ) {
              try {
                let userId = self.userContextService?.getUserId?.();

                if (!userId) {
                  if (!self.fallbackUserId) {
                    const admin = await (extended as any).user.findFirst({
                      where: { role: { name: 'SUPER_ADMIN' } },
                      select: { id: true },
                    });
                    if (admin) {
                      self.fallbackUserId = admin.id;
                    }
                  }
                  userId = self.fallbackUserId || undefined;
                }

                if (userId) {
                  const activityType =
                    MODEL_ACTIVITY_MAP[model] || ActivityType.SYSTEM;

                  const actionText = operation.startsWith('create')
                    ? 'Created'
                    : operation.startsWith('update') || operation === 'upsert'
                      ? 'Updated'
                      : 'Deleted';

                  const res = result;
                  let entityId = 'N/A';
                  if (res && typeof res === 'object' && res.id) {
                    entityId = String(res.id);
                  } else if (
                    args &&
                    typeof args === 'object' &&
                    (args as any).where?.id
                  ) {
                    entityId = String((args as any).where.id);
                  }

                  let entityName = '';
                  if (res && typeof res === 'object') {
                    if (res.firstName || res.lastName) {
                      entityName = ` (${[res.firstName, res.lastName]
                        .filter(Boolean)
                        .join(' ')})`;
                    } else if (res.name) {
                      entityName = ` (${res.name})`;
                    } else if (res.title) {
                      entityName = ` (${res.title})`;
                    }
                  }

                  const description = `${actionText} ${model}${entityName}`;

                  await (extended as any).activityLog.create({
                    data: {
                      userId,
                      activity: activityType,
                      entityType: model,
                      entityId,
                      description,
                    },
                  });
                }
              } catch (error) {
                console.error('Failed to auto-create ActivityLog:', error);
              }
            }

            return result;
          },
        },
      },
    });

    return extended as unknown as PrismaService;
  }

  async onModuleInit() {
    let retries = 3;
    while (retries > 0) {
      try {
        await this.$connect();
        console.log('[PrismaService] Successfully connected to database.');
        break;
      } catch (error) {
        retries--;
        console.warn(
          `[PrismaService] DB connection attempt failed (${retries} retries left):`,
          (error as Error)?.message || error,
        );
        if (retries === 0) {
          console.error(
            '[PrismaService] Could not reach database server on startup. NestJS server will start up in degraded mode; database connections will be retried upon incoming requests.',
          );
        } else {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
