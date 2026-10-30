import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';
import { LeadsService } from 'src/leads/leads.service';
import { CreateCounsellingDto } from './dto/create-counselling.dto';
import { CompleteCounsellingDto } from './dto/complete-counselling.dto';
import { ScheduleCounsellingDto } from './dto/schedule-counselling.dto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { CounsellingStatus } from '@prisma/client';
import { isPreferredDateInPast } from 'src/common/utils/date.util';

@Injectable()
export class CounsellingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamLeadAuthService: TeamLeadAuthorizationService,
    private readonly leadsService: LeadsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Validate authorization to access a lead's counselling records
   */
  async validateLeadAccess(
    userId: string,
    leadId: string,
    action: 'READ' | 'CREATE' | 'COMPLETE' | 'SCHEDULE',
  ) {
    if (!userId) throw new UnauthorizedException('Authentication required');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        teamId: true,
        role: { select: { name: true } },
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const roleName = (user.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(roleName);

    // Hard block Program Advisors from completing or scheduling counselling
    if (
      (action === 'COMPLETE' || action === 'SCHEDULE') &&
      ['PROGRAM_ADVISOR', 'PA', 'ADVISOR'].includes(roleName)
    ) {
      throw new ForbiddenException(
        action === 'SCHEDULE'
          ? 'Program Advisors are not authorized to schedule counselling.'
          : 'Program Advisors are not authorized to mark counselling complete.',
      );
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        courseInterested: true,
        specializationInterested: true,
        createdById: true,
        teamId: true,
        assignments: {
          select: { userId: true },
          orderBy: { assignedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!lead) throw new NotFoundException('Lead not found');

    // Super Admin has global access
    if (isSuperAdmin) return lead;

    const assignedUserId = lead.assignments[0]?.userId;

    // Check Team Lead scoping
    const isTeamLead = await this.teamLeadAuthService.isTeamLead(userId);
    if (isTeamLead) {
      const supervisedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
      const authorizedIds = new Set([userId, ...supervisedAdvisorIds]);

      const isLeadAuthorized =
        (assignedUserId && authorizedIds.has(assignedUserId)) ||
        (lead.createdById && authorizedIds.has(lead.createdById));

      if (!isLeadAuthorized) {
        throw new ForbiddenException(
          'You can only access counselling requests for your supervised advisors.',
        );
      }
      return lead;
    }

    // Check Manager scoping
    if (roleName === 'MANAGER' || roleName.includes('MANAGER')) {
      const managedMemberIds =
        await this.leadsService.getManagerTeamMemberIds(userId);
      const managedTeamIds = (
        await this.prisma.team.findMany({
          where: { managerId: userId, isActive: true },
          select: { id: true },
        })
      ).map((t) => t.id);

      const isTeamAuthorized =
        (lead.teamId && managedTeamIds.includes(lead.teamId)) ||
        (assignedUserId && managedMemberIds.includes(assignedUserId)) ||
        (lead.createdById && managedMemberIds.includes(lead.createdById)) ||
        lead.createdById === userId ||
        assignedUserId === userId;

      if (!isTeamAuthorized) {
        throw new ForbiddenException(
          'You can only access counselling requests for leads in your managed team.',
        );
      }
      return lead;
    }

    // Program Advisor scoping
    let isRequester = false;
    if (action === 'READ' && this.prisma.collegeCounsellingRequest?.findFirst) {
      const existingReq = await this.prisma.collegeCounsellingRequest.findFirst({
        where: { leadId, requestedById: userId },
        select: { id: true },
      });
      isRequester = Boolean(existingReq);
    }

    const isOwner =
      assignedUserId === userId || lead.createdById === userId || isRequester;

    if (!isOwner) {
      throw new ForbiddenException(
        'You can only access counselling requests for your own leads or requests submitted by you.',
      );
    }

    if (action === 'COMPLETE' || action === 'SCHEDULE') {
      throw new ForbiddenException(
        action === 'SCHEDULE'
          ? 'Program Advisors are not authorized to schedule counselling.'
          : 'Program Advisors are not authorized to mark counselling complete.',
      );
    }

    return lead;
  }

  /**
   * Create one or more counselling requests for a lead
   */
  async createCounsellingRequests(
    userId: string,
    leadId: string,
    dto: CreateCounsellingDto,
  ) {
    await this.validateLeadAccess(userId, leadId, 'CREATE');

    if (!dto.requests || dto.requests.length === 0) {
      throw new BadRequestException('At least one college request is required');
    }

    // Validate college IDs exist
    const collegeIds = dto.requests.map((r) => r.collegeId);
    const existingColleges = await this.prisma.college.findMany({
      where: { id: { in: collegeIds } },
      select: { id: true, name: true, isActive: true },
    });
    const collegeMap = new Map(existingColleges.map((c) => [c.id, c]));

    for (const cid of collegeIds) {
      if (!collegeMap.has(cid)) {
        throw new NotFoundException(`College with ID ${cid} not found`);
      }
    }

    // Deduplicate within the payload
    const seen = new Set<string>();
    const deduplicated = dto.requests.filter((r) => {
      if (seen.has(r.collegeId)) return false;
      seen.add(r.collegeId);
      return true;
    });

    // Validate that preferred dates are not in the past
    for (const item of deduplicated) {
      if (item.preferredDate && item.preferredDate.trim()) {
        if (isPreferredDateInPast(item.preferredDate)) {
          throw new BadRequestException('Preferred counselling date cannot be in the past');
        }
      }
    }

    const created: any[] = [];
    for (const item of deduplicated) {
      try {
        let parsedDate: Date | null = null;
        if (item.preferredDate && item.preferredDate.trim()) {
          const dateStr = item.preferredDate.trim();
          const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00.000Z`);
          if (!isNaN(d.getTime())) {
            parsedDate = d;
          }
        }
        const prefTime = item.preferredTime?.trim() || null;
        const legacyTiming =
          item.preferredTiming?.trim() ||
          (parsedDate || prefTime
            ? [item.preferredDate?.trim(), prefTime].filter(Boolean).join(' ')
            : null);

        const record = await this.prisma.collegeCounsellingRequest.create({
          data: {
            leadId,
            collegeId: item.collegeId,
            preferredDate: parsedDate,
            preferredTime: prefTime,
            preferredTiming: legacyTiming,
            purpose: item.purpose?.trim() || null,
            status: 'REQUESTED',
            requestedById: userId,
          },
          include: {
            college: { select: { id: true, name: true, city: true, state: true } },
            requestedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        created.push(record);
        await this.sendCounsellingRequestedNotification(leadId, item.collegeId, userId);
      } catch (error: any) {
        if (
          error.code === 'P2002' ||
          error.message?.includes('unique_active_lead_college_counselling')
        ) {
          const collegeName = collegeMap.get(item.collegeId)?.name || 'this college';
          throw new ConflictException(
            `An active counselling request already exists for ${collegeName}.`,
          );
        }
        throw error;
      }
    }

    return created;
  }

  /**
   * Generates a real-time notification to authorized Managers, Team Leads, and Super Admins
   * when a new counselling request is created.
   */
  private async sendCounsellingRequestedNotification(
    leadId: string,
    collegeId: string,
    requestingUserId: string,
  ) {
    try {
      const [lead, college, requestingUser] = await Promise.all([
        this.prisma.lead.findUnique({
          where: { id: leadId },
          select: { id: true, firstName: true, lastName: true },
        }),
        this.prisma.college.findUnique({
          where: { id: collegeId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: requestingUserId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            teamId: true,
            managerId: true,
          },
        }),
      ]);

      if (!lead || !college || !requestingUser) return;

      const studentName =
        [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Student';
      const collegeName = college.name || 'College';
      const paName =
        [requestingUser.firstName, requestingUser.lastName].filter(Boolean).join(' ') ||
        'Advisor';
      const now = new Date();
      const requestTime =
        now.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }) +
        ' ' +
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

      // 1. Resolve Team Leads for requesting PA
      const directTls = this.prisma.teamLeadAdvisor
        ? await this.prisma.teamLeadAdvisor.findMany({
            where: { advisorId: requestingUserId },
            select: { teamLeadId: true },
          })
        : [];
      const teamTls =
        requestingUser.teamId && this.prisma.teamLead
          ? await this.prisma.teamLead.findMany({
              where: { teamId: requestingUser.teamId },
              select: { userId: true },
            })
          : [];

      // 2. Resolve Manager
      let managerId: string | null = requestingUser.managerId;
      if (!managerId && requestingUser.teamId) {
        const team = await this.prisma.team.findUnique({
          where: { id: requestingUser.teamId },
          select: { managerId: true },
        });
        managerId = team?.managerId ?? null;
      }

      // 3. Resolve Super Admins
      const superAdmins = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { roleId: 1 },
            {
              role: {
                name: {
                  in: ['SUPER_ADMIN', 'SUPERADMIN', 'Super Admin'],
                },
              },
            },
          ],
        },
        select: { id: true },
      });

      const recipientIds = new Set<string>();
      for (const tl of directTls) {
        if (tl.teamLeadId && tl.teamLeadId !== requestingUserId) {
          recipientIds.add(tl.teamLeadId);
        }
      }
      for (const tl of teamTls) {
        if (tl.userId && tl.userId !== requestingUserId) {
          recipientIds.add(tl.userId);
        }
      }
      if (managerId && managerId !== requestingUserId) {
        recipientIds.add(managerId);
      }
      for (const sa of superAdmins) {
        if (sa.id && sa.id !== requestingUserId) {
          recipientIds.add(sa.id);
        }
      }

      const candidateIds = Array.from(recipientIds);
      if (candidateIds.length === 0) return;

      const activeRecipients = await this.prisma.user.findMany({
        where: {
          id: { in: candidateIds },
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      const finalRecipientUserIds = activeRecipients.map((u) => u.id);
      if (finalRecipientUserIds.length === 0) return;

      const title = 'Counselling Requested';
      const message = `A new counselling request has been created.\nStudent: ${studentName}\nCollege: ${collegeName}\nRequesting PA: ${paName}\nTime: ${requestTime}\nLink: /counselling`;

      await this.notificationsService.createNotification({
        title,
        message,
        type: 'SYSTEM',
        recipientUserIds: finalRecipientUserIds,
      });
    } catch (err) {
      console.error('Error generating Counselling Requested notification:', err);
    }
  }

  /**
   * Get all counselling requests for a lead
   */
  async getCounsellingRequestsByLead(userId: string, leadId: string) {
    await this.validateLeadAccess(userId, leadId, 'READ');

    return this.prisma.collegeCounsellingRequest.findMany({
      where: { leadId },
      include: {
        college: { select: { id: true, name: true, city: true, state: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        scheduledBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Complete a counselling request with a mandatory remark
   */
  async completeCounsellingRequest(
    userId: string,
    requestId: string,
    dto: CompleteCounsellingDto,
  ) {
    const trimmedRemark = (dto.revert || dto.remark || '').trim();
    if (!trimmedRemark || trimmedRemark.length === 0) {
      throw new BadRequestException('Completion remark is required and cannot be empty.');
    }

    const request = await this.prisma.collegeCounsellingRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        leadId: true,
        collegeId: true,
        status: true,
        requestedById: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Counselling request not found.');
    }

    // Verify authorized Manager/Team Lead/Admin scope
    await this.validateLeadAccess(userId, request.leadId, 'COMPLETE');

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Counselling request is already completed.');
    }

    let parsedCounsellingDate: Date | null = null;
    if (dto.counsellingDate && dto.counsellingDate.trim()) {
      const dateStr = dto.counsellingDate.trim();
      const parsed = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00.000Z`);
      if (!isNaN(parsed.getTime())) {
        parsedCounsellingDate = parsed;
      }
    }

    const updated = await this.prisma.collegeCounsellingRequest.update({
      where: { id: requestId },
      data: {
        status: 'COMPLETED',
        completionRemark: trimmedRemark,
        counsellingDate: parsedCounsellingDate,
        completedById: userId,
        completedAt: new Date(),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            city: true,
            state: true,
            courseInterested: true,
            courseInterestedOther: true,
          },
        },
        college: { select: { id: true, name: true, city: true, state: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        scheduledBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await this.sendCounsellingCompletedNotification(
      request.leadId,
      request.collegeId,
      request.requestedById,
      userId,
      trimmedRemark,
      requestId,
      parsedCounsellingDate,
    );

    return updated;
  }

  /**
   * Generates a real-time notification to the relevant Program Advisor
   * when a counselling request is completed.
   */
  private async sendCounsellingCompletedNotification(
    leadId: string,
    collegeId: string,
    requestedById: string,
    completingUserId: string,
    revertRemark: string,
    requestId: string,
    counsellingDate?: Date | null,
  ) {
    try {
      const [lead, college, completingUser] = await Promise.all([
        this.prisma.lead.findUnique({
          where: { id: leadId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            createdById: true,
            assignments: {
              select: { userId: true },
              orderBy: { assignedAt: 'desc' },
              take: 1,
            },
          },
        }),
        this.prisma.college.findUnique({
          where: { id: collegeId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: completingUserId },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);

      if (!lead || !college) return;

      const studentName =
        [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Student';
      const collegeName = college.name || 'College';
      const completerName =
        [completingUser?.firstName, completingUser?.lastName]
          .filter(Boolean)
          .join(' ') || 'Manager / Team Lead';

      // Recipients: Program Advisor who originally submitted that counselling request
      const potentialRecipients = new Set<string>();
      if (requestedById && requestedById !== completingUserId) {
        potentialRecipients.add(requestedById);
      }

      if (potentialRecipients.size === 0) return;

      const activeRecipients = await this.prisma.user.findMany({
        where: {
          id: { in: Array.from(potentialRecipients) },
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      const recipientUserIds = activeRecipients.map((u) => u.id);
      if (recipientUserIds.length === 0) return;

      const dateLine = counsellingDate
        ? `\nLead Valid Till: ${counsellingDate.toISOString().split('T')[0]}`
        : '';
      const title = 'Counselling Completed';
      const message = `Counselling has been completed with revert instructions.\nStudent: ${studentName}\nCollege: ${collegeName}\nCompleted By: ${completerName}${dateLine}\nRevert: ${revertRemark}\nLink: /counselling`;

      await this.notificationsService.createNotification({
        title,
        message,
        type: 'SYSTEM',
        recipientUserIds,
      });
    } catch (err) {
      console.error('Error generating Counselling Completed notification:', err);
    }
  }

  /**
   * Schedule a counselling request with date, time, and notes
   */
  async scheduleCounsellingRequest(
    userId: string,
    requestId: string,
    dto: ScheduleCounsellingDto,
  ) {
    const rawDate = (dto.scheduledDate || dto.counsellingDate || '').trim();
    if (!rawDate) {
      throw new BadRequestException('Scheduled counselling date is required.');
    }
    const parsedDate = new Date(rawDate.includes('T') ? rawDate : `${rawDate}T00:00:00.000Z`);
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Invalid scheduled counselling date.');
    }

    const rawNotes = (dto.counsellingNotes || dto.notes || dto.remark || '').trim();
    if (!rawNotes) {
      throw new BadRequestException('Counselling notes are required and cannot be empty.');
    }

    const rawTime = (dto.scheduledTime || dto.time || '').trim() || null;

    const request = await this.prisma.collegeCounsellingRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        leadId: true,
        collegeId: true,
        status: true,
        requestedById: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Counselling request not found.');
    }

    // Verify authorized Manager/Team Lead/Admin scope
    await this.validateLeadAccess(userId, request.leadId, 'SCHEDULE');

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Counselling request is already completed.');
    }

    const updated = await this.prisma.collegeCounsellingRequest.update({
      where: { id: requestId },
      data: {
        status: 'SCHEDULED',
        scheduledDate: parsedDate,
        scheduledTime: rawTime,
        counsellingDate: parsedDate,
        counsellingNotes: rawNotes,
        scheduledById: userId,
        scheduledAt: new Date(),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            city: true,
            state: true,
            courseInterested: true,
            courseInterestedOther: true,
          },
        },
        college: { select: { id: true, name: true, city: true, state: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        scheduledBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await this.sendCounsellingScheduledNotification(
      request.leadId,
      request.collegeId,
      request.requestedById,
      userId,
      rawNotes,
      parsedDate,
      rawTime,
    );

    return updated;
  }

  /**
   * Generates a real-time notification to the relevant Program Advisor
   * when a counselling request is scheduled.
   */
  private async sendCounsellingScheduledNotification(
    leadId: string,
    collegeId: string,
    requestedById: string,
    schedulingUserId: string,
    counsellingNotes: string,
    scheduledDate: Date,
    scheduledTime?: string | null,
  ) {
    try {
      const [lead, college, schedulingUser] = await Promise.all([
        this.prisma.lead.findUnique({
          where: { id: leadId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        }),
        this.prisma.college.findUnique({
          where: { id: collegeId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: schedulingUserId },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);

      if (!lead || !college) return;

      const studentName =
        [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Student';
      const collegeName = college.name || 'College';
      const schedulerName =
        [schedulingUser?.firstName, schedulingUser?.lastName]
          .filter(Boolean)
          .join(' ') || 'Manager / Super Admin';

      if (!requestedById) return;

      const activeRecipient = await this.prisma.user.findFirst({
        where: { id: requestedById, status: 'ACTIVE' },
        select: { id: true },
      });

      if (!activeRecipient) return;

      const dateStr = scheduledDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const timeStr = scheduledTime ? ` at ${scheduledTime}` : '';

      const title = 'Counselling Scheduled';
      const message = `Counselling has been scheduled.\nStudent: ${studentName}\nCollege: ${collegeName}\nScheduled For: ${dateStr}${timeStr}\nScheduled By: ${schedulerName}\nNotes: ${counsellingNotes}\nLink: /counselling`;

      await this.notificationsService.createNotification({
        title,
        message,
        type: 'SYSTEM',
        recipientUserIds: [activeRecipient.id],
      });
    } catch (err) {
      console.error('Error generating Counselling Scheduled notification:', err);
    }
  }

  /**
   * Scoping where clause for counselling queries
   */
  async getScopedCounsellingWhere(userId: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        teamId: true,
        role: { select: { name: true } },
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const roleName = (user.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(roleName);

    // Super Admin: global access
    if (isSuperAdmin) {
      return {};
    }

    // Check Team Lead scoping
    const isTeamLead = await this.teamLeadAuthService.isTeamLead(userId);
    if (isTeamLead) {
      const supervisedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
      const authorizedIds = [userId, ...supervisedAdvisorIds];

      return {
        OR: [
          { requestedById: { in: authorizedIds } },
          {
            lead: {
              OR: [
                { assignments: { some: { userId: { in: authorizedIds } } } },
                { createdById: { in: authorizedIds } },
              ],
            },
          },
        ],
      };
    }

    // Check Manager scoping
    if (roleName === 'MANAGER' || roleName.includes('MANAGER')) {
      const managedMemberIds =
        await this.leadsService.getManagerTeamMemberIds(userId);
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: userId, isActive: true },
        select: { id: true },
      });
      const managedTeamIds = managedTeams.map((t) => t.id);
      const authorizedIds = [userId, ...managedMemberIds];

      return {
        OR: [
          { requestedById: { in: authorizedIds } },
          {
            lead: {
              OR: [
                ...(managedTeamIds.length > 0
                  ? [{ teamId: { in: managedTeamIds } }]
                  : []),
                { assignments: { some: { userId: { in: authorizedIds } } } },
                { createdById: { in: authorizedIds } },
              ],
            },
          },
        ],
      };
    }

    // Program Advisor / Advisor scoping: only their own leads or requested by them
    return {
      OR: [
        { requestedById: userId },
        {
          lead: {
            OR: [
              { assignments: { some: { userId } } },
              { createdById: userId },
            ],
          },
        },
      ],
    };
  }

  /**
   * Get pending counselling requests (status = REQUESTED)
   */
  async getPendingCounsellingRequests(userId: string) {
    const scopeWhere = await this.getScopedCounsellingWhere(userId);

    return this.prisma.collegeCounsellingRequest.findMany({
      where: {
        ...scopeWhere,
        status: 'REQUESTED',
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            city: true,
            state: true,
            courseInterested: true,
            courseInterestedOther: true,
          },
        },
        college: {
          select: {
            id: true,
            name: true,
            city: true,
            state: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        scheduledBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        completedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Get all counselling requests with optional status, date filter, and pagination
   */
  async getAllCounsellingRequests(
    userId: string,
    statusOrQuery?:
      | string
      | {
          status?: string;
          time?: string;
          fromDate?: string;
          toDate?: string;
          page?: string | number;
          limit?: string | number;
        },
    maybeQuery?: {
      time?: string;
      fromDate?: string;
      toDate?: string;
      page?: string | number;
      limit?: string | number;
    },
  ) {
    const scopeWhere = await this.getScopedCounsellingWhere(userId);

    let rawStatus: string | undefined;
    let queryOptions: {
      time?: string;
      fromDate?: string;
      toDate?: string;
      page?: string | number;
      limit?: string | number;
    } = {};

    if (typeof statusOrQuery === 'string') {
      rawStatus = statusOrQuery;
      queryOptions = maybeQuery || {};
    } else if (typeof statusOrQuery === 'object' && statusOrQuery !== null) {
      rawStatus = statusOrQuery.status;
      queryOptions = statusOrQuery;
    }

    let targetStatus: CounsellingStatus | undefined = undefined;
    if (rawStatus) {
      const upper = rawStatus.toUpperCase().trim();
      if (upper === 'REQUESTED' || upper === 'PENDING') {
        targetStatus = 'REQUESTED';
      } else if (upper === 'SCHEDULED') {
        targetStatus = 'SCHEDULED';
      } else if (upper === 'COMPLETED') {
        targetStatus = 'COMPLETED';
      }
    }

    // Date filtering on `requestedAt`
    let dateWhere: any = null;
    const rawTime = (queryOptions?.time || '').toLowerCase().trim();

    if (rawTime === 'today') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      dateWhere = { gte: startOfToday, lte: endOfToday };
    } else if (rawTime === 'yesterday') {
      const startOfYesterday = new Date();
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);
      const endOfYesterday = new Date(startOfYesterday);
      endOfYesterday.setHours(23, 59, 59, 999);
      dateWhere = { gte: startOfYesterday, lte: endOfYesterday };
    } else if (rawTime === 'last_7_days' || rawTime === '7days' || rawTime === 'week') {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateWhere = { gte: start, lte: end };
    } else if (rawTime === 'this_month' || rawTime === 'month') {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      dateWhere = { gte: startOfMonth, lte: endOfMonth };
    } else if (rawTime === 'custom' || queryOptions?.fromDate || queryOptions?.toDate) {
      let startCustom: Date | null = null;
      let endCustom: Date | null = null;

      if (queryOptions?.fromDate) {
        const fromStr = String(queryOptions.fromDate).trim();
        if (fromStr.includes('-') && !fromStr.includes('T')) {
          const parts = fromStr.split('-').map((p) => parseInt(p, 10));
          if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            startCustom = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
          }
        }
        if (!startCustom) {
          const parsedFrom = new Date(fromStr);
          if (!isNaN(parsedFrom.getTime())) {
            startCustom = new Date(parsedFrom.getFullYear(), parsedFrom.getMonth(), parsedFrom.getDate(), 0, 0, 0, 0);
          }
        }
      }

      if (queryOptions?.toDate) {
        const toStr = String(queryOptions.toDate).trim();
        if (toStr.includes('-') && !toStr.includes('T')) {
          const parts = toStr.split('-').map((p) => parseInt(p, 10));
          if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            endCustom = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
          }
        }
        if (!endCustom) {
          const parsedTo = new Date(toStr);
          if (!isNaN(parsedTo.getTime())) {
            endCustom = new Date(parsedTo.getFullYear(), parsedTo.getMonth(), parsedTo.getDate(), 23, 59, 59, 999);
          }
        }
      }

      if (startCustom && endCustom) {
        dateWhere = { gte: startCustom, lte: endCustom };
      } else if (startCustom) {
        dateWhere = { gte: startCustom };
      } else if (endCustom) {
        dateWhere = { lte: endCustom };
      }
    }

    const finalWhere: any = {
      ...scopeWhere,
      ...(targetStatus ? { status: targetStatus } : {}),
      ...(dateWhere ? { requestedAt: dateWhere } : {}),
    };

    const hasPagination =
      queryOptions?.page !== undefined || queryOptions?.limit !== undefined;

    if (!hasPagination) {
      return this.prisma.collegeCounsellingRequest.findMany({
        where: finalWhere,
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              city: true,
              state: true,
              courseInterested: true,
              courseInterestedOther: true,
            },
          },
          college: {
            select: {
              id: true,
              name: true,
              city: true,
              state: true,
            },
          },
          requestedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          scheduledBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          completedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { requestedAt: 'desc' },
      });
    }

    const page = Math.max(1, parseInt(String(queryOptions.page || 1), 10));
    const limit = Math.max(1, parseInt(String(queryOptions.limit || 10), 10));
    const skip = (page - 1) * limit;

    const [requests, totalCount] = await Promise.all([
      this.prisma.collegeCounsellingRequest.findMany({
        where: finalWhere,
        skip,
        take: limit,
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              city: true,
              state: true,
              courseInterested: true,
              courseInterestedOther: true,
            },
          },
          college: {
            select: {
              id: true,
              name: true,
              city: true,
              state: true,
            },
          },
          requestedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          scheduledBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          completedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { requestedAt: 'desc' },
      }),
      this.prisma.collegeCounsellingRequest.count({
        where: finalWhere,
      }),
    ]);

    return {
      data: requests,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
    };
  }
}
