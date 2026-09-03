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
  implements OnModuleInit, OnModuleDestroy {
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
            try {
              result = await query(args);
            } catch (err: any) {
              const errCode = err?.code;
              const errMsg = err?.message || '';
              if (
                errCode !== 'P2028' &&
                !errMsg.includes('Transaction') &&
                (errCode === 'P1001' ||
                  errCode === 'P1002' ||
                  errMsg.includes("Can't reach database server") ||
                  errMsg.includes('Connection reset') ||
                  errMsg.includes('EMAXCONNSESSION') ||
                  errMsg.includes('max clients'))
              ) {
                console.warn(
                  `[PrismaService] Transient DB connection pool saturation/drop (${errCode || 'pool'}). Retrying operation in 200ms...`,
                );
                await new Promise((res) => setTimeout(res, 200));
                await self.$connect().catch(() => {});
                result = await query(args);
              } else {
                throw err;
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

                  const res = result as any;
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
    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        break;
      } catch (error) {
        retries--;
        console.warn(
          `[PrismaService] DB connection attempt failed (${retries} retries left):`,
          (error as Error)?.message || error,
        );
        if (retries === 0) throw error;
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
