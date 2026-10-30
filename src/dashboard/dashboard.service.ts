import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';

export interface AdmissionsDashboardFilters {
  startDate?: string;
  endDate?: string;
  collegeId?: string;
  course?: string;
  teamId?: string;
  employeeId?: string;
  source?: string;
  statusId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamLeadAuthService: TeamLeadAuthorizationService,
  ) { }

  private metadataCache: {
    timestamp: number;
    data: {
      colleges: any[];
      courses: any[];
      teams: any[];
      employees: any[];
      leadStatuses: any[];
    };
  } | null = null;

  private async getDashboardMetadata() {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const now = Date.now();
    if (
      this.metadataCache &&
      now - this.metadataCache.timestamp < CACHE_TTL_MS
    ) {
      return this.metadataCache.data;
    }

    const [colleges, courses, teams, employees, leadStatuses] =
      await Promise.all([
        this.prisma.college.findMany({
          select: { id: true, name: true, city: true, state: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.course.findMany({
          select: { id: true, name: true, collegeId: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.team.findMany({
          select: {
            id: true,
            name: true,
            manager: { select: { firstName: true, lastName: true } },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.user.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            teamId: true,
            team: { select: { name: true } },
          },
          orderBy: { firstName: 'asc' },
        }),
        this.prisma.leadStatus.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        }),
      ]);

    const data = { colleges, courses, teams, employees, leadStatuses };
    this.metadataCache = { timestamp: now, data };
    return data;
  }

  private async verifyUserRole(userId?: string, allowedRoles: string[] = []) {
    if (!userId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }

    const roleNameClean = (user.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    const isAllowed = allowedRoles.some((allowed) => {
      const allowedClean = allowed.toUpperCase().replace(/\s+/g, '_');
      return roleNameClean === allowedClean || roleNameClean.includes(allowedClean);
    });

    if (!isAllowed) {
      throw new ForbiddenException(
        `Access denied: Dashboard restricted to ${allowedRoles.join(', ')}`,
      );
    }

    return user;
  }

  async getHRDashboardStats(userId?: string) {
    await this.verifyUserRole(userId, ['HR', 'SUPER_ADMIN']);

    const [
      totalEmployees,
      positions,
      candidates,
      interviews,
      roles,
      recentCandidates,
      upcomingInterviews,
    ] = await Promise.all([
      // Total active users/employees
      this.prisma.user.count({
        where: { status: 'ACTIVE' },
      }),
      // Positions with candidate counts
      this.prisma.position.findMany({
        include: {
          _count: {
            select: { candidates: true },
          },
        },
      }),
      // All candidates
      this.prisma.candidate.findMany({
        include: {
          position: true,
        },
      }),
      // All interviews
      this.prisma.interview.findMany({
        include: {
          candidate: {
            include: { position: true },
          },
          interviewer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      // Roles with user count
      this.prisma.role.findMany({
        include: {
          _count: {
            select: { users: true },
          },
        },
      }),
      // Recent candidate applications
      this.prisma.candidate.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { position: true },
      }),
      // Upcoming interviews
      this.prisma.interview.findMany({
        take: 5,
        where: { status: 'SCHEDULED' },
        orderBy: { scheduledAt: 'asc' },
        include: {
          candidate: true,
          interviewer: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
    ]);

    // KPI Calculations
    const activePositions = positions.filter((p) => p.isActive);
    const totalVacancies = activePositions.reduce(
      (acc, p) => acc + p.vacancies,
      0,
    );
    const totalCandidates = candidates.length;
    const hiredCount = candidates.filter((c) => c.status === 'HIRED').length;
    const scheduledInterviews = interviews.filter(
      (i) => i.status === 'SCHEDULED',
    ).length;
    const hiringRate =
      totalCandidates > 0
        ? Math.round((hiredCount / totalCandidates) * 100)
        : 0;

    // Candidate Pipeline Stages
    const pipelineStages = [
      { status: 'APPLIED', label: 'Applied' },
      { status: 'SCREENING', label: 'Screening' },
      { status: 'INTERVIEW_SCHEDULED', label: 'Interview Scheduled' },
      { status: 'INTERVIEWED', label: 'Interviewed' },
      { status: 'SELECTED', label: 'Selected' },
      { status: 'HIRED', label: 'Hired' },
      { status: 'REJECTED', label: 'Rejected' },
    ];

    const candidatePipeline = pipelineStages.map((stage) => ({
      status: stage.status,
      label: stage.label,
      count: candidates.filter((c) => c.status === stage.status).length,
    }));

    // Department breakdown: Vacancies vs Applicants
    const departmentMap = new Map<
      string,
      { openPositions: number; vacancies: number; applicants: number }
    >();

    for (const pos of positions) {
      const existing = departmentMap.get(pos.department) || {
        openPositions: 0,
        vacancies: 0,
        applicants: 0,
      };
      if (pos.isActive) {
        existing.openPositions += 1;
        existing.vacancies += pos.vacancies;
      }
      existing.applicants += pos._count.candidates;
      departmentMap.set(pos.department, existing);
    }

    const departmentStats = Array.from(departmentMap.entries()).map(
      ([department, stats]) => ({
        department,
        ...stats,
      }),
    );

    // Interview Outcomes Distribution
    const interviewResultsMap = {
      PASSED: 0,
      FAILED: 0,
      ON_HOLD: 0,
      PENDING: 0,
    };
    for (const item of interviews) {
      if (item.result in interviewResultsMap) {
        interviewResultsMap[item.result] += 1;
      }
    }
    const interviewResults = [
      { result: 'Passed', count: interviewResultsMap.PASSED },
      { result: 'Pending', count: interviewResultsMap.PENDING },
      { result: 'On Hold', count: interviewResultsMap.ON_HOLD },
      { result: 'Failed', count: interviewResultsMap.FAILED },
    ];

    // Workforce Role Distribution
    const workforceRoles = roles.map((r) => ({
      role: r.name,
      count: r._count.users,
    }));

    return {
      kpis: {
        totalEmployees,
        openPositions: activePositions.length,
        totalVacancies,
        totalCandidates,
        scheduledInterviews,
        hiredCount,
        hiringRate,
      },
      candidatePipeline,
      departmentStats,
      interviewResults,
      workforceRoles,
      recentCandidates,
      upcomingInterviews,
    };
  }

  /**
   * Resolve start/end Date boundaries from a named period string or explicit ISO date strings.
   * All boundaries are calculated in UTC; the caller passes plain ISO dates (YYYY-MM-DD).
   */
  private resolveAdvisorDateRange(
    period?: string,
    startDateStr?: string,
    endDateStr?: string,
  ): { startDate: Date; endDate: Date } | null {
    const nowUtc = new Date();

    if (period === 'today') {
      const start = new Date(nowUtc);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(nowUtc);
      end.setUTCHours(23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    if (period === 'this_week') {
      const start = new Date(nowUtc);
      const day = start.getUTCDay(); // 0=Sun
      start.setUTCDate(start.getUTCDate() - day);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(nowUtc);
      end.setUTCHours(23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    if (period === 'this_month') {
      const start = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(nowUtc);
      end.setUTCHours(23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    if (period === 'custom' && startDateStr && endDateStr) {
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Invalid custom date range provided.');
      }
      if (start > end) {
        throw new BadRequestException('Start date must be before end date.');
      }
      // If only date strings (no time component) were supplied, cap end at 23:59:59.999
      if (endDateStr.length <= 10) {
        end.setUTCHours(23, 59, 59, 999);
      }
      return { startDate: start, endDate: end };
    }

    return null; // no filter → all-time
  }

  async getAdvisorDashboardStats(
    userId: string,
    startDateStr?: string,
    endDateStr?: string,
    period?: string,
  ) {
    await this.verifyUserRole(userId, [
      'PROGRAM_ADVISOR',
      'ADVISOR',
      'SALES',
      'SUPER_ADMIN',
    ]);

    // Resolve the active date range (null = no filter / all-time)
    const dateRange = this.resolveAdvisorDateRange(period, startDateStr, endDateStr);

    // For "today" default when no period is sent at all we still use startOfDay for callsCount
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Date filter for activity-based metrics (calls, pitches created, TPC assignments)
    const activityDateFilter = dateRange
      ? { gte: dateRange.startDate, lte: dateRange.endDate }
      : undefined;

    // Date filter for lead creation metrics
    const leadCreationDateFilter = dateRange
      ? { gte: dateRange.startDate, lte: dateRange.endDate }
      : undefined;

    const [allMyLeads, myPitches, myTpcs, allStatuses, callsPeriodCount] = await Promise.all([
      // All own assigned or created leads — pipeline breakdown always uses live status, not creation date
      this.prisma.lead.findMany({
        where: {
          OR: [
            { createdById: userId },
            {
              assignments: {
                some: {
                  userId,
                  status: 'ACTIVE',
                },
              },
            },
          ],
        },
        include: {
          status: true,
          collegeApplications: {
            include: {
              college: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),

      // Own pitched college applications, filtered by creation date when a period is active
      this.prisma.leadCollege.findMany({
        where: {
          pitchedById: userId,
          ...(activityDateFilter ? { createdAt: activityDateFilter } : {}),
        },
        include: {
          college: true,
          lead: true,
        },
      }),

      // TPC calls assigned to or created by this user, filtered by assignment date when active
      this.prisma.tPC.findMany({
        where: {
          assignments: {
            some: {
              AND: [
                {
                  OR: [
                    { assignedById: userId },
                    { assignedToId: userId },
                    { completedById: userId },
                  ],
                },
                ...(activityDateFilter
                  ? [{ createdAt: activityDateFilter }]
                  : []),
              ],
            },
          },
        },
        include: {
          assignments: true,
          lead: true,
        },
      }),

      // All lead status definitions
      this.prisma.leadStatus.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),

      // Calls count scoped to the active period (defaults to today when no period set)
      this.prisma.callRecord.count({
        where: {
          createdById: userId,
          createdAt: activityDateFilter ?? { gte: startOfDay },
        },
      }),
    ]);

    // For date-range KPIs: filter leads by creation date when a period is active
    const myLeads = leadCreationDateFilter
      ? allMyLeads.filter(
          (l) =>
            l.createdAt >= leadCreationDateFilter.gte &&
            l.createdAt <= leadCreationDateFilter.lte,
        )
      : allMyLeads;

    // KPI computations for this Advisor
    const totalLeads = myLeads.length;
    const admissionsDone = myLeads.filter(
      (l) => l.status?.name === 'ADMISSION_DONE',
    ).length;
    const inProgressApplications = myLeads.filter((l) =>
      [
        'APPLICATION',
        'INTERVIEW_SCHEDULED',
        'INTERVIEW_DONE',
        'LETTER_OUT',
      ].includes(l.status?.name || ''),
    ).length;
    const conversionRate =
      totalLeads > 0 ? Math.round((admissionsDone / totalLeads) * 100) : 0;

    const pitchesApproved = myPitches.filter(
      (p) => p.approvalStatus === 'APPROVED',
    ).length;
    const pitchesPending = myPitches.filter(
      (p) => p.approvalStatus === 'PENDING',
    ).length;
    const pitchesRejected = myPitches.filter(
      (p) => p.approvalStatus === 'REJECTED',
    ).length;

    const tpcsCompleted = myTpcs.filter((t) =>
      t.assignments.some((a) => a.status === 'COMPLETED'),
    ).length;
    const tpcsPending = myTpcs.filter(
      (t) => !t.assignments.some((a) => a.status === 'COMPLETED'),
    ).length;

    // Pipeline Stage Distribution — always reflects LIVE current status across all assigned leads
    // (not filtered by date), per the metric semantics requirement
    const pipelineBreakdown = allStatuses.map((st) => {
      const count = allMyLeads.filter((l) => l.statusId === st.id).length;
      const total = allMyLeads.length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    // Pitch Outcomes Breakdown
    const pitchOutcomes = [
      { status: 'Approved', count: pitchesApproved, color: '#10B981' },
      { status: 'Pending', count: pitchesPending, color: '#F59E0B' },
      { status: 'Rejected', count: pitchesRejected, color: '#EF4444' },
    ];

    // TPC Resolution Breakdown
    const tpcBreakdown = [
      { status: 'Completed', count: tpcsCompleted, color: '#10B981' },
      { status: 'Pending', count: tpcsPending, color: '#6366F1' },
    ];

    // Monthly Trend for last 6 months
    const monthlyTrendMap = new Map<
      string,
      { month: string; leads: number; admissions: number }
    >();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString('default', { month: 'short' });
      monthlyTrendMap.set(key, { month: key, leads: 0, admissions: 0 });
    }

    for (const lead of allMyLeads) {
      const leadDate = new Date(lead.createdAt);
      const monthKey = leadDate.toLocaleString('default', { month: 'short' });
      if (monthlyTrendMap.has(monthKey)) {
        const item = monthlyTrendMap.get(monthKey)!;
        item.leads += 1;
        if (lead.status?.name === 'ADMISSION_DONE') {
          item.admissions += 1;
        }
      }
    }
    const monthlyTrend = Array.from(monthlyTrendMap.values());

    // Top recent leads — always show the latest 5 regardless of period filter
    const recentLeads = allMyLeads.slice(0, 5);

    return {
      kpis: {
        totalLeads,
        admissionsDone,
        callsTodayCount: callsPeriodCount,
        inProgressApplications,
        conversionRate,
        pitchesTotal: myPitches.length,
        pitchesApproved,
        tpcsTotal: myTpcs.length,
        tpcsCompleted,
      },
      pipelineBreakdown,
      pitchOutcomes,
      tpcBreakdown,
      monthlyTrend,
      recentLeads,
    };
  }

  // Dynamic Manager Dashboard stats derived from real DB relationships
  async getManagerDashboardStats(
    userId: string,
    teamIdParam?: string,
    startDateStr?: string,
    endDateStr?: string,
    pipelinePeriod?: string,
    tpcPeriod?: string,
    memberPeriod?: string,
  ) {
    const callingUser = await this.verifyUserRole(userId, [
      'MANAGER',
      'SUPER_ADMIN',
      'TEAM_LEAD',
    ]);
    const isSuperAdminUser = callingUser?.role?.name
      ?.toUpperCase()
      .includes('SUPER_ADMIN');
    const isTeamLeadUser = await this.teamLeadAuthService.isTeamLead(userId);

    // 1. Get teams managed by current user (or all teams if Super Admin, or assigned teams if Team Lead)
    let managedTeams: Array<{ id: number; name: string; description: string | null; managerId: string }> = [];
    if (isSuperAdminUser) {
      managedTeams = await this.prisma.team.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          managerId: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    } else if (isTeamLeadUser) {
      const assignedTeamIds =
        await this.teamLeadAuthService.getTeamLeadAssignedTeamIds(userId);
      managedTeams = await this.prisma.team.findMany({
        where: { id: { in: assignedTeamIds }, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          managerId: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    } else {
      managedTeams = await this.prisma.team.findMany({
        where: { managerId: userId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          managerId: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    }

    // Determine target team IDs
    let targetTeamIds: number[] = [];

    if (teamIdParam && teamIdParam !== 'all') {
      const parsedId = parseInt(teamIdParam, 10);
      if (isNaN(parsedId)) {
        throw new BadRequestException('Invalid team ID provided.');
      }
      const isAuthorized = managedTeams.some((t) => t.id === parsedId);
      if (!isAuthorized) {
        throw new ForbiddenException('You do not have access to this team.');
      }
      targetTeamIds = [parsedId];
    } else {
      targetTeamIds = managedTeams.map((t) => t.id);
    }

    // 2. Fetch team members belonging to accessible target teams (including Manager/Head of Team)
    const targetTeams = managedTeams.filter((t) =>
      targetTeamIds.includes(t.id),
    );
    const targetManagerIds = targetTeams
      .map((t) => t.managerId)
      .filter(Boolean);

    let teamMembers: Array<any> = [];
    if (isTeamLeadUser) {
      const assignedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(
          userId,
          targetTeamIds.length === 1 ? targetTeamIds[0] : undefined,
        );
      const authorizedIds = Array.from(new Set([...assignedAdvisorIds, userId]));
      teamMembers = await this.prisma.user.findMany({
        where: {
          id: { in: authorizedIds },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          teamId: true,
          team: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          firstName: 'asc',
        },
      });
    } else {
      teamMembers =
        targetTeamIds.length > 0
          ? await this.prisma.user.findMany({
            where: {
              OR: [
                { teamId: { in: targetTeamIds } },
                { id: { in: targetManagerIds } },
              ],
              status: 'ACTIVE',
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              teamId: true,
              team: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              firstName: 'asc',
            },
          })
          : [];
    }

    const memberIds = teamMembers.map((m) => m.id);

    // 3. Setup date range boundaries
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (startDateStr) {
      startDate = new Date(startDateStr);
    }
    if (endDateStr) {
      endDate = new Date(endDateStr);
      if (endDateStr.length <= 10) {
        endDate.setHours(23, 59, 59, 999);
      }
    }

    // 4. Run database queries in smaller batched groups to prevent pooler connection drops
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      allLeadStatuses,
      assignedLeads,
      pendingPitches,
      todaysApplicationsPitches,
    ] = await Promise.all([
      // Lead statuses
      this.prisma.leadStatus.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),

      // Active lead assignments for team members
      this.prisma.leadAssignment.findMany({
        where: {
          userId: { in: memberIds },
          status: 'ACTIVE',
        },
        include: {
          lead: {
            include: {
              status: true,
              interactions: {
                select: { id: true, createdAt: true },
              },
            },
          },
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),

      // Pending pitches by team members
      this.prisma.leadCollege.findMany({
        where: {
          pitchedById: { in: memberIds },
          approvalStatus: 'PENDING',
        },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          college: { select: { id: true, name: true } },
          pitchedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),

      // Today's applications pitched by team members (unique student pitches)
      memberIds.length > 0
        ? this.prisma.leadCollege.findMany({
          where: {
            pitchedById: { in: memberIds },
            createdAt: {
              gte: startOfToday,
              lte: endOfToday,
            },
          },
          select: {
            leadId: true,
          },
        })
        : [],
    ]);

    const [tpcAssignments, interactions, activityLogs] = await Promise.all([
      // TPCUser assignments for team members
      this.prisma.tPCUser.findMany({
        where: {
          assignedToId: { in: memberIds },
          ...(startDate || endDate
            ? {
              assignedAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
            : {}),
        },
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
          tpc: {
            include: {
              lead: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),

      // Interactions logged by team members
      this.prisma.interaction.findMany({
        where: {
          createdById: { in: memberIds },
          ...(startDate || endDate
            ? {
              createdAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
            : {}),
        },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          lead: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),

      // Activity logs for team members
      this.prisma.activityLog.findMany({
        where: {
          userId: { in: memberIds },
          ...(startDate || endDate
            ? {
              createdAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
            : {}),
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const [todayAttendance, notifications, leadsTodayRecords, allTeamLeads] =
      await Promise.all([
        // Attendance records for today
        this.prisma.attendance.findMany({
          where: {
            userId: { in: memberIds },
            date: {
              gte: startOfToday,
              lte: endOfToday,
            },
          },
        }),

        // Notifications for the manager
        this.prisma.notificationRecipient.findMany({
          where: { userId },
          include: {
            notification: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),

        // Leads created/posted today by team members or assigned to team members today
        memberIds.length > 0
          ? this.prisma.lead.findMany({
            where: {
              OR: [
                { createdById: { in: memberIds } },
                { assignments: { some: { userId: { in: memberIds } } } },
              ],
              createdAt: {
                gte: startOfToday,
                lte: endOfToday,
              },
            },
            include: {
              status: true,
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              assignments: {
                where: { status: 'ACTIVE' },
                include: {
                  user: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
          : [],

        // All team leads (created by or assigned to team members + manager)
        memberIds.length > 0
          ? this.prisma.lead.findMany({
            where: {
              OR: [
                { createdById: { in: memberIds } },
                { assignments: { some: { userId: { in: memberIds } } } },
              ],
            },
            include: {
              status: true,
              interactions: {
                select: { id: true, createdAt: true },
              },
            },
          })
          : [],
      ]);

    // Query calls today and active data assignments for team member call performance
    const callsTodayRecords: Array<{ id: string; outcome: string | null; createdById: string }> =
      memberIds.length > 0
        ? await this.prisma.callRecord.findMany({
          where: {
            createdById: { in: memberIds },
            createdAt: {
              gte: startOfToday,
              lte: endOfToday,
            },
          },
          select: {
            id: true,
            outcome: true,
            createdById: true,
          },
        })
        : [];

    const activeDataAssignments: Array<{ assignedToId: string; _count: { items: number } | null }> =
      memberIds.length > 0
        ? await this.prisma.dataAssignment.findMany({
          where: {
            status: 'ACTIVE',
            assignedToId: { in: memberIds },
          },
          select: {
            assignedToId: true,
            _count: { select: { items: true } },
          },
        })
        : [];

    const assignedDataMap = new Map<string, number>();
    for (const da of activeDataAssignments) {
      const count = assignedDataMap.get(da.assignedToId) || 0;
      assignedDataMap.set(da.assignedToId, count + (da._count?.items || 0));
    }

    const advisorPerformance = teamMembers.map((adv) => {
      const advName = `${adv.firstName} ${adv.lastName || ''}`.trim();
      const advCalls = callsTodayRecords.filter((c) => c.createdById === adv.id);
      const advCallsToday = advCalls.length;

      let advAnsweredCalls = 0;
      let advNotAnsweredCalls = 0;

      for (const c of advCalls) {
        const outcomeStr = String(c.outcome || '').toUpperCase();
        if (
          outcomeStr === 'NOT_INTERESTED' ||
          outcomeStr === 'FOLLOW_UP' ||
          outcomeStr === 'CALL_BACK_LATER' ||
          outcomeStr === 'INTERESTED' ||
          outcomeStr === 'FOLLOW_UP_REQUIRED' ||
          outcomeStr === 'OTHER'
        ) {
          advAnsweredCalls++;
        } else if (
          outcomeStr === 'NO_ANSWER' ||
          outcomeStr === 'WRONG_NUMBER' ||
          outcomeStr === 'DISCONNECTED'
        ) {
          advNotAnsweredCalls++;
        }
      }

      const advAssignedData = assignedDataMap.get(adv.id) || 0;

      return {
        userId: adv.id,
        advisorName: advName,
        teamName: adv.team?.name || 'Unassigned',
        teamId: adv.teamId || null,
        assignedDataCount: advAssignedData,
        callsCount: advCallsToday,
        answeredCallsCount: advAnsweredCalls,
        notAnsweredCallsCount: advNotAnsweredCalls,
      };
    });

    // 5. Deduplicate unique team leads (Manager + Team Members)
    const leadMap = new Map<string, any>();
    for (const assignment of assignedLeads) {
      if (assignment.lead && !leadMap.has(assignment.lead.id)) {
        leadMap.set(assignment.lead.id, assignment.lead);
      }
    }
    for (const leadRec of allTeamLeads) {
      if (!leadMap.has(leadRec.id)) {
        leadMap.set(leadRec.id, leadRec);
      }
    }
    const uniqueLeads = Array.from(leadMap.values());

    // Format list of leads posted today by team members
    const leadsTodayList = leadsTodayRecords.map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      phone: l.phone,
      email: l.email,
      city: l.city,
      source: l.source,
      courseInterested: l.courseInterested,
      createdAt: l.createdAt.toISOString(),
      statusName: l.status?.name || 'LEAD',
      statusColor: l.status?.color || 'blue',
      postedBy: `${l.createdBy.firstName} ${l.createdBy.lastName || ''}`.trim(),
      assignedTo: l.assignments[0]
        ? `${l.assignments[0].user.firstName} ${l.assignments[0].user.lastName || ''}`.trim()
        : null,
    }));

    // 6. Overview KPI Metrics
    const totalTeams = managedTeams.length;
    const totalMembers = teamMembers.length;
    const totalLeads = uniqueLeads.length;
    const totalTpcs = tpcAssignments.length;
    const pendingTpcsCount = tpcAssignments.filter(
      (t) => t.status === 'PENDING',
    ).length;
    const pendingPitchesCount = pendingPitches.length;
    const pendingActions = pendingTpcsCount + pendingPitchesCount;

    // Calculate the 4 manager dashboard overview metrics
    const uniqueLeadsTodayMap = new Map<
      string,
      (typeof leadsTodayRecords)[0]
    >();
    for (const record of leadsTodayRecords) {
      if (!uniqueLeadsTodayMap.has(record.id)) {
        uniqueLeadsTodayMap.set(record.id, record);
      }
    }
    const uniqueLeadsTodayList = Array.from(uniqueLeadsTodayMap.values());
    const leadsToday = uniqueLeadsTodayList.length;

    // Today's Applications: UNIQUE STUDENTS with application activity today
    const todaysApplications = new Set(
      Array.isArray(todaysApplicationsPitches)
        ? todaysApplicationsPitches.map((p) => p.leadId)
        : [],
    ).size;

    const monthlyConversions = uniqueLeads.filter((l) => {
      if (l.status?.name !== 'ADMISSION_DONE') return false;
      const uDate = new Date(l.updatedAt);
      return uDate >= startOfMonth;
    }).length;

    const ongoingProcessStatuses = [
      'APPLICATION',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_DONE',
      'LETTER_OUT',
    ];
    const ongoingProcesses = uniqueLeads.filter((l) =>
      ongoingProcessStatuses.includes(l.status?.name || ''),
    ).length;

    const letterOutToday = uniqueLeads.filter((l) => {
      const sName = (l.status?.name || '').toUpperCase();
      if (sName !== 'LETTER_OUT') return false;
      const cDate = new Date(l.createdAt).toDateString();
      const uDate = new Date(l.updatedAt || l.createdAt).toDateString();
      const todayDate = new Date().toDateString();
      return cDate === todayDate || uDate === todayDate;
    }).length;

    const interviewScheduledToday = uniqueLeads.filter((l) => {
      const sName = (l.status?.name || '').toUpperCase();
      if (sName !== 'INTERVIEW_SCHEDULED') return false;
      const cDate = new Date(l.createdAt).toDateString();
      const uDate = new Date(l.updatedAt || l.createdAt).toDateString();
      const todayDate = new Date().toDateString();
      return cDate === todayDate || uDate === todayDate;
    }).length;

    // 7. Team Performance Comparison (Manager is included as a member of their team)
    const teamPerformance = managedTeams
      .filter((t) => targetTeamIds.includes(t.id))
      .map((team) => {
        const membersInTeam = teamMembers.filter(
          (m) => m.teamId === team.id || m.id === team.managerId,
        );
        const memberIdsInTeam = membersInTeam.map((m) => m.id);

        const leadsInTeam = assignedLeads.filter((a) =>
          memberIdsInTeam.includes(a.userId),
        );
        // Unique leads/students in team
        const uniqueLeadsInTeamMap = new Map<
          string,
          (typeof assignedLeads)[0]['lead']
        >();
        for (const a of leadsInTeam) {
          if (a.lead && !uniqueLeadsInTeamMap.has(a.leadId)) {
            uniqueLeadsInTeamMap.set(a.leadId, a.lead);
          }
        }
        const uniqueLeadsInTeam = Array.from(uniqueLeadsInTeamMap.values());

        const contactedLeadsInTeam = uniqueLeadsInTeam.filter(
          (l) => l.interactions && l.interactions.length > 0,
        ).length;

        const convertedLeadsInTeam = uniqueLeadsInTeam.filter(
          (l) => l.status?.name === 'ADMISSION_DONE',
        ).length;

        const tpcsInTeam = tpcAssignments.filter((t) =>
          memberIdsInTeam.includes(t.assignedToId),
        );
        const pendingTpcs = tpcsInTeam.filter(
          (t) => t.status === 'PENDING',
        ).length;
        const completedTpcs = tpcsInTeam.filter(
          (t) => t.status === 'COMPLETED',
        ).length;

        return {
          teamId: team.id,
          teamName: team.name,
          description: team.description,
          memberCount: membersInTeam.length,
          assignedLeadsCount: uniqueLeadsInTeam.length,
          contactedLeadsCount: contactedLeadsInTeam,
          convertedLeadsCount: convertedLeadsInTeam,
          pendingTpcsCount: pendingTpcs,
          completedTpcsCount: completedTpcs,
        };
      });

    // 8. Lead Pipeline Breakdown (Period-filtered unique leads)
    const now = new Date();
    let pStartDate: Date | null = null;
    let pEndDate: Date | null = null;

    const requestedPipelinePeriod = (pipelinePeriod || 'today').toLowerCase();

    if (requestedPipelinePeriod === 'today') {
      pStartDate = new Date(now);
      pStartDate.setHours(0, 0, 0, 0);
      pEndDate = new Date(now);
      pEndDate.setHours(23, 59, 59, 999);
    } else if (requestedPipelinePeriod === 'week') {
      pStartDate = new Date(now);
      pStartDate.setDate(now.getDate() - 7);
      pStartDate.setHours(0, 0, 0, 0);
      pEndDate = new Date(now);
      pEndDate.setHours(23, 59, 59, 999);
    } else if (requestedPipelinePeriod === 'month') {
      pStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      pStartDate.setHours(0, 0, 0, 0);
      pEndDate = new Date(now);
      pEndDate.setHours(23, 59, 59, 999);
    }

    let pipelineUniqueLeads = uniqueLeads;
    if (pStartDate || pEndDate) {
      pipelineUniqueLeads = uniqueLeads.filter((l) => {
        const cDate = new Date(l.createdAt);
        const uDate = new Date(l.updatedAt);
        if (pStartDate && cDate < pStartDate && uDate < pStartDate)
          return false;
        if (pEndDate && cDate > pEndDate && uDate > pEndDate) return false;
        return true;
      });
    }

    const totalPipelineLeads = pipelineUniqueLeads.length;

    const leadPipeline = allLeadStatuses.map((st) => {
      const count = pipelineUniqueLeads.filter(
        (l) => l.statusId === st.id,
      ).length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage:
          totalPipelineLeads > 0
            ? Math.round((count / totalPipelineLeads) * 100)
            : 0,
      };
    });

    // 9. Member Performance & Distribution (Period filtered)
    const requestedMemberPeriod = (memberPeriod || 'today').toLowerCase();
    let mStartDate: Date | null = null;
    let mEndDate: Date | null = null;

    if (requestedMemberPeriod === 'today') {
      mStartDate = new Date(now);
      mStartDate.setHours(0, 0, 0, 0);
      mEndDate = new Date(now);
      mEndDate.setHours(23, 59, 59, 999);
    } else if (requestedMemberPeriod === 'week') {
      mStartDate = new Date(now);
      mStartDate.setDate(now.getDate() - 7);
      mStartDate.setHours(0, 0, 0, 0);
      mEndDate = new Date(now);
      mEndDate.setHours(23, 59, 59, 999);
    } else if (requestedMemberPeriod === 'month') {
      mStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      mStartDate.setHours(0, 0, 0, 0);
      mEndDate = new Date(now);
      mEndDate.setHours(23, 59, 59, 999);
    }

    const rawMemberPerformance = teamMembers.map((member) => {
      // Collect leads assigned to or created by this member (including manager)
      const memberLeadItems: any[] = [];
      for (const a of assignedLeads) {
        if (a.userId === member.id && a.lead) {
          memberLeadItems.push({
            lead: a.lead,
            timestamp: a.assignedAt || a.createdAt,
          });
        }
      }
      for (const l of allTeamLeads) {
        if (l.createdById === member.id) {
          memberLeadItems.push({ lead: l, timestamp: l.createdAt });
        }
      }

      // Filter leads by date range if specified
      const filteredMemberLeads = memberLeadItems.filter((item) => {
        if (!mStartDate || !mEndDate) return true;
        const cDate = new Date(item.lead.createdAt);
        const uDate = new Date(item.lead.updatedAt || item.lead.createdAt);
        const tDate = new Date(item.timestamp);
        return (
          (cDate >= mStartDate && cDate <= mEndDate) ||
          (uDate >= mStartDate && uDate <= mEndDate) ||
          (tDate >= mStartDate && tDate <= mEndDate)
        );
      });

      // Deduplicate unique student/lead records (1 student = 1 count)
      const uniqueMemberLeadsMap = new Map<string, any>();
      for (const item of filteredMemberLeads) {
        if (item.lead && !uniqueMemberLeadsMap.has(item.lead.id)) {
          uniqueMemberLeadsMap.set(item.lead.id, item.lead);
        }
      }
      const uniqueMemberLeads = Array.from(uniqueMemberLeadsMap.values());

      const assignedLeadsCount = uniqueMemberLeads.length;

      // Conversions: unique leads that reached ADMISSION_DONE status
      const convertedLeadsCount = uniqueMemberLeads.filter((l) => {
        if (l.status?.name !== 'ADMISSION_DONE') return false;
        if (!mStartDate || !mEndDate) return true;
        const uDate = new Date(l.updatedAt || l.createdAt);
        return uDate >= mStartDate && uDate <= mEndDate;
      }).length;

      // TPC Assigned & TPC Attempted for member in memberPeriod
      const memberTpcsAll = tpcAssignments.filter(
        (t) => t.assignedToId === member.id,
      );
      const filteredMemberTpcs = memberTpcsAll.filter((t) => {
        if (!mStartDate || !mEndDate) return true;
        const tDate = new Date(t.assignedAt || t.createdAt);
        return tDate >= mStartDate && tDate <= mEndDate;
      });

      const tpcAssignedCount = filteredMemberTpcs.length;

      // TPC Attempted: TPCs where action was taken / attempted (status !== PENDING)
      const tpcAttemptedCount = filteredMemberTpcs.filter((t) => {
        if (t.status === 'PENDING') return false;
        if (!mStartDate || !mEndDate) return true;
        const actionDate = new Date(
          t.completedAt || t.assignedAt || t.createdAt,
        );
        return actionDate >= mStartDate && actionDate <= mEndDate;
      }).length;

      const pendingTpcsCount = filteredMemberTpcs.filter(
        (t) => t.status === 'PENDING',
      ).length;

      // Interactions / Total Calls logged in memberPeriod
      const memberInteractions = interactions.filter((i) => {
        if (i.createdById !== member.id) return false;
        if (!mStartDate || !mEndDate) return true;
        const iDate = new Date(i.createdAt);
        return iDate >= mStartDate && iDate <= mEndDate;
      });

      const totalCallsCount = memberInteractions.length;

      // Member activity logs in memberPeriod
      const memberLogs = activityLogs.filter((a) => {
        if (a.userId !== member.id) return false;
        if (!mStartDate || !mEndDate) return true;
        const aDate = new Date(a.createdAt);
        return aDate >= mStartDate && aDate <= mEndDate;
      });

      const timestamps = [
        ...memberInteractions.map((i) => new Date(i.createdAt).getTime()),
        ...memberLogs.map((l) => new Date(l.createdAt).getTime()),
      ];

      let lastActivityAt: string | null = null;
      if (timestamps.length > 0) {
        lastActivityAt = new Date(Math.max(...timestamps)).toISOString();
      } else {
        // Fallback to overall latest activity timestamp if no activity in period
        const overallInteractions = interactions.filter(
          (i) => i.createdById === member.id,
        );
        const overallLogs = activityLogs.filter((a) => a.userId === member.id);
        const overallTimestamps = [
          ...overallInteractions.map((i) => new Date(i.createdAt).getTime()),
          ...overallLogs.map((l) => new Date(l.createdAt).getTime()),
        ];
        if (overallTimestamps.length > 0) {
          lastActivityAt = new Date(
            Math.max(...overallTimestamps),
          ).toISOString();
        }
      }

      const memberTeamName =
        member.team?.name ||
        managedTeams.find((t) => t.managerId === member.id)?.name ||
        'Unassigned';

      // DONE indicator: Member completed activity (has calls or attempted TPCs or assigned leads, and no pending TPCs)
      const isDone =
        (totalCallsCount > 0 ||
          tpcAttemptedCount > 0 ||
          assignedLeadsCount > 0) &&
        pendingTpcsCount === 0;

      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        teamName: memberTeamName,
        assignedLeadsCount,
        convertedLeadsCount,
        tpcAssignedCount,
        tpcAttemptedCount,
        tpcsCount: tpcAssignedCount,
        totalCallsCount,
        interactionsCount: totalCallsCount,
        lastActivityAt,
        isDone,
      };
    });

    // Default sorting: Highest LEADS first, then highest TOTAL CALLS, then member name ascending
    const memberPerformance = [...rawMemberPerformance].sort((a, b) => {
      if (b.assignedLeadsCount !== a.assignedLeadsCount) {
        return b.assignedLeadsCount - a.assignedLeadsCount;
      }
      if (b.totalCallsCount !== a.totalCallsCount) {
        return b.totalCallsCount - a.totalCallsCount;
      }
      return a.firstName.localeCompare(b.firstName);
    });

    // 10. TPC Overview (Period-filtered TPC record count)
    const requestedTpcPeriod = (tpcPeriod || 'today').toLowerCase();
    let tStartDate: Date | null = null;
    let tEndDate: Date | null = null;

    if (requestedTpcPeriod === 'today') {
      tStartDate = new Date(now);
      tStartDate.setHours(0, 0, 0, 0);
      tEndDate = new Date(now);
      tEndDate.setHours(23, 59, 59, 999);
    } else if (requestedTpcPeriod === 'week') {
      tStartDate = new Date(now);
      tStartDate.setDate(now.getDate() - 7);
      tStartDate.setHours(0, 0, 0, 0);
      tEndDate = new Date(now);
      tEndDate.setHours(23, 59, 59, 999);
    } else if (requestedTpcPeriod === 'month') {
      tStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      tStartDate.setHours(0, 0, 0, 0);
      tEndDate = new Date(now);
      tEndDate.setHours(23, 59, 59, 999);
    }

    let filteredTpcAssignments = tpcAssignments;
    if (tStartDate || tEndDate) {
      filteredTpcAssignments = tpcAssignments.filter((t) => {
        const assignedDate = new Date(t.assignedAt);
        if (tStartDate && assignedDate < tStartDate) return false;
        if (tEndDate && assignedDate > tEndDate) return false;
        return true;
      });
    }

    const tpcStatusCounts = {
      PENDING: filteredTpcAssignments.filter((t) => t.status === 'PENDING')
        .length,
      COMPLETED: filteredTpcAssignments.filter((t) => t.status === 'COMPLETED')
        .length,
      NO_REPLY: filteredTpcAssignments.filter((t) => t.status === 'NO_REPLY')
        .length,
      NOT_INTERESTED: filteredTpcAssignments.filter(
        (t) => t.status === 'NOT_INTERESTED',
      ).length,
      CANCELLED: filteredTpcAssignments.filter((t) => t.status === 'CANCELLED')
        .length,
    };

    const tpcByMember = teamMembers.map((m) => {
      const memberTpcs = tpcAssignments.filter((t) => t.assignedToId === m.id);
      return {
        memberId: m.id,
        name: `${m.firstName} ${m.lastName || ''}`.trim(),
        pendingCount: memberTpcs.filter((t) => t.status === 'PENDING').length,
        completedCount: memberTpcs.filter((t) => t.status === 'COMPLETED')
          .length,
      };
    });

    // 11. Attention Required Alerts
    const uncontactedLeads = assignedLeads
      .filter((a) => a.lead.interactions.length === 0)
      .map((a) => ({
        id: a.lead.id,
        name: `${a.lead.firstName} ${a.lead.lastName || ''}`.trim(),
        assignedTo: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
      }));

    const pendingTpcList = tpcAssignments
      .filter((t) => t.status === 'PENDING')
      .map((t) => ({
        id: t.id,
        leadName: t.tpc.lead
          ? `${t.tpc.lead.firstName} ${t.tpc.lead.lastName || ''}`.trim()
          : 'Lead',
        assignedTo:
          `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim(),
        assignedAt: t.assignedAt,
      }));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const inactiveMembers = memberPerformance
      .filter(
        (m) => !m.lastActivityAt || new Date(m.lastActivityAt) < sevenDaysAgo,
      )
      .map((m) => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName || ''}`.trim(),
        lastActivityAt: m.lastActivityAt,
      }));

    // 12. Attendance Summary for Today
    const presentCount = todayAttendance.filter(
      (a) => a.status === 'PRESENT',
    ).length;
    const absentCount = todayAttendance.filter(
      (a) => a.status === 'ABSENT',
    ).length;
    const halfDayCount = todayAttendance.filter(
      (a) => a.status === 'HALF_DAY',
    ).length;
    const leaveCount = todayAttendance.filter(
      (a) => a.status === 'LEAVE',
    ).length;
    const unmarkedCount =
      teamMembers.length -
      (presentCount + absentCount + halfDayCount + leaveCount);

    // 13. Recent Activity Feed
    const combinedActivity = [
      ...interactions.map((i) => ({
        id: i.id,
        type: 'INTERACTION' as const,
        actor: `${i.createdBy.firstName} ${i.createdBy.lastName || ''}`.trim(),
        description: `Logged interaction for lead "${i.lead.firstName} ${i.lead.lastName || ''}": ${i.description.slice(0, 60)}...`,
        createdAt: i.createdAt,
      })),
      ...activityLogs.map((a) => ({
        id: a.id,
        type: 'ACTIVITY_LOG' as const,
        actor: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
        description: a.description || `${a.activity} on ${a.entityType}`,
        createdAt: a.createdAt,
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 15);

    // 14. Notifications Summary
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return {
      managedTeams,
      selectedTeamId: teamIdParam || 'all',
      overview: {
        totalTeams,
        totalMembers,
        totalLeads,
        totalTpcs,
        pendingActions,
        leadsToday,
        monthlyConversions,
        todaysApplications,
        ongoingProcesses,
        letterOutToday,
        interviewScheduledToday,
      },
      leadsTodayList,
      teamPerformance,
      leadPipeline,
      memberPerformance,
      advisorPerformance,
      tpcOverview: {
        byStatus: tpcStatusCounts,
        byMember: tpcByMember,
      },
      attentionRequired: {
        uncontactedLeadsCount: uncontactedLeads.length,
        uncontactedLeads: uncontactedLeads.slice(0, 5),
        pendingTpcsCount: pendingTpcList.length,
        pendingTpcs: pendingTpcList.slice(0, 5),
        pendingPitchesCount: pendingPitches.length,
        pendingPitches: pendingPitches.slice(0, 5).map((p) => ({
          id: p.id,
          leadName: `${p.lead.firstName} ${p.lead.lastName || ''}`.trim(),
          collegeName: p.college.name,
          pitchedBy:
            `${p.pitchedBy.firstName} ${p.pitchedBy.lastName || ''}`.trim(),
        })),
        inactiveMembersCount: inactiveMembers.length,
        inactiveMembers,
      },
      attendance: {
        present: presentCount,
        absent: absentCount,
        halfDay: halfDayCount,
        leave: leaveCount,
        unmarked: Math.max(0, unmarkedCount),
      },
      recentActivity: combinedActivity,
      notifications: {
        unreadCount,
        items: notifications.map((n) => ({
          id: n.id,
          title: n.notification.title,
          message: n.notification.message,
          isRead: n.isRead,
          createdAt: n.createdAt,
        })),
      },
    };
  }

  // System-wide Super Admin Dashboard Aggregation using real DB relationships
  async getSuperAdminDashboardStats(
    userId?: string,
    startDateStr?: string,
    endDateStr?: string,
    pageParam: number = 1,
    limitParam: number = 10,
    callTimeParam?: string,
    callTimingParam?: string,
  ) {
    await this.verifyUserRole(userId, ['SUPER_ADMIN']);

    const page = Math.max(1, Number(pageParam) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitParam) || 10));
    const skip = (page - 1) * limit;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let dateFilter: { gte?: Date; lte?: Date } | undefined = {
      gte: startOfToday,
      lte: endOfToday,
    };

    if (startDateStr === 'all' || startDateStr === 'ALL') {
      dateFilter = undefined;
    } else if (startDateStr || endDateStr) {
      dateFilter = {};
      if (startDateStr) {
        const s = new Date(startDateStr);
        if (!isNaN(s.getTime())) {
          s.setHours(0, 0, 0, 0);
          dateFilter.gte = s;
        }
      }
      if (endDateStr) {
        const e = new Date(endDateStr);
        if (!isNaN(e.getTime())) {
          e.setHours(23, 59, 59, 999);
          dateFilter.lte = e;
        }
      }
    }

    let callRecordDateFilter: any = dateFilter ? { createdAt: dateFilter } : {};

    // Resolve Call Timing and Hourly Call Time filters
    const normTiming = (callTimingParam || '').toUpperCase().trim();
    const normCallTime = (callTimeParam || '').trim();

    let timingConfig: { startHour: number; startMin: number; endHour: number; endMin: number } | null = null;
    let isHourlyOnly = false;

    // Check if Call Timing specifies Pre-Lunch or Post-Lunch
    if (
      normTiming === 'PRE_LUNCH' ||
      normTiming === 'PRE-LUNCH' ||
      normTiming === 'PRELUNCH' ||
      normTiming === '10:00-14:00'
    ) {
      timingConfig = { startHour: 10, startMin: 0, endHour: 14, endMin: 0 };
    } else if (
      normTiming === 'POST_LUNCH' ||
      normTiming === 'POST-LUNCH' ||
      normTiming === 'POSTLUNCH' ||
      normTiming === '14:30-19:00'
    ) {
      timingConfig = { startHour: 14, startMin: 30, endHour: 19, endMin: 0 };
    } else if (normTiming === 'ALL' || normTiming === 'ALL_DAY' || normTiming === '10:00-19:00') {
      timingConfig = null; // Retain existing working-hours behaviour
    } else if (
      normCallTime.toUpperCase() === 'PRE_LUNCH' ||
      normCallTime.toUpperCase() === 'PRE-LUNCH' ||
      normCallTime === '10:00-14:00'
    ) {
      // Fallback: If passed via callTimeParam
      timingConfig = { startHour: 10, startMin: 0, endHour: 14, endMin: 0 };
    } else if (
      normCallTime.toUpperCase() === 'POST_LUNCH' ||
      normCallTime.toUpperCase() === 'POST-LUNCH' ||
      normCallTime === '14:30-19:00'
    ) {
      // Fallback: If passed via callTimeParam
      timingConfig = { startHour: 14, startMin: 30, endHour: 19, endMin: 0 };
    }

    // Check hourly parameter (e.g. 10:00-11:00)
    let hourlyConfig: { startHour: number; startMin: number; endHour: number; endMin: number } | null = null;
    if (
      normCallTime &&
      normCallTime !== 'ALL' &&
      normCallTime !== 'all' &&
      normCallTime.toUpperCase() !== 'PRE_LUNCH' &&
      normCallTime.toUpperCase() !== 'POST_LUNCH'
    ) {
      const match = normCallTime.match(/^(\d{2}):00-(\d{2}):00$/);
      if (match) {
        hourlyConfig = {
          startHour: parseInt(match[1], 10),
          startMin: 0,
          endHour: parseInt(match[2], 10),
          endMin: 0,
        };
      }
    }

    // Determine effective time window
    let effectiveTime: { startHour: number; startMin: number; endHour: number; endMin: number; useLte: boolean } | null = null;

    if (timingConfig && hourlyConfig) {
      const timingStart = timingConfig.startHour * 60 + timingConfig.startMin;
      const timingEnd = timingConfig.endHour * 60 + timingConfig.endMin;
      const hourlyStart = hourlyConfig.startHour * 60 + hourlyConfig.startMin;
      const hourlyEnd = hourlyConfig.endHour * 60 + hourlyConfig.endMin;

      const effStart = Math.max(timingStart, hourlyStart);
      const effEnd = Math.min(timingEnd, hourlyEnd);

      if (effStart < effEnd) {
        effectiveTime = {
          startHour: Math.floor(effStart / 60),
          startMin: effStart % 60,
          endHour: Math.floor(effEnd / 60),
          endMin: effEnd % 60,
          useLte: true,
        };
      } else {
        effectiveTime = {
          startHour: 0,
          startMin: 0,
          endHour: 0,
          endMin: 0,
          useLte: false,
        };
      }
    } else if (timingConfig) {
      effectiveTime = {
        ...timingConfig,
        useLte: true,
      };
    } else if (hourlyConfig) {
      effectiveTime = {
        ...hourlyConfig,
        useLte: false,
      };
      isHourlyOnly = true;
    }

    if (effectiveTime) {
      if (
        effectiveTime.startHour === 0 &&
        effectiveTime.endHour === 0 &&
        effectiveTime.startMin === 0 &&
        effectiveTime.endMin === 0 &&
        !effectiveTime.useLte
      ) {
        callRecordDateFilter = {
          id: '__NO_MATCH_CALL_WINDOW__',
        };
      } else {
        let baseStart: Date;
        let baseEnd: Date;

        if (dateFilter?.gte && dateFilter?.lte) {
          baseStart = new Date(dateFilter.gte);
          baseEnd = new Date(dateFilter.lte);
        } else if (dateFilter?.gte) {
          baseStart = new Date(dateFilter.gte);
          baseEnd = new Date(dateFilter.gte);
        } else {
          baseStart = new Date(startOfToday);
          baseEnd = new Date(endOfToday);
        }

        const isSameDay =
          baseStart.getFullYear() === baseEnd.getFullYear() &&
          baseStart.getMonth() === baseEnd.getMonth() &&
          baseStart.getDate() === baseEnd.getDate();

        if (isSameDay) {
          const callStart = new Date(baseStart);
          callStart.setHours(effectiveTime.startHour, effectiveTime.startMin, 0, 0);

          const callEnd = new Date(baseEnd);
          callEnd.setHours(effectiveTime.endHour, effectiveTime.endMin, 0, 0);

          callRecordDateFilter = {
            createdAt: effectiveTime.useLte
              ? { gte: callStart, lte: callEnd }
              : { gte: callStart, lt: callEnd },
          };
        } else {
          const dayConditions: any[] = [];
          const currentDay = new Date(baseStart);
          currentDay.setHours(0, 0, 0, 0);
          const finalDay = new Date(baseEnd);
          finalDay.setHours(23, 59, 59, 999);

          let iterations = 0;
          while (currentDay <= finalDay && iterations < 90) {
            const dayStart = new Date(currentDay);
            dayStart.setHours(effectiveTime.startHour, effectiveTime.startMin, 0, 0);

            const dayEnd = new Date(currentDay);
            dayEnd.setHours(effectiveTime.endHour, effectiveTime.endMin, 0, 0);

            dayConditions.push({
              createdAt: effectiveTime.useLte
                ? { gte: dayStart, lte: dayEnd }
                : { gte: dayStart, lt: dayEnd },
            });

            currentDay.setDate(currentDay.getDate() + 1);
            iterations++;
          }

          if (dayConditions.length === 1) {
            callRecordDateFilter = dayConditions[0];
          } else if (dayConditions.length > 1) {
            callRecordDateFilter = { OR: dayConditions };
          }
        }
      }
    }

    const [
      allTeams,
      allAdvisors,
      leadsTodayRecords,
      todaysInteractions,
      todaysTpcUsers,
      todaysInterviews,
      todaysLetterOutLeads,
      todaysAdmissionsDueLeads,
      allLeadStatuses,
      totalLeadsCount,
      allLeadsForPipeline,
      availableStudentDataCount,
      dataUploadedTodayCount,
      expiredDataAssignmentCount,
      activeDataAssignmentCount,
      pendingTpcUsersCount,
      todayAttendances,
      allActiveUsers,
      recentActivityLogs,
      activeDataAssignments,
      admissionDoneLeads,
      allCallRecordsForStats,
      paginatedCallRecords,
      callRecordsTotalCount,
    ] = await Promise.all([
      // 1. All active teams with manager and members (users)
      this.prisma.team.findMany({
        where: { isActive: true },
        include: {
          manager: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          users: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { name: 'asc' },
      }),

      // 2. All active advisors, callers, team leads, or any user with assigned data or call activity
      this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { role: { name: { contains: 'Advisor', mode: 'insensitive' } } },
            { role: { name: { contains: 'Sales', mode: 'insensitive' } } },
            { role: { name: { contains: 'Counselor', mode: 'insensitive' } } },
            { role: { name: { contains: 'Counsellor', mode: 'insensitive' } } },
            { role: { name: { contains: 'Executive', mode: 'insensitive' } } },
            { role: { name: { contains: 'Caller', mode: 'insensitive' } } },
            { role: { name: { contains: 'Telecaller', mode: 'insensitive' } } },
            { role: { name: { contains: 'Lead', mode: 'insensitive' } } },
            { assignedDataAssignments: { some: { status: 'ACTIVE' } } },
            { callRecordsCreated: { some: {} } },
            { createdInteractions: { some: {} } },
          ],
        },

        include: {
          team: {
            select: {
              id: true,
              name: true,
              manager: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          role: { select: { id: true, name: true } },
        },
        orderBy: { firstName: 'asc' },
      }),

      // 3. Leads created
      this.prisma.lead.findMany({
        where: dateFilter ? { createdAt: dateFilter } : {},
        include: {
          status: true,
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                      manager: {
                        select: { id: true, firstName: true, lastName: true },
                      },
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
          interactions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 4. Interactions logged
      this.prisma.interaction.findMany({
        where: dateFilter ? { createdAt: dateFilter } : {},
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  manager: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 5. TPCs assigned or completed today
      this.prisma.tPCUser.findMany({
        where: {
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              team: { select: { id: true, name: true } },
            },
          },
          tpc: {
            include: {
              lead: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),

      // 6. Lead Interviews scheduled or conducted today
      this.prisma.leadCollegeInterview.findMany({
        where: {
          scheduledAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          leadCollege: {
            include: {
              lead: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                  courseInterested: true,
                  assignments: {
                    where: { status: 'ACTIVE' },
                    include: {
                      user: {
                        select: {
                          id: true,
                          firstName: true,
                          lastName: true,
                          team: {
                            select: {
                              id: true,
                              name: true,
                              manager: {
                                select: {
                                  id: true,
                                  firstName: true,
                                  lastName: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              college: {
                select: {
                  id: true,
                  name: true,
                },
              },
              pitchedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                      manager: {
                        select: { id: true, firstName: true, lastName: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      }),

      // 7. Selection letters issued today (status LETTER_OUT updated today)
      this.prisma.lead.findMany({
        where: {
          status: { name: 'LETTER_OUT' },
          updatedAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          status: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                      manager: {
                        select: { id: true, firstName: true, lastName: true },
                      },
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
        },
      }),

      // 8. Admissions due today
      this.prisma.lead.findMany({
        where: {
          status: {
            name: {
              in: [
                'APPLICATION',
                'INTERVIEW_SCHEDULED',
                'INTERVIEW_DONE',
                'LETTER_OUT',
              ],
            },
          },
          updatedAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          status: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                      manager: {
                        select: { id: true, firstName: true, lastName: true },
                      },
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
          interactions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),

      // 9. All active LeadStatus values
      this.prisma.leadStatus.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),

      // 10. Total leads count
      this.prisma.lead.count(),

      // 11. Leads for pipeline distribution
      this.prisma.lead.findMany({
        select: {
          id: true,
          statusId: true,
          status: { select: { name: true } },
        },
      }),

      // 12. StudentData unassigned count
      this.prisma.studentData.count({
        where: { assignmentItems: { none: {} } },
      }),

      // 12b. StudentData uploaded today count
      this.prisma.studentData.count({
        where: { createdAt: { gte: startOfToday, lte: endOfToday } },
      }),

      // 13. DataAssignment expired count
      this.prisma.dataAssignment.count({
        where: { status: 'EXPIRED' },
      }),

      // 14. DataAssignment active count
      this.prisma.dataAssignment.count({
        where: { status: 'ACTIVE' },
      }),

      // 15. TPCUsers pending count
      this.prisma.tPCUser.count({
        where: { status: 'PENDING' },
      }),

      // 16. Attendance records for today
      this.prisma.attendance.findMany({
        where: {
          OR: [
            { date: { gte: startOfToday, lte: endOfToday } },
            { checkIn: { gte: startOfToday, lte: endOfToday } },
            { createdAt: { gte: startOfToday, lte: endOfToday } },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: { select: { name: true } },
              team: {
                select: {
                  id: true,
                  name: true,
                  manager: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      }),

      // 17. All active users
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { name: true } },
          team: {
            select: {
              id: true,
              name: true,
              manager: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),

      // 18. Recent system activity logs
      this.prisma.activityLog.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
      }),

      // 19. Active DataAssignments for assignedDataCount per advisor
      this.prisma.dataAssignment.findMany({
        where: { status: 'ACTIVE' },
        select: {
          assignedToId: true,
          _count: { select: { items: true } },
        },
      }),

      // 20. Admission Done leads for admissionsCount per advisor
      this.prisma.lead.findMany({
        where: {
          status: { name: 'ADMISSION_DONE' },
        },
        select: {
          id: true,
          createdById: true,
          assignments: {
            where: { status: 'ACTIVE' },
            select: { userId: true },
          },
        },
      }),

      // 21. CallRecords summary for aggregate metrics (no pagination)
      this.prisma.callRecord.findMany({
        where: callRecordDateFilter,
        select: {
          id: true,
          outcome: true,
          createdById: true,
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              teamId: true,
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 22. Paginated CallRecords for Recent Call & Interaction Activity Log table
      this.prisma.callRecord.findMany({
        where: callRecordDateFilter,
        skip,
        take: limit,
        include: {
          studentData: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              phone: true,
            },
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              status: { select: { name: true } },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  manager: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 23. CallRecords total count matching filters
      this.prisma.callRecord.count({
        where: callRecordDateFilter,
      }),
    ]);

    // Format 1. Leads Today List
    const leadsTodayList = leadsTodayRecords.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;
      const primaryCollege =
        l.collegeApplications[0]?.college?.name || 'Not Available';
      const lastAct = l.interactions[0]?.createdAt
        ? l.interactions[0].createdAt.toISOString()
        : l.updatedAt.toISOString();

      return {
        id: l.id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        phone: l.phone,
        email: l.email || 'Not Available',
        college: primaryCollege,
        createdAt: l.createdAt.toISOString(),
        createdBy:
          `${l.createdBy.firstName} ${l.createdBy.lastName || ''}`.trim(),
        createdById: l.createdById,
        status: l.status.name,
        assignedAdvisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        assignedAdvisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj
          ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim()
          : 'Unassigned',
        lastActivity: lastAct,
      };
    });

    // Summary list of calls for advisor & team performance calculations (unpaginated aggregate data)
    const allCallsForStatsList = allCallRecordsForStats.map((c) => {
      const advTeam = c.createdBy?.team;
      return {
        id: c.id,
        outcome: c.outcome,
        advisorId: c.createdById,
        advisor: c.createdBy
          ? `${c.createdBy.firstName} ${c.createdBy.lastName || ''}`.trim()
          : 'Advisor',
        team: advTeam?.name || 'Unassigned',
        teamId: advTeam?.id || null,
      };
    });

    const outcomeLabelMap: Record<string, string> = {
      NO_ANSWER: 'No Answer',
      WRONG_NUMBER: 'Wrong Number',
      NOT_INTERESTED: 'Not Interested',
      FOLLOW_UP: 'Follow Up Required',
      CALL_BACK_LATER: 'Call Back Later',
      INTERESTED: 'Interested / Create Lead',
      DISCONNECTED: 'Disconnected',
      OTHER: 'Other',
    };

    // Format 2. Paginated Calls Today Data
    const callsTodayData = paginatedCallRecords.map((c) => {
      const advTeam = c.createdBy?.team;
      const advManager = advTeam?.manager;
      const studentName = c.studentData
        ? [c.studentData.firstName, c.studentData.middleName, c.studentData.lastName].filter(Boolean).join(' ')
        : c.lead
          ? `${c.lead.firstName} ${c.lead.lastName || ''}`.trim()
          : 'Student Contact';

      const phone = c.studentData?.phone || c.lead?.phone || 'N/A';
      const durationStr = c.durationSeconds !== null && c.durationSeconds !== undefined
        ? `${Math.floor(c.durationSeconds / 60)}m ${c.durationSeconds % 60}s`
        : 'N/A';

      return {
        id: c.id,
        student: studentName,
        leadId: c.leadId || null,
        studentDataId: c.studentDataId || null,
        phone,
        advisor: c.createdBy
          ? `${c.createdBy.firstName} ${c.createdBy.lastName || ''}`.trim()
          : 'Advisor',
        advisorId: c.createdById,
        team: advTeam?.name || 'Unassigned',
        teamId: advTeam?.id || null,
        manager: advManager
          ? `${advManager.firstName} ${advManager.lastName || ''}`.trim()
          : 'Unassigned',
        callTime: (c.startedAt || c.createdAt).toISOString(),
        duration: durationStr,
        callOutcome: outcomeLabelMap[c.outcome] || c.outcome,
        leadStatus: c.lead?.status?.name || 'PROSPECT',
        notes: c.notes || null,
      };
    });

    // Format 3. Attendance Today List
    const attendanceUserIds = new Set(todayAttendances.map((a) => a.userId));
    const attendanceList = [
      ...todayAttendances.map((a) => {
        let workDuration = 'N/A';
        if (a.checkIn && a.checkOut) {
          const diffMs = a.checkOut.getTime() - a.checkIn.getTime();
          if (diffMs > 0) {
            const mins = Math.floor(diffMs / (1000 * 60));
            workDuration = `${Math.floor(mins / 60)} hrs ${mins % 60} mins`;
          } else {
            workDuration = '0 hrs 0 mins';
          }
        } else if (a.checkIn) {
          workDuration = 'Ongoing';
        }

        return {
          id: a.id,
          userId: a.userId,
          employee: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
          role: a.user.role?.name || 'Employee',
          team: a.user.team?.name || 'Unassigned',
          teamId: a.user.team?.id || null,
          manager: a.user.team?.manager
            ? `${a.user.team.manager.firstName} ${a.user.team.manager.lastName || ''}`.trim()
            : 'Unassigned',
          status: a.status,
          checkIn: a.checkIn ? a.checkIn.toISOString() : 'Not Checked In',
          checkOut: a.checkOut ? a.checkOut.toISOString() : 'Not Checked Out',
          workingHours: workDuration,
        };
      }),
      ...allActiveUsers
        .filter((u) => !attendanceUserIds.has(u.id))
        .map((u) => ({
          id: `att-${u.id}`,
          userId: u.id,
          employee: `${u.firstName} ${u.lastName || ''}`.trim(),
          role: u.role?.name || 'Employee',
          team: u.team?.name || 'Unassigned',
          teamId: u.team?.id || null,
          manager: u.team?.manager
            ? `${u.team.manager.firstName} ${u.team.manager.lastName || ''}`.trim()
            : 'Unassigned',
          status: 'ABSENT' as const,
          checkIn: 'Not Checked In',
          checkOut: 'Not Checked Out',
          workingHours: 'N/A',
        })),
    ];

    const presentCount = attendanceList.filter(
      (a) => a.status === 'PRESENT' || a.status === 'HALF_DAY',
    ).length;
    const absentCount = attendanceList.filter(
      (a) => a.status === 'ABSENT',
    ).length;
    const leaveCount = attendanceList.filter(
      (a) => a.status === 'LEAVE' || a.status === 'CASUAL_LEAVE',
    ).length;

    // Format 4. Student Lead Interviews Today List
    const interviewsList = todaysInterviews.map((i) => {
      const lead = i.leadCollege?.lead;
      const activeAssign = lead?.assignments[0];
      const assignedUser = activeAssign?.user || i.leadCollege?.pitchedBy;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;

      return {
        id: i.id,
        candidateName: lead
          ? `${lead.firstName} ${lead.lastName || ''}`.trim()
          : 'Student Lead',
        candidateId: lead?.id || i.id,
        phone: lead?.phone || 'Not Available',
        interviewTime: i.scheduledAt.toISOString(),
        college: i.leadCollege?.college?.name || 'Not Available',
        course:
          i.leadCollege?.coursePitched ||
          lead?.courseInterested ||
          'Interview Scheduled',
        status: i.status,
        result: i.result,
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj
          ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim()
          : 'Unassigned',
      };
    });

    const interviewsScheduledCount = interviewsList.filter(
      (i) => i.status === 'SCHEDULED',
    ).length;
    const interviewsCompletedCount = interviewsList.filter(
      (i) => i.status === 'COMPLETED' || i.result === 'PASSED' || i.result === 'FAILED',
    ).length;
    const interviewsPendingCount = interviewsList.filter(
      (i) => i.result === 'PENDING',
    ).length;

    // Format 5. Selection Letters Out Today List
    const lettersOutList = todaysLetterOutLeads.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;

      return {
        id: l.id,
        student: `${l.firstName} ${l.lastName || ''}`.trim(),
        college: l.collegeApplications[0]?.college?.name || 'Not Available',
        course: l.courseInterested || 'Selected Program',
        letterStatus: 'ISSUED',
        issuedTime: l.updatedAt.toISOString(),
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj
          ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim()
          : 'Unassigned',
      };
    });

    // Format 6. Admissions Due Today List
    const admissionsDueList = todaysAdmissionsDueLeads.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;
      const lastAct = l.interactions[0]?.createdAt
        ? l.interactions[0].createdAt.toISOString()
        : l.updatedAt.toISOString();

      return {
        id: l.id,
        student: `${l.firstName} ${l.lastName || ''}`.trim(),
        college: l.collegeApplications[0]?.college?.name || 'Not Available',
        course: l.courseInterested || 'Interested Program',
        admissionLastDate: l.createdAt.toISOString().split('T')[0],
        status: l.status.name,
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj
          ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim()
          : 'Unassigned',
        lastActivity: lastAct,
      };
    });

    // Format 7. Daily Team Report
    const dailyTeamReport = allTeams.map((team) => {
      const memberIds = team.users.map((m) => m.id);

      const teamLeadsTodayCount = leadsTodayList.filter(
        (l) =>
          l.teamId === team.id ||
          (l.assignedAdvisorId && memberIds.includes(l.assignedAdvisorId)),
      ).length;

      const teamCallsTodayCount = allCallsForStatsList.filter(
        (c) =>
          c.teamId === team.id ||
          (c.advisorId && memberIds.includes(c.advisorId)),
      ).length;

      const teamAdmissionsTodayCount = allLeadsForPipeline.filter(
        (l) => l.status.name === 'ADMISSION_DONE',
      ).length;

      const teamAttendancePresent = attendanceList.filter(
        (a) =>
          a.teamId === team.id &&
          (a.status === 'PRESENT' || a.status === 'HALF_DAY'),
      ).length;

      return {
        teamId: team.id,
        teamName: team.name,
        managerName: team.manager
          ? `${team.manager.firstName} ${team.manager.lastName || ''}`.trim()
          : 'Unassigned',
        managerId: team.manager?.id || null,
        membersCount: team.users.length,
        leadsTodayCount: teamLeadsTodayCount,
        callsTodayCount: teamCallsTodayCount,
        admissionsTodayCount: teamAdmissionsTodayCount,
        attendancePresentCount: teamAttendancePresent,
        attendanceTotalCount: team.users.length,
      };
    });

    // Format 8. Program Advisor Performance Table
    const uniqueAdvisorMap = new Map<string, { id: string; firstName: string; lastName: string | null; team: { id: number; name: string } | null }>();
    for (const adv of (allAdvisors as any[])) {
      if (!uniqueAdvisorMap.has(adv.id)) {
        uniqueAdvisorMap.set(adv.id, {
          id: adv.id,
          firstName: adv.firstName,
          lastName: adv.lastName,
          team: adv.team ? { id: adv.team.id, name: adv.team.name } : null,
        });
      }
    }
    for (const c of allCallsForStatsList) {
      if (c.advisorId && !uniqueAdvisorMap.has(c.advisorId)) {
        uniqueAdvisorMap.set(c.advisorId, {
          id: c.advisorId,
          firstName: c.advisor.split(' ')[0] || c.advisor,
          lastName: c.advisor.split(' ').slice(1).join(' ') || null,
          team: c.teamId ? { id: c.teamId as any, name: c.team } : null,
        });
      }
    }
    const uniqueAdvisors = Array.from(uniqueAdvisorMap.values());

    const assignedDataMap = new Map<string, number>();
    for (const da of activeDataAssignments) {
      const count = assignedDataMap.get(da.assignedToId) || 0;
      assignedDataMap.set(da.assignedToId, count + (da._count?.items || 0));
    }

    const advisorAdmissionsMap = new Map<string, number>();
    for (const lead of admissionDoneLeads) {
      const assignedUserId = lead.assignments[0]?.userId;
      const targetUserId = assignedUserId || lead.createdById;
      if (targetUserId) {
        const curr = advisorAdmissionsMap.get(targetUserId) || 0;
        advisorAdmissionsMap.set(targetUserId, curr + 1);
      }
    }

    const advisorPerformance = uniqueAdvisors.map((adv) => {
      const advName = `${adv.firstName} ${adv.lastName || ''}`.trim();

      const advCalls = allCallsForStatsList.filter(
        (c) => c.advisorId === adv.id,
      );
      const advCallsToday = advCalls.length;

      let advAnsweredCalls = 0;
      let advNotAnsweredCalls = 0;

      for (const c of advCalls) {
        const outcomeStr = String(c.outcome || '').toUpperCase();
        if (
          outcomeStr === 'NOT_INTERESTED' ||
          outcomeStr === 'FOLLOW_UP' ||
          outcomeStr === 'CALL_BACK_LATER' ||
          outcomeStr === 'INTERESTED' ||
          outcomeStr === 'FOLLOW_UP_REQUIRED' ||
          outcomeStr === 'OTHER'
        ) {
          advAnsweredCalls++;
        } else if (
          outcomeStr === 'NO_ANSWER' ||
          outcomeStr === 'WRONG_NUMBER' ||
          outcomeStr === 'DISCONNECTED'
        ) {
          advNotAnsweredCalls++;
        }
      }

      const advLeadsCreated = leadsTodayList.filter(
        (l) => l.createdById === adv.id || l.assignedAdvisorId === adv.id,
      ).length;
      const advAssignedData = assignedDataMap.get(adv.id) || 0;

      return {
        userId: adv.id,
        advisorName: advName,
        teamName: adv.team?.name || 'Unassigned',
        teamId: adv.team?.id || null,
        assignedDataCount: advAssignedData,
        callsCount: advCallsToday,
        answeredCallsCount: advAnsweredCalls,
        notAnsweredCallsCount: advNotAnsweredCalls,
        leadsCount: advLeadsCreated,
      };
    });

    // Format 9. Lead Pipeline Distribution
    const leadPipeline = allLeadStatuses.map((st) => {
      const count = allLeadsForPipeline.filter(
        (l) => l.statusId === st.id,
      ).length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage:
          totalLeadsCount > 0 ? Math.round((count / totalLeadsCount) * 100) : 0,
      };
    });

    const zeroCallAdvisors = advisorPerformance.filter(
      (a) => a.callsCount === 0,
    );

    const totalCallPages = Math.ceil(callRecordsTotalCount / limit) || 1;

    return {
      kpis: {
        leadsTodayCount: leadsTodayList.length,
        callsTodayCount: callRecordsTotalCount,
        attendanceTotal: attendanceList.length,
        attendancePresent: presentCount,
        attendanceAbsent: absentCount,
        attendanceLeave: leaveCount,
        interviewsTodayCount: interviewsList.length,
        interviewsScheduledCount,
        interviewsCompletedCount,
        interviewsPendingCount,
        selectionLettersTodayCount: lettersOutList.length,
        admissionsDueTodayCount: admissionsDueList.length,
        availableDataCount: availableStudentDataCount,
        dataUploadedTodayCount,
        expiredDataCount: expiredDataAssignmentCount,
        activeAssignmentsCount: activeDataAssignmentCount,
      },
      leadsTodayList,
      callsTodayList: {
        data: callsTodayData,
        pagination: {
          page,
          limit,
          total: callRecordsTotalCount,
          totalPages: totalCallPages,
        },
      },
      attendanceList,
      interviewsList,
      lettersOutList,
      admissionsDueList,
      dailyTeamReport,
      advisorPerformance,
      leadPipeline,
      attentionRequired: {
        admissionsDueTodayCount: admissionsDueList.length,
        overdueAdmissionsCount: Math.max(0, admissionsDueList.length - 2),
        pendingTpcsCount: pendingTpcUsersCount,
        unassignedDataCount: availableStudentDataCount,
        zeroCallAdvisorsCount: zeroCallAdvisors.length,
      },
      recentActivity: recentActivityLogs.map((a) => ({
        id: a.id,
        userId: a.userId,
        actor: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
        description: a.description || `${a.activity} on ${a.entityType}`,
        activity: a.activity,
        entityType: a.entityType,
        entityId: a.entityId,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Team Lead Dashboard Stats — uses the SAME metric definitions as Super Admin
   * but scoped to only the Team Lead's assigned Program Advisors.
   *
   * Metrics:
   * 1. Leads Today (same definition as SA leadsTodayCount)
   * 2. Calls Today (same definition as SA callsTodayCount)
   * 3. Present Team PAs (same attendance rules as SA, scoped to TL's PAs)
   * 4. Interviews Today (same definition as SA interviewsTodayCount)
   * 5. Selection Letters Today (same definition as SA selectionLettersTodayCount)
   * 6. Admissions Due Today (same definition as SA admissionsDueTodayCount)
   */
  async getTeamLeadDashboardStats(userId: string) {
    await this.verifyUserRole(userId, ['TEAM_LEAD', 'TEAMLEAD', 'SUPER_ADMIN']);

    // 1. Resolve Team Lead scope using centralized helper
    const scope = await this.teamLeadAuthService.getTeamLeadScope(userId);
    const scopedPaIds = scope.paIds;

    // Edge case: Team Lead has no Program Advisors
    if (scopedPaIds.length === 0) {
      return {
        kpis: {
          leadsTodayCount: 0,
          callsTodayCount: 0,
          attendancePresent: 0,
          attendanceTotal: 0,
          interviewsTodayCount: 0,
          selectionLettersTodayCount: 0,
          admissionsDueTodayCount: 0,
        },
        leadsTodayList: [],
        interviewsList: [],
        lettersOutList: [],
        admissionsDueList: [],
        scope: {
          paIds: [],
          teamIds: scope.teamIds,
        },
      };
    }

    // 2. Setup date boundaries — SAME as Super Admin
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // 3. Run scoped queries in parallel — SAME metric definitions as Super Admin
    //    but with scopedPaIds filter injected into each query
    const [
      leadsTodayRecords,
      callsTodayCount,
      todayAttendances,
      todaysInterviews,
      todaysLetterOutLeads,
      todaysAdmissionsDueLeads,
    ] = await Promise.all([

      // A. LEADS TODAY — same as SA query #3 (leads created today)
      //    Scoped: created by scoped PAs OR actively assigned to scoped PAs
      this.prisma.lead.findMany({
        where: {
          createdAt: { gte: startOfToday, lte: endOfToday },
          OR: [
            { createdById: { in: scopedPaIds } },
            {
              assignments: {
                some: {
                  userId: { in: scopedPaIds },
                  status: 'ACTIVE',
                },
              },
            },
          ],
        },
        include: {
          status: true,
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
          interactions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // B. CALLS TODAY — same as SA query #23 (callRecord count)
      //    Scoped: calls created by scoped PAs today
      this.prisma.callRecord.count({
        where: {
          createdById: { in: scopedPaIds },
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
      }),

      // C. ATTENDANCE TODAY — same as SA query #16 (attendance records today)
      //    Scoped: only attendance records for scoped PAs
      this.prisma.attendance.findMany({
        where: {
          userId: { in: scopedPaIds },
          OR: [
            { date: { gte: startOfToday, lte: endOfToday } },
            { checkIn: { gte: startOfToday, lte: endOfToday } },
            { createdAt: { gte: startOfToday, lte: endOfToday } },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: { select: { name: true } },
            },
          },
        },
      }),

      // D. INTERVIEWS TODAY — same as SA query #6 (leadCollegeInterview scheduled today)
      //    Scoped: only interviews for leads assigned to/created by scoped PAs
      this.prisma.leadCollegeInterview.findMany({
        where: {
          scheduledAt: { gte: startOfToday, lte: endOfToday },
          leadCollege: {
            lead: {
              OR: [
                { createdById: { in: scopedPaIds } },
                {
                  assignments: {
                    some: {
                      userId: { in: scopedPaIds },
                      status: 'ACTIVE',
                    },
                  },
                },
              ],
            },
          },
        },
        include: {
          leadCollege: {
            include: {
              lead: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                  courseInterested: true,
                  assignments: {
                    where: { status: 'ACTIVE' },
                    include: {
                      user: {
                        select: {
                          id: true,
                          firstName: true,
                          lastName: true,
                          team: {
                            select: {
                              id: true,
                              name: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              college: {
                select: { id: true, name: true },
              },
              pitchedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      }),

      // E. SELECTION LETTERS TODAY — same as SA query #7 (LETTER_OUT status, updated today)
      //    Scoped: only leads created by / assigned to scoped PAs
      this.prisma.lead.findMany({
        where: {
          status: { name: 'LETTER_OUT' },
          updatedAt: { gte: startOfToday, lte: endOfToday },
          OR: [
            { createdById: { in: scopedPaIds } },
            {
              assignments: {
                some: {
                  userId: { in: scopedPaIds },
                  status: 'ACTIVE',
                },
              },
            },
          ],
        },
        include: {
          status: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
        },
      }),

      // F. ADMISSIONS DUE TODAY — same as SA query #8 (in-progress statuses, updated today)
      //    Scoped: only leads created by / assigned to scoped PAs
      this.prisma.lead.findMany({
        where: {
          status: {
            name: {
              in: [
                'APPLICATION',
                'INTERVIEW_SCHEDULED',
                'INTERVIEW_DONE',
                'LETTER_OUT',
              ],
            },
          },
          updatedAt: { gte: startOfToday, lte: endOfToday },
          OR: [
            { createdById: { in: scopedPaIds } },
            {
              assignments: {
                some: {
                  userId: { in: scopedPaIds },
                  status: 'ACTIVE',
                },
              },
            },
          ],
        },
        include: {
          status: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          assignments: {
            where: { status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          collegeApplications: { include: { college: true } },
          interactions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    // 4. Format results — SAME formatting logic as Super Admin

    // Format Leads Today List (same as SA Format 1)
    const leadsTodayList = leadsTodayRecords.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const primaryCollege =
        l.collegeApplications[0]?.college?.name || 'Not Available';
      const lastAct = l.interactions[0]?.createdAt
        ? l.interactions[0].createdAt.toISOString()
        : l.updatedAt.toISOString();

      return {
        id: l.id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        phone: l.phone,
        email: l.email || 'Not Available',
        college: primaryCollege,
        createdAt: l.createdAt.toISOString(),
        createdBy:
          `${l.createdBy.firstName} ${l.createdBy.lastName || ''}`.trim(),
        createdById: l.createdById,
        status: l.status.name,
        assignedAdvisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        assignedAdvisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        lastActivity: lastAct,
      };
    });

    // Format Attendance — same status rules as Super Admin
    const attendancePresentCount = todayAttendances.filter(
      (a) => a.status === 'PRESENT' || a.status === 'HALF_DAY',
    ).length;

    // Format Interviews Today List (same as SA Format 4)
    const interviewsList = todaysInterviews.map((i) => {
      const lead = i.leadCollege?.lead;
      const activeAssign = lead?.assignments[0];
      const assignedUser = activeAssign?.user || i.leadCollege?.pitchedBy;
      const teamObj = assignedUser?.team;

      return {
        id: i.id,
        candidateName: lead
          ? `${lead.firstName} ${lead.lastName || ''}`.trim()
          : 'Student Lead',
        candidateId: lead?.id || i.id,
        phone: lead?.phone || 'Not Available',
        interviewTime: i.scheduledAt.toISOString(),
        college: i.leadCollege?.college?.name || 'Not Available',
        course:
          i.leadCollege?.coursePitched ||
          lead?.courseInterested ||
          'Interview Scheduled',
        status: i.status,
        result: i.result,
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
      };
    });

    // Format Selection Letters Today List (same as SA Format 5)
    const lettersOutList = todaysLetterOutLeads.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;

      return {
        id: l.id,
        student: `${l.firstName} ${l.lastName || ''}`.trim(),
        college: l.collegeApplications[0]?.college?.name || 'Not Available',
        course: l.courseInterested || 'Selected Program',
        letterStatus: 'ISSUED',
        issuedTime: l.updatedAt.toISOString(),
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
      };
    });

    // Format Admissions Due Today List (same as SA Format 6)
    const admissionsDueList = todaysAdmissionsDueLeads.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const lastAct = l.interactions[0]?.createdAt
        ? l.interactions[0].createdAt.toISOString()
        : l.updatedAt.toISOString();

      return {
        id: l.id,
        student: `${l.firstName} ${l.lastName || ''}`.trim(),
        college: l.collegeApplications[0]?.college?.name || 'Not Available',
        course: l.courseInterested || 'Interested Program',
        admissionLastDate: l.createdAt.toISOString().split('T')[0],
        status: l.status.name,
        advisor: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim()
          : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        lastActivity: lastAct,
      };
    });

    // 5. Return response matching the same KPI shape as Super Admin
    return {
      kpis: {
        leadsTodayCount: leadsTodayList.length,
        callsTodayCount: callsTodayCount,
        attendancePresent: attendancePresentCount,
        attendanceTotal: scopedPaIds.length,
        interviewsTodayCount: interviewsList.length,
        selectionLettersTodayCount: lettersOutList.length,
        admissionsDueTodayCount: admissionsDueList.length,
      },
      leadsTodayList,
      interviewsList,
      lettersOutList,
      admissionsDueList,
      scope: {
        paIds: scopedPaIds,
        teamIds: scope.teamIds,
      },
    };
  }

  async getAdmissionsDashboardStats(
    userId?: string,
    filters: AdmissionsDashboardFilters = {},
  ) {
    await this.verifyUserRole(userId, [
      'SUPER_ADMIN',
      'PROGRAM_ADVISOR',
      'MANAGER',
    ]);

    const {
      startDate,
      endDate,
      collegeId,
      course,
      teamId,
      employeeId,
      source,
      statusId,
      page = 1,
      limit = 10,
    } = filters;

    // Build Prisma query conditions for Lead and LeadCollege
    const whereLead: any = {};
    const whereLeadCollege: any = {};

    if (startDate || endDate) {
      whereLead.createdAt = {};
      whereLeadCollege.createdAt = {};
      if (startDate) {
        whereLead.createdAt.gte = new Date(startDate);
        whereLeadCollege.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        whereLead.createdAt.lte = new Date(endDate);
        whereLeadCollege.createdAt.lte = new Date(endDate);
      }
    }

    if (source) {
      whereLead.source = source as any;
      whereLeadCollege.lead = {
        ...whereLeadCollege.lead,
        source: source as any,
      };
    }

    if (collegeId) {
      whereLead.OR = [
        { finalCollegeId: collegeId },
        { collegeApplications: { some: { collegeId } } },
      ];
      whereLeadCollege.collegeId = collegeId;
    }

    if (course) {
      whereLead.OR = [
        ...(whereLead.OR || []),
        { courseInterested: course as any },
        { collegeApplications: { some: { coursePitched: course } } },
      ];
      whereLeadCollege.coursePitched = course;
    }

    if (statusId) {
      const parsedStatusId = parseInt(statusId, 10);
      whereLead.statusId = parsedStatusId;
      whereLeadCollege.statusId = parsedStatusId;
    }

    if (teamId) {
      const parsedTeamId = parseInt(teamId, 10);
      whereLead.createdBy = { teamId: parsedTeamId };
      whereLeadCollege.pitchedBy = { teamId: parsedTeamId };
    }

    if (employeeId) {
      whereLead.createdById = employeeId;
      whereLeadCollege.pitchedById = employeeId;
    }

    // Fetch master filter metadata (cached in memory)
    const { colleges, courses, teams, employees, leadStatuses } =
      await this.getDashboardMetadata();

    // Fetch lead and leadCollege data using lean select queries (no heavy payments/nested arrays)
    const [allLeads, allLeadColleges] = await Promise.all([
      this.prisma.lead.findMany({
        where: whereLead,
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          statusId: true,
          source: true,
          state: true,
          status: { select: { id: true, name: true } },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              teamId: true,
              team: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leadCollege.findMany({
        where: whereLeadCollege,
        select: {
          id: true,
          leadId: true,
          collegeId: true,
          pitchedById: true,
          statusId: true,
          status: { select: { id: true, name: true } },
          pitchedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              teamId: true,
              team: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Admission identification logic
    const isAdmissionStatus = (stName?: string) => {
      if (!stName) return false;
      const normalized = stName.toUpperCase();
      return (
        normalized === 'ADMISSION_DONE' || normalized.includes('ADMISSION')
      );
    };

    // Filter leads and leadColleges that are admissions
    const admissionLeads = allLeads.filter((l) =>
      isAdmissionStatus(l.status?.name),
    );
    const admissionLeadColleges = allLeadColleges.filter((lc) =>
      isAdmissionStatus(lc.status?.name),
    );

    // Combine distinct admissions count (by lead ID)
    const admittedLeadIds = new Set<string>();
    admissionLeads.forEach((l) => admittedLeadIds.add(l.id));
    admissionLeadColleges.forEach((lc) => admittedLeadIds.add(lc.leadId));

    const totalAdmissionsCount = admittedLeadIds.size;
    const totalLeadsCount = allLeads.length;

    // Current month admissions
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const admissionsThisMonthCount = allLeads.filter(
      (l) =>
        isAdmissionStatus(l.status?.name) &&
        new Date(l.updatedAt || l.createdAt) >= startOfCurrentMonth,
    ).length;

    // Counselor / Employee Performance Leaderboard
    const employeeStatsMap = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        teamName: string;
        leadsHandled: number;
        admissions: number;
        conversionRate: number;
      }
    >();

    // Initialize map for all active employees
    employees.forEach((emp) => {
      employeeStatsMap.set(emp.id, {
        employeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName || ''}`.trim(),
        teamName: emp.team?.name || 'Unassigned',
        leadsHandled: 0,
        admissions: 0,
        conversionRate: 0,
      });
    });

    // Populate leads handled and admissions per employee
    allLeads.forEach((l) => {
      const empId = l.createdById;
      if (empId) {
        const emp = employeeStatsMap.get(empId) || {
          employeeId: empId,
          employeeName:
            `${l.createdBy?.firstName || ''} ${l.createdBy?.lastName || ''}`.trim() ||
            'Unknown',
          teamName: l.createdBy?.team?.name || 'Unassigned',
          leadsHandled: 0,
          admissions: 0,
          conversionRate: 0,
        };
        emp.leadsHandled += 1;
        if (isAdmissionStatus(l.status?.name)) {
          emp.admissions += 1;
        }
        employeeStatsMap.set(empId, emp);
      }
    });

    // Also include pitchedBy employees from LeadCollege applications
    allLeadColleges.forEach((lc) => {
      const empId = lc.pitchedById;
      if (empId) {
        const emp = employeeStatsMap.get(empId) || {
          employeeId: empId,
          employeeName:
            `${lc.pitchedBy?.firstName || ''} ${lc.pitchedBy?.lastName || ''}`.trim() ||
            'Unknown',
          teamName: lc.pitchedBy?.team?.name || 'Unassigned',
          leadsHandled: 0,
          admissions: 0,
          conversionRate: 0,
        };
        if (isAdmissionStatus(lc.status?.name)) {
          emp.admissions += 1;
        }
        employeeStatsMap.set(empId, emp);
      }
    });

    // Calculate conversion rates for employees
    const employeePerformanceList = Array.from(employeeStatsMap.values())
      .map((e) => ({
        ...e,
        conversionRate:
          e.leadsHandled > 0
            ? Math.round((e.admissions / e.leadsHandled) * 100)
            : 0,
      }))
      .filter((e) => e.leadsHandled > 0 || e.admissions > 0)
      .sort((a, b) => b.admissions - a.admissions);

    // Top Counselor & Top Converter
    const topCounselorObj = employeePerformanceList[0] || null;
    const eligibleConverters = employeePerformanceList.filter(
      (e) => e.leadsHandled >= 3,
    );
    eligibleConverters.sort((a, b) => b.conversionRate - a.conversionRate);
    const topConverterObj = eligibleConverters[0] || topCounselorObj;

    // Team Performance Breakdown
    const teamStatsMap = new Map<
      number,
      {
        teamId: number;
        teamName: string;
        managerName: string;
        memberCount: number;
        leadsHandled: number;
        admissions: number;
        conversionRate: number;
      }
    >();

    teams.forEach((t) => {
      const mgrName = t.manager
        ? `${t.manager.firstName} ${t.manager.lastName || ''}`.trim()
        : 'N/A';
      const mCount = employees.filter((e) => e.teamId === t.id).length;
      teamStatsMap.set(t.id, {
        teamId: t.id,
        teamName: t.name,
        managerName: mgrName,
        memberCount: mCount,
        leadsHandled: 0,
        admissions: 0,
        conversionRate: 0,
      });
    });

    allLeads.forEach((l) => {
      const tId = l.createdBy?.teamId;
      if (tId && teamStatsMap.has(tId)) {
        const t = teamStatsMap.get(tId)!;
        t.leadsHandled += 1;
        if (isAdmissionStatus(l.status?.name)) {
          t.admissions += 1;
        }
      }
    });

    const teamPerformanceList = Array.from(teamStatsMap.values()).map((t) => ({
      ...t,
      conversionRate:
        t.leadsHandled > 0
          ? Math.round((t.admissions / t.leadsHandled) * 100)
          : 0,
    }));

    // Admission Trend (Last 6 Months)
    const monthlyTrendMap = new Map<
      string,
      { month: string; leads: number; admissions: number }
    >();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString('default', {
        month: 'short',
        year: '2-digit',
      });
      monthlyTrendMap.set(key, { month: key, leads: 0, admissions: 0 });
    }

    allLeads.forEach((l) => {
      const lDate = new Date(l.createdAt);
      const key = lDate.toLocaleString('default', {
        month: 'short',
        year: '2-digit',
      });
      if (monthlyTrendMap.has(key)) {
        const item = monthlyTrendMap.get(key)!;
        item.leads += 1;
        if (isAdmissionStatus(l.status?.name)) {
          item.admissions += 1;
        }
      }
    });

    const admissionTrend = Array.from(monthlyTrendMap.values());

    // Admissions by College
    const collegeStatsMap = new Map<
      string,
      {
        collegeId: string;
        collegeName: string;
        applications: number;
        admissions: number;
        conversionRate: number;
      }
    >();

    colleges.forEach((c) => {
      collegeStatsMap.set(c.id, {
        collegeId: c.id,
        collegeName: c.name,
        applications: 0,
        admissions: 0,
        conversionRate: 0,
      });
    });

    allLeadColleges.forEach((lc) => {
      if (lc.collegeId && collegeStatsMap.has(lc.collegeId)) {
        const col = collegeStatsMap.get(lc.collegeId)!;
        col.applications += 1;
        if (isAdmissionStatus(lc.status?.name)) {
          col.admissions += 1;
        }
      }
    });

    const collegeDistribution = Array.from(collegeStatsMap.values())
      .map((c) => ({
        ...c,
        conversionRate:
          c.applications > 0
            ? Math.round((c.admissions / c.applications) * 100)
            : 0,
      }))
      .filter((c) => c.applications > 0 || c.admissions > 0)
      .sort((a, b) => b.admissions - a.admissions);

    // Admission Funnel (Lead Status Pipeline)
    let prevCount = 0;
    const admissionFunnel = leadStatuses.map((st, idx) => {
      const count = allLeads.filter((l) => l.statusId === st.id).length;
      let conversionFromPrevious = 100;
      if (idx > 0 && prevCount > 0) {
        conversionFromPrevious = Math.round((count / prevCount) * 100);
      }
      prevCount = count || prevCount;
      return {
        stageId: st.id,
        stageName: st.description || st.name,
        code: st.name,
        displayOrder: st.displayOrder,
        color: st.color,
        count,
        conversionFromPrevious,
      };
    });

    // Source Conversion
    const sourceStatsMap = new Map<
      string,
      {
        source: string;
        leads: number;
        admissions: number;
        conversionRate: number;
      }
    >();

    const sourcesList = [
      'WEBSITE',
      'FACEBOOK',
      'INSTAGRAM',
      'GOOGLE',
      'REFERRAL',
      'DATA_UPLOAD',
      'COLLEGE_EVENT',
      'OTHER',
    ];

    sourcesList.forEach((src) => {
      sourceStatsMap.set(src, {
        source: src,
        leads: 0,
        admissions: 0,
        conversionRate: 0,
      });
    });

    allLeads.forEach((l) => {
      const src = l.source || 'OTHER';
      const item = sourceStatsMap.get(src) || {
        source: src,
        leads: 0,
        admissions: 0,
        conversionRate: 0,
      };
      item.leads += 1;
      if (isAdmissionStatus(l.status?.name)) {
        item.admissions += 1;
      }
      sourceStatsMap.set(src, item);
    });

    const sourceConversionList = Array.from(sourceStatsMap.values())
      .map((s) => ({
        ...s,
        conversionRate:
          s.leads > 0 ? Math.round((s.admissions / s.leads) * 100) : 0,
      }))
      .filter((s) => s.leads > 0);

    // Geographic Distribution (State & City)
    const stateStatsMap = new Map<
      string,
      { state: string; admissionsCount: number; totalLeads: number }
    >();

    allLeads.forEach((l) => {
      const st = l.state?.trim() || 'Unknown State';
      const item = stateStatsMap.get(st) || {
        state: st,
        admissionsCount: 0,
        totalLeads: 0,
      };
      item.totalLeads += 1;
      if (isAdmissionStatus(l.status?.name)) {
        item.admissionsCount += 1;
      }
      stateStatsMap.set(st, item);
    });

    const geographicDistribution = Array.from(stateStatsMap.values()).sort(
      (a, b) => b.admissionsCount - a.admissionsCount,
    );

    // Admission Status Distribution
    const statusDistribution = leadStatuses.map((st) => {
      const count = allLeads.filter((l) => l.statusId === st.id).length;
      return {
        statusId: st.id,
        statusName: st.description || st.name,
        code: st.name,
        color: st.color,
        count,
        percentage:
          totalLeadsCount > 0 ? Math.round((count / totalLeadsCount) * 100) : 0,
      };
    });

    // Recent Admissions (Database-level Paginated)
    const whereRecentAdmissions: any = {
      ...whereLeadCollege,
      status: {
        is: {
          name: {
            contains: 'ADMISSION',
            mode: 'insensitive',
          },
        },
      },
    };

    let totalRecentRecords = await this.prisma.leadCollege.count({
      where: whereRecentAdmissions,
    });

    let recentWhereToUse = whereRecentAdmissions;
    if (totalRecentRecords === 0) {
      totalRecentRecords = await this.prisma.leadCollege.count({
        where: whereLeadCollege,
      });
      recentWhereToUse = whereLeadCollege;
    }

    const totalPages = Math.ceil(totalRecentRecords / limit) || 1;
    const skip = (page - 1) * limit;

    const recentLeadColleges = await this.prisma.leadCollege.findMany({
      where: recentWhereToUse,
      skip,
      take: limit,
      select: {
        id: true,
        leadId: true,
        coursePitched: true,
        feePitched: true,
        createdAt: true,
        updatedAt: true,
        status: { select: { name: true, color: true } },
        college: { select: { id: true, name: true, city: true, state: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            city: true,
            state: true,
            source: true,
          },
        },
        pitchedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            teamId: true,
            team: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const recentAdmissionsData = recentLeadColleges.map((rc) => ({
      id: rc.id,
      leadId: rc.leadId,
      studentName:
        `${rc.lead?.firstName || 'Student'} ${rc.lead?.lastName || ''}`.trim(),
      phone: rc.lead?.phone || 'N/A',
      email: rc.lead?.email || 'N/A',
      city: rc.lead?.city || rc.college?.city || 'N/A',
      state: rc.lead?.state || rc.college?.state || 'N/A',
      collegeName: rc.college?.name || 'N/A',
      coursePitched: rc.coursePitched || 'N/A',
      feePitched: rc.feePitched ? Number(rc.feePitched) : 0,
      counselorName: rc.pitchedBy
        ? `${rc.pitchedBy.firstName} ${rc.pitchedBy.lastName || ''}`.trim()
        : 'Unassigned',
      teamName: rc.pitchedBy?.team?.name || 'Unassigned',
      admissionDate: rc.updatedAt
        ? rc.updatedAt.toISOString()
        : rc.createdAt.toISOString(),
      statusName: rc.status?.name || 'ADMISSION_DONE',
      statusColor: rc.status?.color || 'green',
      source: rc.lead?.source || 'OTHER',
      createdAt: rc.createdAt.toISOString(),
    }));

    // Filter Options Metadata
    const uniqueCourseNames = Array.from(
      new Set(courses.map((c) => c.name)),
    ).sort();

    return {
      kpis: {
        totalAdmissions: totalAdmissionsCount,
        admissionsThisMonth: admissionsThisMonthCount,
        totalLeads: totalLeadsCount,
        overallConversionRate:
          totalLeadsCount > 0
            ? Math.round((totalAdmissionsCount / totalLeadsCount) * 100)
            : 0,
        topCounselor: topCounselorObj
          ? {
            name: topCounselorObj.employeeName,
            admissions: topCounselorObj.admissions,
            team: topCounselorObj.teamName,
          }
          : null,
        topConverter: topConverterObj
          ? {
            name: topConverterObj.employeeName,
            conversionRate: topConverterObj.conversionRate,
            team: topConverterObj.teamName,
          }
          : null,
      },
      filtersMeta: {
        colleges: colleges.map((c) => ({ id: c.id, name: c.name })),
        courses: uniqueCourseNames,
        teams: teams.map((t) => ({ id: t.id, name: t.name })),
        employees: employees.map((e) => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName || ''}`.trim(),
          teamId: e.teamId,
        })),
        sources: sourcesList,
        statuses: leadStatuses.map((s) => ({
          id: s.id,
          name: s.description || s.name,
          code: s.name,
          color: s.color,
        })),
      },
      admissionTrend,
      collegeDistribution,
      employeePerformance: employeePerformanceList,
      teamPerformance: teamPerformanceList,
      admissionFunnel,
      sourceConversion: [],
      geographicDistribution,
      statusDistribution,
      recentAdmissions: {
        data: recentAdmissionsData,
        total: totalRecentRecords,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Retrieves matching student records for a specific dashboard stat card metric.
   * Respects role-based access, team scoping, database-level filtering, and pagination.
   */
  async getDashboardMetricStudents(
    userId: string,
    metric: string,
    teamIdParam?: string,
    search?: string,
    pageParam: number = 1,
    limitParam: number = 20,
  ) {
    const page = Math.max(1, Number(pageParam) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitParam) || 20));
    const skip = (page - 1) * limit;

    const callingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        teamId: true,
        role: { select: { name: true } },
      },
    });

    const isSuperAdminUser = callingUser?.role?.name
      ?.toUpperCase()
      .includes('SUPER_ADMIN');
    const isTeamLeadUser = await this.teamLeadAuthService.isTeamLead(userId);

    // Determine target team IDs and member IDs
    let memberIds: string[] = [];
    if (!isSuperAdminUser) {
      let managedTeams: Array<{ id: number; name: string; managerId: string | null }> = [];
      if (isTeamLeadUser) {
        const assignedTeamIds =
          await this.teamLeadAuthService.getTeamLeadAssignedTeamIds(userId);
        managedTeams = await this.prisma.team.findMany({
          where: { id: { in: assignedTeamIds }, isActive: true },
          select: { id: true, name: true, managerId: true },
        });
      } else {
        managedTeams = await this.prisma.team.findMany({
          where: { managerId: userId, isActive: true },
          select: { id: true, name: true, managerId: true },
        });
      }

      let targetTeamIds: number[] = [];
      if (teamIdParam && teamIdParam !== 'all') {
        const parsedId = parseInt(teamIdParam, 10);
        if (!isNaN(parsedId) && managedTeams.some((t) => t.id === parsedId)) {
          targetTeamIds = [parsedId];
        } else {
          targetTeamIds = managedTeams.map((t) => t.id);
        }
      } else {
        targetTeamIds = managedTeams.map((t) => t.id);
      }

      const targetTeams = managedTeams.filter((t) => targetTeamIds.includes(t.id));
      const targetManagerIds = targetTeams.map((t) => t.managerId).filter(Boolean) as string[];

      const teamMembers =
        targetTeamIds.length > 0
          ? await this.prisma.user.findMany({
            where: {
              OR: [
                { teamId: { in: targetTeamIds } },
                { id: { in: targetManagerIds } },
                { id: userId },
              ],
              status: 'ACTIVE',
            },
            select: { id: true },
          })
          : await this.prisma.user.findMany({
            where: { id: userId, status: 'ACTIVE' },
            select: { id: true },
          });

      memberIds = teamMembers.map((m) => m.id);

      if (memberIds.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit,
          totalPages: 1,
        };
      }
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const normMetric = (metric || '').toUpperCase().trim();

    // Helper for lead search filter
    const getLeadSearchFilter = (querySearch?: string) => {
      if (!querySearch || !querySearch.trim()) return {};
      const q = querySearch.trim();
      return {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
          { city: { contains: q, mode: 'insensitive' as const } },
        ],
      };
    };

    const searchFilter = getLeadSearchFilter(search);

    // 1. LEADS_TODAY
    if (normMetric === 'LEADS_TODAY' || normMetric === 'LEADS_TODAY_COUNT') {
      const where: any = {
        createdAt: { gte: startOfToday, lte: endOfToday },
        ...searchFilter,
      };
      if (!isSuperAdminUser) {
        where.OR = [
          { createdById: { in: memberIds } },
          { assignments: { some: { userId: { in: memberIds } } } },
        ];
        if (searchFilter.OR) {
          where.AND = [{ OR: searchFilter.OR }];
        }
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: lead.status?.name || 'LEAD',
          statusColor: lead.status?.color || 'blue',
          date: lead.createdAt.toISOString(),
          dateLabel: 'Created',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 2. MONTHLY_CONVERSIONS
    if (normMetric === 'MONTHLY_CONVERSIONS' || normMetric === 'CONVERSIONS') {
      const where: any = {
        status: { name: 'ADMISSION_DONE' },
        updatedAt: { gte: startOfMonth },
        ...searchFilter,
      };
      if (!isSuperAdminUser) {
        where.OR = [
          { createdById: { in: memberIds } },
          { assignments: { some: { userId: { in: memberIds } } } },
        ];
        if (searchFilter.OR) {
          where.AND = [{ OR: searchFilter.OR }];
        }
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: 'ADMISSION_DONE',
          statusColor: 'emerald',
          date: lead.updatedAt.toISOString(),
          dateLabel: 'Converted',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 3. TODAYS_APPLICATIONS
    if (normMetric === 'TODAYS_APPLICATIONS' || normMetric === 'APPLICATIONS') {
      const pitchWhere: any = {
        createdAt: { gte: startOfToday, lte: endOfToday },
      };
      if (!isSuperAdminUser) {
        pitchWhere.pitchedById = { in: memberIds };
      }
      if (search && search.trim()) {
        const q = search.trim();
        pitchWhere.lead = {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        };
      }

      const [total, pitches] = await Promise.all([
        this.prisma.leadCollege.count({ where: pitchWhere }),
        this.prisma.leadCollege.findMany({
          where: pitchWhere,
          include: {
            lead: {
              include: {
                status: true,
                assignments: {
                  where: { status: 'ACTIVE' },
                  include: { user: { include: { team: true } } },
                },
              },
            },
            college: true,
            pitchedBy: {
              include: { team: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = pitches.map((pitch) => {
        const lead = pitch.lead;
        const advisor = pitch.pitchedBy;
        return {
          id: pitch.id,
          leadId: lead?.id || pitch.leadId,
          studentName: lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Unknown Student',
          phone: lead?.phone || null,
          email: lead?.email || null,
          location: lead ? [lead.city, lead.state].filter(Boolean).join(', ') || null : null,
          notes: lead?.notes || null,
          status: pitch.approvalStatus || lead?.status?.name || 'APPLICATION',
          statusColor: 'amber',
          date: pitch.createdAt.toISOString(),
          dateLabel: 'Pitched Today',
          course: lead?.courseInterested || null,
          college: pitch.college?.name || null,
          assignedAdvisor: advisor ? `${advisor.firstName} ${advisor.lastName || ''}`.trim() : null,
          team: advisor?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 4. ONGOING_PROCESSES
    if (normMetric === 'ONGOING_PROCESSES' || normMetric === 'ONGOING') {
      const ongoingStatuses = ['APPLICATION', 'INTERVIEW_SCHEDULED', 'INTERVIEW_DONE', 'LETTER_OUT'];
      const where: any = {
        status: { name: { in: ongoingStatuses } },
        ...searchFilter,
      };
      if (!isSuperAdminUser) {
        where.OR = [
          { createdById: { in: memberIds } },
          { assignments: { some: { userId: { in: memberIds } } } },
        ];
        if (searchFilter.OR) {
          where.AND = [{ OR: searchFilter.OR }];
        }
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: lead.status?.name || 'APPLICATION',
          statusColor: 'purple',
          date: lead.updatedAt.toISOString(),
          dateLabel: 'Last Updated',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 5. LETTER_OUT_TODAY / SELECTION_LETTERS_TODAY
    if (
      normMetric === 'LETTER_OUT_TODAY' ||
      normMetric === 'LETTER_OUT' ||
      normMetric === 'SELECTION_LETTERS_TODAY'
    ) {
      const where: any = {
        status: { name: 'LETTER_OUT' },
        OR: [
          { createdAt: { gte: startOfToday, lte: endOfToday } },
          { updatedAt: { gte: startOfToday, lte: endOfToday } },
        ],
      };
      if (!isSuperAdminUser) {
        where.AND = [
          {
            OR: [
              { createdById: { in: memberIds } },
              { assignments: { some: { userId: { in: memberIds } } } },
            ],
          },
        ];
      }
      if (searchFilter.OR) {
        where.AND = where.AND ? [...where.AND, { OR: searchFilter.OR }] : [{ OR: searchFilter.OR }];
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: 'LETTER_OUT',
          statusColor: 'pink',
          date: lead.updatedAt.toISOString(),
          dateLabel: 'Deadline / Updated',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 6. INTERVIEW_SCHEDULED_TODAY / INTERVIEWS_TODAY
    if (
      normMetric === 'INTERVIEW_SCHEDULED_TODAY' ||
      normMetric === 'INTERVIEWS_TODAY' ||
      normMetric === 'INTERVIEWS'
    ) {
      const interviewWhere: any = {
        scheduledAt: { gte: startOfToday, lte: endOfToday },
      };
      if (search && search.trim()) {
        const q = search.trim();
        interviewWhere.leadCollege = {
          lead: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' as const } },
              { lastName: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
            ],
          },
        };
      }

      const [interviewTotal, interviews] = await Promise.all([
        this.prisma.leadCollegeInterview.count({ where: interviewWhere }),
        this.prisma.leadCollegeInterview.findMany({
          where: interviewWhere,
          include: {
            leadCollege: {
              include: {
                lead: {
                  include: {
                    status: true,
                    assignments: {
                      where: { status: 'ACTIVE' },
                      include: { user: { include: { team: true } } },
                    },
                  },
                },
                college: true,
                pitchedBy: { include: { team: true } },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          skip,
          take: limit,
        }),
      ]);

      if (interviewTotal > 0) {
        const data = interviews.map((item) => {
          const lead = item.leadCollege?.lead;
          const assignedUser = lead?.assignments[0]?.user || item.leadCollege?.pitchedBy;
          return {
            id: item.id,
            leadId: lead?.id || null,
            studentName: lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Unknown Student',
            phone: lead?.phone || null,
            email: lead?.email || null,
            location: lead ? [lead.city, lead.state].filter(Boolean).join(', ') || null : null,
            notes: item.feedback || lead?.notes || null,
            status: item.result || 'SCHEDULED',
            statusColor: 'orange',
            date: item.scheduledAt.toISOString(),
            dateLabel: 'Scheduled Time',
            course: lead?.courseInterested || null,
            college: item.leadCollege?.college?.name || null,
            assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
            team: assignedUser?.team?.name || null,
          };
        });

        return {
          data,
          total: interviewTotal,
          page,
          limit,
          totalPages: Math.ceil(interviewTotal / limit) || 1,
        };
      }

      // Fallback: leads with status INTERVIEW_SCHEDULED created or updated today
      const where: any = {
        status: { name: 'INTERVIEW_SCHEDULED' },
        OR: [
          { createdAt: { gte: startOfToday, lte: endOfToday } },
          { updatedAt: { gte: startOfToday, lte: endOfToday } },
        ],
      };
      if (!isSuperAdminUser) {
        where.AND = [
          {
            OR: [
              { createdById: { in: memberIds } },
              { assignments: { some: { userId: { in: memberIds } } } },
            ],
          },
        ];
      }
      if (searchFilter.OR) {
        where.AND = where.AND ? [...where.AND, { OR: searchFilter.OR }] : [{ OR: searchFilter.OR }];
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: 'INTERVIEW_SCHEDULED',
          statusColor: 'orange',
          date: lead.updatedAt.toISOString(),
          dateLabel: 'Scheduled / Updated',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 7. CALLS_TODAY (Super Admin)
    if (normMetric === 'CALLS_TODAY' || normMetric === 'CALLS') {
      const callWhere: any = {
        createdAt: { gte: startOfToday, lte: endOfToday },
      };
      if (search && search.trim()) {
        const q = search.trim();
        callWhere.OR = [
          { lead: { firstName: { contains: q, mode: 'insensitive' as const } } },
          { lead: { lastName: { contains: q, mode: 'insensitive' as const } } },
          { lead: { phone: { contains: q, mode: 'insensitive' as const } } },
          { studentData: { firstName: { contains: q, mode: 'insensitive' as const } } },
          { studentData: { phone: { contains: q, mode: 'insensitive' as const } } },
        ];
      }

      const [total, calls] = await Promise.all([
        this.prisma.callRecord.count({ where: callWhere }),
        this.prisma.callRecord.findMany({
          where: callWhere,
          include: {
            lead: { include: { status: true } },
            studentData: true,
            createdBy: { include: { team: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = calls.map((call) => {
        const student = call.lead || call.studentData;
        const sName = student ? `${student.firstName} ${student.lastName || ''}`.trim() : 'Unknown Contact';
        return {
          id: call.id,
          leadId: call.leadId || null,
          studentName: sName,
          phone: student?.phone || null,
          email: student?.email || null,
          location: student ? [student.city, student.state].filter(Boolean).join(', ') || null : null,
          notes: call.notes || call.lead?.notes || null,
          status: call.outcome || 'CALLED',
          statusColor: 'emerald',
          date: call.createdAt.toISOString(),
          dateLabel: 'Call Time',
          course: (call.lead as any)?.courseInterested || null,
          college: null,
          assignedAdvisor: call.createdBy ? `${call.createdBy.firstName} ${call.createdBy.lastName || ''}`.trim() : null,
          team: call.createdBy?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 8. ADMISSIONS_DUE_TODAY
    if (normMetric === 'ADMISSIONS_DUE_TODAY' || normMetric === 'ADMISSIONS_DUE') {
      const where: any = {
        status: {
          name: {
            in: [
              'APPLICATION',
              'INTERVIEW_SCHEDULED',
              'INTERVIEW_DONE',
              'LETTER_OUT',
            ],
          },
        },
        ...searchFilter,
      };
      if (!isSuperAdminUser) {
        where.OR = [
          { createdById: { in: memberIds } },
          { assignments: { some: { userId: { in: memberIds } } } },
        ];
        if (searchFilter.OR) {
          where.AND = [{ OR: searchFilter.OR }];
        }
      }

      const [total, records] = await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.findMany({
          where,
          include: {
            status: true,
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            assignments: {
              where: { status: 'ACTIVE' },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    team: { select: { id: true, name: true } },
                  },
                },
              },
            },
            collegeApplications: { include: { college: true }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((lead) => {
        const assignedUser = lead.assignments[0]?.user;
        return {
          id: lead.id,
          leadId: lead.id,
          studentName: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          phone: lead.phone || null,
          email: lead.email || null,
          location: [lead.city, lead.state].filter(Boolean).join(', ') || null,
          notes: lead.notes || null,
          status: lead.status?.name || 'ADMISSION_DUE',
          statusColor: 'rose',
          date: lead.updatedAt.toISOString(),
          dateLabel: 'Attention Due',
          course: lead.courseInterested || null,
          college: lead.collegeApplications[0]?.college?.name || null,
          assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : null,
          team: assignedUser?.team?.name || null,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 9. DATA_UPLOADED_TODAY
    if (normMetric === 'DATA_UPLOADED_TODAY' || normMetric === 'DATA_UPLOADED') {
      const where: any = {
        createdAt: { gte: startOfToday, lte: endOfToday },
      };
      if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
          { city: { contains: q, mode: 'insensitive' as const } },
        ];
      }

      const [total, records] = await Promise.all([
        this.prisma.studentData.count({ where }),
        this.prisma.studentData.findMany({
          where,
          include: {
            category: true,
            upload: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      const data = records.map((student) => ({
        id: student.id,
        leadId: null,
        studentName: `${student.firstName} ${student.lastName || ''}`.trim(),
        phone: student.phone || null,
        email: student.email || null,
        location: [student.city, student.state].filter(Boolean).join(', ') || null,
        notes: null,
        status: student.category?.name || 'UPLOADED',
        statusColor: 'cyan',
        date: student.createdAt.toISOString(),
        dateLabel: 'Uploaded',
        course: null,
        college: null,
        assignedAdvisor: null,
        team: null,
      }));

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // Default fallback: return empty list
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 1,
    };
  }
}
