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

  async getAdvisorDashboardStats(userId: string) {
    await this.verifyUserRole(userId, [
      'PROGRAM_ADVISOR',
      'ADVISOR',
      'SALES',
      'SUPER_ADMIN',
    ]);

    const [myLeads, myPitches, myTpcs, allStatuses] = await Promise.all([
      // Own assigned or created leads
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

      // Own pitched college applications
      this.prisma.leadCollege.findMany({
        where: { pitchedById: userId },
        include: {
          college: true,
          lead: true,
        },
      }),

      // TPC calls assigned to or created by this user
      this.prisma.tPC.findMany({
        where: {
          assignments: {
            some: {
              OR: [
                { assignedById: userId },
                { assignedToId: userId },
                { completedById: userId },
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
    ]);

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

    // Pipeline Stage Distribution
    const pipelineBreakdown = allStatuses.map((st) => {
      const count = myLeads.filter((l) => l.statusId === st.id).length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage: totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0,
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

    for (const lead of myLeads) {
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

    // Top recent leads
    const recentLeads = myLeads.slice(0, 5);

    return {
      kpis: {
        totalLeads,
        admissionsDone,
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

    const teamMembers =
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
  ) {
    await this.verifyUserRole(userId, ['SUPER_ADMIN']);

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
      expiredDataAssignmentCount,
      activeDataAssignmentCount,
      pendingTpcUsersCount,
      todayAttendances,
      allActiveUsers,
      recentActivityLogs,
      activeDataAssignments,
      admissionDoneLeads,
      todaysCallRecords,
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

      // 21. CallRecords logged
      this.prisma.callRecord.findMany({
        where: dateFilter ? { createdAt: dateFilter } : {},
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

    // Format 2. Calls Today List
    const outcomeLabelMap: Record<string, string> = {
      NO_ANSWER: 'No Answer',
      WRONG_NUMBER: 'Wrong Number',
      NOT_INTERESTED: 'Not Interested',
      FOLLOW_UP: 'Follow Up Required',
      CALL_BACK_LATER: 'Call Back Later',
      INTERESTED: 'Interested / Create Lead',
    };

    const callsTodayList = [
      ...todaysCallRecords.map((c) => {
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
      }),
      ...todaysInteractions.map((i) => {
        const advTeam = i.createdBy.team;
        const advManager = advTeam?.manager;
        return {
          id: i.id,
          student: `${i.lead.firstName} ${i.lead.lastName || ''}`.trim(),
          leadId: i.lead.id,
          studentDataId: null,
          phone: i.lead.phone,
          advisor:
            `${i.createdBy.firstName} ${i.createdBy.lastName || ''}`.trim(),
          advisorId: i.createdById,
          team: advTeam?.name || 'Unassigned',
          teamId: advTeam?.id || null,
          manager: advManager
            ? `${advManager.firstName} ${advManager.lastName || ''}`.trim()
            : 'Unassigned',
          callTime: i.createdAt.toISOString(),
          duration: 'Not Available',
          callOutcome: i.title || i.description.slice(0, 40) || 'Logged Call',
          leadStatus: i.lead.status?.name || 'LEAD',
          notes: i.description || null,
        };
      }),
      ...todaysTpcUsers.map((t) => ({
        id: t.id,
        student: t.tpc?.lead
          ? `${t.tpc.lead.firstName} ${t.tpc.lead.lastName || ''}`.trim()
          : 'Lead',
        leadId: t.tpc?.lead?.id || null,
        studentDataId: null,
        phone: t.tpc?.lead?.phone || 'Not Available',
        advisor: t.assignedTo
          ? `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim()
          : 'Advisor',
        advisorId: t.assignedToId,
        team: t.assignedTo?.team?.name || 'Unassigned',
        teamId: t.assignedTo?.team?.id || null,
        manager: 'Unassigned',
        callTime: t.createdAt.toISOString(),
        duration: 'Not Available',
        callOutcome: `TPC: ${t.status}`,
        leadStatus: 'TPC',
        notes: null,
      })),
    ].sort(
      (a, b) => new Date(b.callTime).getTime() - new Date(a.callTime).getTime(),
    );

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

      const teamCallsTodayCount = callsTodayList.filter(
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
    for (const c of callsTodayList) {
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

      const advCallsToday = callsTodayList.filter(
        (c) => c.advisorId === adv.id,
      ).length;
      const advLeadsCreated = leadsTodayList.filter(
        (l) => l.createdById === adv.id || l.assignedAdvisorId === adv.id,
      ).length;
      const advAssignedData = assignedDataMap.get(adv.id) || 0;
      const advAdmissions = advisorAdmissionsMap.get(adv.id) || 0;

      return {
        userId: adv.id,
        advisorName: advName,
        teamName: adv.team?.name || 'Unassigned',
        teamId: adv.team?.id || null,
        assignedDataCount: advAssignedData,
        callsCount: advCallsToday,
        leadsCount: advLeadsCreated,
        admissionsCount: advAdmissions,
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

    return {
      kpis: {
        leadsTodayCount: leadsTodayList.length,
        callsTodayCount: callsTodayList.length,
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
        expiredDataCount: expiredDataAssignmentCount,
        activeAssignmentsCount: activeDataAssignmentCount,
      },
      leadsTodayList,
      callsTodayList,
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
}
