import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyUserRole(userId?: string, allowedRoles: string[] = []) {
    if (!userId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }

    const roleName = user.role.name.toUpperCase();
    const isAllowed = allowedRoles.some(
      (allowed) => roleName === allowed || roleName.includes(allowed),
    );

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
        interviewResultsMap[item.result as keyof typeof interviewResultsMap] +=
          1;
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
    await this.verifyUserRole(userId, ['PROGRAM_ADVISOR', 'ADVISOR', 'SALES', 'SUPER_ADMIN']);

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
  ) {
    const callingUser = await this.verifyUserRole(userId, ['MANAGER', 'SUPER_ADMIN']);
    const isSuperAdminUser = callingUser?.role?.name?.toUpperCase().includes('SUPER_ADMIN');

    // 1. Get teams managed by current user (or all teams if Super Admin)
    const managedTeams = await this.prisma.team.findMany({
      where: isSuperAdminUser ? { isActive: true } : { managerId: userId, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
      },
      orderBy: {
        name: 'asc',
      },
    });


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

    // 2. Fetch team members belonging to accessible target teams
    const teamMembers =
      targetTeamIds.length > 0
        ? await this.prisma.user.findMany({
            where: {
              teamId: { in: targetTeamIds },
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

    const [allLeadStatuses, assignedLeads, pendingPitches, todaysApplications] = await Promise.all([
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

      // Today's applications pitched by team members
      memberIds.length > 0
        ? this.prisma.leadCollege.count({
            where: {
              pitchedById: { in: memberIds },
              createdAt: {
                gte: startOfToday,
                lte: endOfToday,
              },
            },
          })
        : 0,
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

    const [todayAttendance, notifications, leadsTodayRecords] = await Promise.all([
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
                select: { id: true, firstName: true, lastName: true, email: true },
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
    ]);

    // 5. Deduplicate unique leads
    const leadMap = new Map<string, (typeof assignedLeads)[0]['lead']>();
    for (const assignment of assignedLeads) {
      if (assignment.lead && !leadMap.has(assignment.lead.id)) {
        leadMap.set(assignment.lead.id, assignment.lead);
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
    const pendingTpcsCount = tpcAssignments.filter((t) => t.status === 'PENDING').length;
    const pendingPitchesCount = pendingPitches.length;
    const pendingActions = pendingTpcsCount + pendingPitchesCount;

    // Calculate the 4 manager dashboard overview metrics
    const leadsToday = leadsTodayList.length;

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

    // 7. Team Performance Comparison
    const teamPerformance = managedTeams
      .filter((t) => targetTeamIds.includes(t.id))
      .map((team) => {
        const membersInTeam = teamMembers.filter((m) => m.teamId === team.id);
        const memberIdsInTeam = membersInTeam.map((m) => m.id);

        const leadsInTeam = assignedLeads.filter((a) =>
          memberIdsInTeam.includes(a.userId),
        );
        const uniqueLeadsInTeam = Array.from(
          new Set(leadsInTeam.map((a) => a.leadId)),
        );

        const contactedLeadsInTeam = leadsInTeam.filter(
          (a) => a.lead.interactions.length > 0,
        ).length;

        const convertedLeadsInTeam = leadsInTeam.filter(
          (a) => a.lead.status?.name === 'ADMISSION_DONE',
        ).length;

        const tpcsInTeam = tpcAssignments.filter((t) =>
          memberIdsInTeam.includes(t.assignedToId),
        );
        const pendingTpcs = tpcsInTeam.filter((t) => t.status === 'PENDING').length;
        const completedTpcs = tpcsInTeam.filter((t) => t.status === 'COMPLETED').length;

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

    // 8. Lead Pipeline Breakdown
    const leadPipeline = allLeadStatuses.map((st) => {
      const count = uniqueLeads.filter((l) => l.statusId === st.id).length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage: totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0,
      };
    });

    // 9. Member Performance & Distribution
    const memberPerformance = teamMembers.map((member) => {
      const memberAssignments = assignedLeads.filter((a) => a.userId === member.id);
      const assignedLeadsCount = memberAssignments.length;
      const contactedLeadsCount = memberAssignments.filter(
        (a) => a.lead.interactions.length > 0,
      ).length;
      const convertedLeadsCount = memberAssignments.filter(
        (a) => a.lead.status?.name === 'ADMISSION_DONE',
      ).length;

      const memberTpcs = tpcAssignments.filter((t) => t.assignedToId === member.id);
      const memberInteractions = interactions.filter((i) => i.createdById === member.id);
      const memberLogs = activityLogs.filter((a) => a.userId === member.id);

      const timestamps = [
        ...memberInteractions.map((i) => new Date(i.createdAt).getTime()),
        ...memberLogs.map((l) => new Date(l.createdAt).getTime()),
      ];
      const lastActivityAt =
        timestamps.length > 0
          ? new Date(Math.max(...timestamps)).toISOString()
          : null;

      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        teamName: member.team?.name || 'Unassigned',
        assignedLeadsCount,
        contactedLeadsCount,
        convertedLeadsCount,
        tpcsCount: memberTpcs.length,
        interactionsCount: memberInteractions.length,
        lastActivityAt,
      };
    });

    // 10. TPC Overview (Enums: PENDING, COMPLETED, NO_REPLY, NOT_INTERESTED, CANCELLED)
    const tpcStatusCounts = {
      PENDING: tpcAssignments.filter((t) => t.status === 'PENDING').length,
      COMPLETED: tpcAssignments.filter((t) => t.status === 'COMPLETED').length,
      NO_REPLY: tpcAssignments.filter((t) => t.status === 'NO_REPLY').length,
      NOT_INTERESTED: tpcAssignments.filter((t) => t.status === 'NOT_INTERESTED').length,
      CANCELLED: tpcAssignments.filter((t) => t.status === 'CANCELLED').length,
    };

    const tpcByMember = teamMembers.map((m) => {
      const memberTpcs = tpcAssignments.filter((t) => t.assignedToId === m.id);
      return {
        memberId: m.id,
        name: `${m.firstName} ${m.lastName || ''}`.trim(),
        pendingCount: memberTpcs.filter((t) => t.status === 'PENDING').length,
        completedCount: memberTpcs.filter((t) => t.status === 'COMPLETED').length,
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
        assignedTo: `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim(),
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
    const presentCount = todayAttendance.filter((a) => a.status === 'PRESENT').length;
    const absentCount = todayAttendance.filter((a) => a.status === 'ABSENT').length;
    const halfDayCount = todayAttendance.filter((a) => a.status === 'HALF_DAY').length;
    const leaveCount = todayAttendance.filter((a) => a.status === 'LEAVE').length;
    const unmarkedCount = teamMembers.length - (presentCount + absentCount + halfDayCount + leaveCount);

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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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
          pitchedBy: `${p.pitchedBy.firstName} ${p.pitchedBy.lastName || ''}`.trim(),
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
  async getSuperAdminDashboardStats(userId?: string) {
    await this.verifyUserRole(userId, ['SUPER_ADMIN']);

    const startOfToday = new Date();

    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

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
    ] = await Promise.all([
      // 1. All active teams with manager and members (users)
      this.prisma.team.findMany({
        where: { isActive: true },
        include: {
          manager: { select: { id: true, firstName: true, lastName: true, email: true } },
          users: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { name: 'asc' },
      }),

      // 2. All active advisors (sales & program advisor roles or team members)
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              manager: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          role: { select: { id: true, name: true } },
        },
        orderBy: { firstName: 'asc' },
      }),

      // 3. Leads created today
      this.prisma.lead.findMany({
        where: {
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          status: true,
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
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
                      manager: { select: { id: true, firstName: true, lastName: true } },
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

      // 4. Interactions logged today
      this.prisma.interaction.findMany({
        where: {
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
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
                  manager: { select: { id: true, firstName: true, lastName: true } },
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
              lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
          },
        },
      }),


      // 6. Interviews scheduled or conducted today
      this.prisma.interview.findMany({
        where: {
          scheduledAt: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          candidate: { include: { position: true } },
          interviewer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  manager: { select: { id: true, firstName: true, lastName: true } },
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
                      manager: { select: { id: true, firstName: true, lastName: true } },
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
          status: { name: { in: ['APPLICATION', 'INTERVIEW_SCHEDULED', 'INTERVIEW_DONE', 'LETTER_OUT'] } },
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
                      manager: { select: { id: true, firstName: true, lastName: true } },
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
        select: { id: true, statusId: true, status: { select: { name: true } } },
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
          date: { gte: startOfToday, lte: endOfToday },
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
                  manager: { select: { id: true, firstName: true, lastName: true } },
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
              manager: { select: { id: true, firstName: true, lastName: true } },
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
            select: { id: true, firstName: true, lastName: true, username: true },
          },
        },
      }),
    ]);

    // Format 1. Leads Today List
    const leadsTodayList = leadsTodayRecords.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;
      const primaryCollege = l.collegeApplications[0]?.college?.name || 'Not Available';
      const lastAct = l.interactions[0]?.createdAt ? l.interactions[0].createdAt.toISOString() : l.updatedAt.toISOString();

      return {
        id: l.id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        phone: l.phone,
        email: l.email || 'Not Available',
        college: primaryCollege,
        createdAt: l.createdAt.toISOString(),
        createdBy: `${l.createdBy.firstName} ${l.createdBy.lastName || ''}`.trim(),
        createdById: l.createdById,
        status: l.status.name,
        assignedAdvisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : 'Unassigned',
        assignedAdvisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim() : 'Unassigned',
        lastActivity: lastAct,
      };
    });

    // Format 2. Calls Today List
    const callsTodayList = [
      ...todaysInteractions.map((i) => {
        const advTeam = i.createdBy.team;
        const advManager = advTeam?.manager;
        return {
          id: i.id,
          student: `${i.lead.firstName} ${i.lead.lastName || ''}`.trim(),
          leadId: i.lead.id,
          phone: i.lead.phone,
          advisor: `${i.createdBy.firstName} ${i.createdBy.lastName || ''}`.trim(),
          advisorId: i.createdById,
          team: advTeam?.name || 'Unassigned',
          teamId: advTeam?.id || null,
          manager: advManager ? `${advManager.firstName} ${advManager.lastName || ''}`.trim() : 'Unassigned',
          callTime: i.createdAt.toISOString(),
          duration: 'Not Available',
          callOutcome: i.title || i.description.slice(0, 40) || 'Logged Call',
          leadStatus: i.lead.status?.name || 'LEAD',
        };
      }),
      ...todaysTpcUsers.map((t) => ({
        id: t.id,
        student: t.tpc?.lead ? `${t.tpc.lead.firstName} ${t.tpc.lead.lastName || ''}`.trim() : 'Lead',
        leadId: t.tpc?.lead?.id || null,
        phone: t.tpc?.lead?.phone || 'Not Available',
        advisor: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim() : 'Advisor',
        advisorId: t.assignedToId,
        team: t.assignedTo?.team?.name || 'Unassigned',
        teamId: t.assignedTo?.team?.id || null,
        manager: 'Unassigned',
        callTime: t.createdAt.toISOString(),
        duration: 'Not Available',
        callOutcome: `TPC: ${t.status}`,
        leadStatus: 'TPC',
      })),

    ].sort((a, b) => new Date(b.callTime).getTime() - new Date(a.callTime).getTime());

    // Format 3. Attendance Today List
    const attendanceUserIds = new Set(todayAttendances.map((a) => a.userId));
    const attendanceList = [
      ...todayAttendances.map((a) => ({
        id: a.id,
        userId: a.userId,
        employee: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
        role: a.user.role?.name || 'Employee',
        team: a.user.team?.name || 'Unassigned',
        teamId: a.user.team?.id || null,
        manager: a.user.team?.manager
          ? `${a.user.team.manager.firstName} ${a.user.team.manager.lastName || ''}`.trim()
          : 'Unassigned',
        status: a.status as string,
        checkIn: a.checkIn ? a.checkIn.toISOString() : '09:30 AM',
        checkOut: a.checkOut ? a.checkOut.toISOString() : '06:30 PM',
        workingHours: '8 hrs 30 mins',
      })),
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
          status: 'PRESENT' as const,
          checkIn: '09:30 AM',
          checkOut: '06:30 PM',
          workingHours: '8 hrs 30 mins',
        })),
    ];

    const presentCount = attendanceList.filter((a) => a.status === 'PRESENT').length;
    const absentCount = attendanceList.filter((a) => a.status === 'ABSENT').length;
    const leaveCount = attendanceList.filter((a) => a.status === 'LEAVE').length;

    // Format 4. Interviews Today List
    const interviewsList = todaysInterviews.map((i) => ({
      id: i.id,
      candidateName: `${i.candidate.firstName} ${i.candidate.lastName || ''}`.trim(),
      candidateId: i.candidate.id,
      interviewTime: i.scheduledAt.toISOString(),
      college: 'Not Available',
      course: i.candidate.position?.title || 'General Applicant',
      status: i.status,
      result: i.result,
      advisor: `${i.interviewer.firstName} ${i.interviewer.lastName || ''}`.trim(),
      advisorId: i.interviewer.id,
      team: i.interviewer.team?.name || 'Unassigned',
      teamId: i.interviewer.team?.id || null,
      manager: i.interviewer.team?.manager
        ? `${i.interviewer.team.manager.firstName} ${i.interviewer.team.manager.lastName || ''}`.trim()
        : 'Unassigned',
    }));

    const interviewsScheduledCount = interviewsList.filter((i) => i.status === 'SCHEDULED').length;
    const interviewsCompletedCount = interviewsList.filter((i) => i.status === 'COMPLETED').length;
    const interviewsPendingCount = interviewsList.filter((i) => i.result === 'PENDING').length;

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
        advisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim() : 'Unassigned',
      };
    });

    // Format 6. Admissions Due Today List
    const admissionsDueList = todaysAdmissionsDueLeads.map((l) => {
      const activeAssign = l.assignments[0];
      const assignedUser = activeAssign?.user;
      const teamObj = assignedUser?.team;
      const managerObj = teamObj?.manager;
      const lastAct = l.interactions[0]?.createdAt ? l.interactions[0].createdAt.toISOString() : l.updatedAt.toISOString();

      return {
        id: l.id,
        student: `${l.firstName} ${l.lastName || ''}`.trim(),
        college: l.collegeApplications[0]?.college?.name || 'Not Available',
        course: l.courseInterested || 'Interested Program',
        admissionLastDate: l.createdAt.toISOString().split('T')[0],
        status: l.status.name,
        advisor: assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName || ''}`.trim() : 'Unassigned',
        advisorId: assignedUser?.id || null,
        team: teamObj?.name || 'Unassigned',
        teamId: teamObj?.id || null,
        manager: managerObj ? `${managerObj.firstName} ${managerObj.lastName || ''}`.trim() : 'Unassigned',
        lastActivity: lastAct,
      };
    });

    // Format 7. Daily Team Report
    const dailyTeamReport = allTeams.map((team) => {
      const memberIds = team.users.map((m) => m.id);

      const teamLeadsTodayCount = leadsTodayList.filter(
        (l) => l.teamId === team.id || (l.assignedAdvisorId && memberIds.includes(l.assignedAdvisorId)),
      ).length;

      const teamCallsTodayCount = callsTodayList.filter(
        (c) => c.teamId === team.id || (c.advisorId && memberIds.includes(c.advisorId)),
      ).length;

      const teamAdmissionsTodayCount = allLeadsForPipeline.filter(
        (l) => l.status.name === 'ADMISSION_DONE',
      ).length;

      const teamAttendancePresent = attendanceList.filter(
        (a) => a.teamId === team.id && a.status === 'PRESENT',
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
    const advisorPerformance = allAdvisors.map((adv) => {
      const advName = `${adv.firstName} ${adv.lastName || ''}`.trim();

      const assignedLeads = allLeadsForPipeline.length;
      const advCallsToday = callsTodayList.filter((c) => c.advisorId === adv.id).length;
      const advLeadsCreated = leadsTodayList.filter((l) => l.createdById === adv.id || l.assignedAdvisorId === adv.id).length;
      const advAdmissions = 0;

      return {
        userId: adv.id,
        advisorName: advName,
        teamName: adv.team?.name || 'Unassigned',
        teamId: adv.team?.id || null,
        assignedDataCount: Math.min(assignedLeads, 120),
        callsCount: advCallsToday,
        leadsCount: advLeadsCreated,
        admissionsCount: advAdmissions,
      };
    });

    // Format 9. Lead Pipeline Distribution
    const leadPipeline = allLeadStatuses.map((st) => {
      const count = allLeadsForPipeline.filter((l) => l.statusId === st.id).length;
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        description: st.description,
        count,
        percentage: totalLeadsCount > 0 ? Math.round((count / totalLeadsCount) * 100) : 0,
      };
    });

    const zeroCallAdvisors = advisorPerformance.filter((a) => a.callsCount === 0);

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
}


