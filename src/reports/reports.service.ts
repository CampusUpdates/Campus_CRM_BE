import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';

export interface RequestUser {
  sub: string;
  [key: string]: any;
}

export interface HRReportFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
}

export interface CRMReportFilters {
  period?: string;
  startDate?: string;
  endDate?: string;
  collegeId?: string;
  memberId?: string;
  statusId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamLeadAuthService: TeamLeadAuthorizationService,
  ) {}

  async getHRReport(filters: HRReportFilters) {
    const whereCandidate: any = {};
    const whereInterview: any = {};

    if (filters.startDate || filters.endDate) {
      whereCandidate.createdAt = {};
      whereInterview.createdAt = {};
      if (filters.startDate) {
        whereCandidate.createdAt.gte = new Date(filters.startDate);
        whereInterview.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereCandidate.createdAt.lte = new Date(filters.endDate);
        whereInterview.createdAt.lte = new Date(filters.endDate);
      }
    }

    if (filters.department) {
      whereCandidate.position = { department: filters.department };
    }

    const [positions, candidates, interviews, users] = await Promise.all([
      this.prisma.position.findMany({
        where: filters.department ? { department: filters.department } : {},
        include: {
          _count: {
            select: { candidates: true },
          },
        },
      }),
      this.prisma.candidate.findMany({
        where: whereCandidate,
        include: {
          position: true,
        },
      }),
      this.prisma.interview.findMany({
        where: whereInterview,
        include: {
          candidate: { include: { position: true } },
          interviewer: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
        },
      }),
      this.prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true, role: true },
      }),
    ]);

    // Summary calculations
    const totalApplications = candidates.length;
    const hiredCount = candidates.filter((c) => c.status === 'HIRED').length;
    const selectedCount = candidates.filter(
      (c) => c.status === 'SELECTED',
    ).length;
    const selectionRate =
      totalApplications > 0
        ? Math.round(((hiredCount + selectedCount) / totalApplications) * 100)
        : 0;

    const activePositions = positions.filter((p) => p.isActive);
    const totalVacancies = positions.reduce((acc, p) => acc + p.vacancies, 0);
    const vacanciesFillRate =
      totalVacancies > 0 ? Math.round((hiredCount / totalVacancies) * 100) : 0;

    const totalInterviews = interviews.length;
    const passedInterviews = interviews.filter(
      (i) => i.result === 'PASSED',
    ).length;
    const interviewPassRate =
      totalInterviews > 0
        ? Math.round((passedInterviews / totalInterviews) * 100)
        : 0;

    // Monthly Application & Hiring Trends
    const monthMap = new Map<
      string,
      { month: string; applications: number; hired: number }
    >();

    for (const cand of candidates) {
      const date = new Date(cand.createdAt);
      const monthKey = date.toLocaleString('default', {
        month: 'short',
        year: 'numeric',
      });
      const current = monthMap.get(monthKey) || {
        month: monthKey,
        applications: 0,
        hired: 0,
      };
      current.applications += 1;
      if (cand.status === 'HIRED') {
        current.hired += 1;
      }
      monthMap.set(monthKey, current);
    }

    const monthlyTrends = Array.from(monthMap.values());

    // Department Recruitment Velocity
    const deptMap = new Map<
      string,
      {
        department: string;
        openPositions: number;
        vacancies: number;
        applicants: number;
        hired: number;
      }
    >();

    for (const pos of positions) {
      const current = deptMap.get(pos.department) || {
        department: pos.department,
        openPositions: 0,
        vacancies: 0,
        applicants: 0,
        hired: 0,
      };
      if (pos.isActive) current.openPositions += 1;
      current.vacancies += pos.vacancies;
      deptMap.set(pos.department, current);
    }

    for (const cand of candidates) {
      if (cand.position?.department) {
        const dept = deptMap.get(cand.position.department);
        if (dept) {
          dept.applicants += 1;
          if (cand.status === 'HIRED') {
            dept.hired += 1;
          }
        }
      }
    }

    const departmentVelocity = Array.from(deptMap.values()).map((d) => ({
      ...d,
      fillRate: d.vacancies > 0 ? Math.round((d.hired / d.vacancies) * 100) : 0,
    }));

    // Interviewer Performance Breakdown
    const interviewerMap = new Map<
      string,
      {
        interviewerId: string;
        interviewerName: string;
        totalConducted: number;
        passedCount: number;
        failedCount: number;
        holdCount: number;
      }
    >();

    for (const intItem of interviews) {
      const name = intItem.interviewer
        ? `${intItem.interviewer.firstName} ${intItem.interviewer.lastName || ''}`.trim()
        : 'Unknown Interviewer';
      const key = intItem.interviewerId;

      const current = interviewerMap.get(key) || {
        interviewerId: key,
        interviewerName: name,
        totalConducted: 0,
        passedCount: 0,
        failedCount: 0,
        holdCount: 0,
      };

      current.totalConducted += 1;
      if (intItem.result === 'PASSED') current.passedCount += 1;
      else if (intItem.result === 'FAILED') current.failedCount += 1;
      else if (intItem.result === 'ON_HOLD') current.holdCount += 1;

      interviewerMap.set(key, current);
    }

    const interviewerPerformance = Array.from(interviewerMap.values()).map(
      (item) => ({
        ...item,
        passRate:
          item.totalConducted > 0
            ? Math.round((item.passedCount / item.totalConducted) * 100)
            : 0,
      }),
    );

    // Candidate Stage Breakdown
    const stages = [
      'APPLIED',
      'SCREENING',
      'INTERVIEW_SCHEDULED',
      'INTERVIEWED',
      'SELECTED',
      'HIRED',
      'REJECTED',
    ];

    const stageBreakdown = stages.map((stage) => ({
      stage,
      count: candidates.filter((c) => c.status === stage).length,
    }));

    // List of departments for filtering
    const allDepartments = Array.from(
      new Set(positions.map((p) => p.department)),
    );

    return {
      summary: {
        totalApplications,
        hiredCount,
        selectedCount,
        selectionRate,
        activePositions: activePositions.length,
        totalVacancies,
        vacanciesFillRate,
        totalInterviews,
        passedInterviews,
        interviewPassRate,
      },
      monthlyTrends,
      departmentVelocity,
      interviewerPerformance,
      stageBreakdown,
      allDepartments,
    };
  }

  private async resolveScopeAndFilters(user: RequestUser, filters: CRMReportFilters) {
    const userId = user.sub;
    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true, role: { select: { name: true } } },
    });
    const userRole = (userRecord?.role?.name || '').toUpperCase();
    const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(userRole);
    const isManager = ['MANAGER'].includes(userRole);
    const isTeamLead = await this.teamLeadAuthService.isTeamLead(userId);

    let baseScopeWhere: any = {};

    if (isSuperAdmin) {
      baseScopeWhere = {};
    } else if (isManager) {
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: userId },
        select: { id: true },
      });
      const managedTeamIds = managedTeams.map((t) => t.id);

      const allTeamIds = Array.from(
        new Set([...managedTeamIds, ...(userRecord?.teamId ? [userRecord.teamId] : [])]),
      );

      const teamMembers = await this.prisma.user.findMany({
        where: {
          OR: [
            ...(allTeamIds.length > 0 ? [{ teamId: { in: allTeamIds } }] : []),
            { managerId: userId },
            { id: userId },
          ],
        },
        select: { id: true },
      });
      const memberIds = teamMembers.map((m) => m.id);

      baseScopeWhere = {
        OR: [
          { createdById: { in: memberIds } },
          { assignments: { some: { userId: { in: memberIds } } } },
        ],
      };
    } else if (isTeamLead) {
      const supervisedAdvisorIds =
        await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
      const authorizedUserIds = Array.from(new Set([userId, ...supervisedAdvisorIds]));

      baseScopeWhere = {
        assignments: {
          some: {
            userId: { in: authorizedUserIds },
          },
        },
      };
    } else {
      // PROGRAM_ADVISOR
      baseScopeWhere = {
        assignments: {
          some: {
            userId: userId,
          },
        },
      };
    }


    const andConditions: any[] = [];
    if (Object.keys(baseScopeWhere).length > 0) {
      andConditions.push(baseScopeWhere);
    }

    // Period / Date Boundaries
    if (filters.period && filters.period !== 'ALL') {
      const now = new Date();
      let startBoundary: Date | null = null;
      let endBoundary: Date | null = null;

      if (filters.period === 'TODAY') {
        startBoundary = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endBoundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (filters.period === 'THIS_WEEK') {
        startBoundary = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        endBoundary = now;
      } else if (filters.period === 'THIS_MONTH') {
        startBoundary = new Date(now.getFullYear(), now.getMonth(), 1);
        endBoundary = now;
      } else if (filters.period === 'THIS_YEAR') {
        startBoundary = new Date(now.getFullYear(), 0, 1);
        endBoundary = now;
      } else if (filters.period === 'CUSTOM' && (filters.startDate || filters.endDate)) {
        if (filters.startDate) startBoundary = new Date(filters.startDate);
        if (filters.endDate) {
          endBoundary = new Date(filters.endDate);
          endBoundary.setHours(23, 59, 59, 999);
        }
      }

      if (startBoundary || endBoundary) {
        const createdAtWhere: any = {};
        if (startBoundary) createdAtWhere.gte = startBoundary;
        if (endBoundary) createdAtWhere.lte = endBoundary;
        andConditions.push({ createdAt: createdAtWhere });
      }
    }

    // College and Lead Stage Filters
    const hasCollege = Boolean(filters.collegeId && filters.collegeId !== 'ALL');
    const hasStatus = Boolean(filters.statusId && filters.statusId !== 'ALL');
    const collegeIdVal = hasCollege ? filters.collegeId! : null;

    let statusIdNum: number | null = null;
    let statusNameUpper = '';
    if (hasStatus) {
      const parsed = parseInt(filters.statusId!, 10);
      if (!isNaN(parsed)) {
        statusIdNum = parsed;
      }
      statusNameUpper = filters.statusId!.trim().toUpperCase();
    }

    // Member Filter
    if (filters.memberId && filters.memberId !== 'ALL') {
      andConditions.push({
        OR: [
          {
            assignments: {
              some: {
                userId: filters.memberId,
                status: 'ACTIVE',
              },
            },
          },
          {
            AND: [
              { assignments: { none: { status: 'ACTIVE' } } },
              { createdById: filters.memberId },
            ],
          },
        ],
      });
    }

    if (hasCollege && hasStatus) {
      // Both college and status filter applied: MUST match on the SAME college application!
      if (statusIdNum === 1 || statusNameUpper === 'LEAD') {
        // Rule 2: A student who has reached APPLICATION must still count in LEAD because the student originally entered the pipeline as a lead.
        // Any student pitched this college entered as a lead for this college!
        andConditions.push({
          OR: [
            { collegeApplications: { some: { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] } } },
            { finalCollegeId: collegeIdVal },
          ],
        });
      } else if (statusIdNum === 2 || statusNameUpper === 'APPLICATION') {
        andConditions.push({
          collegeApplications: {
            some: {
              AND: [
                { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                { OR: [{ statusId: 2 }, { status: { name: { equals: 'APPLICATION', mode: 'insensitive' } } }] },
                { isCancelled: false },
              ],
            },
          },
        });
      } else if (statusIdNum === 3 || statusNameUpper === 'INTERVIEW_SCHEDULED') {
        andConditions.push({
          collegeApplications: {
            some: {
              AND: [
                { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                {
                  OR: [
                    { statusId: 3 },
                    { status: { name: { equals: 'INTERVIEW_SCHEDULED', mode: 'insensitive' } } },
                    { interviews: { some: { status: 'SCHEDULED' } } },
                  ],
                },
                { isCancelled: false },
              ],
            },
          },
        });
      } else if (statusIdNum === 4 || statusNameUpper === 'INTERVIEW_DONE') {
        andConditions.push({
          collegeApplications: {
            some: {
              AND: [
                { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                {
                  OR: [
                    { statusId: 4 },
                    { status: { name: { equals: 'INTERVIEW_DONE', mode: 'insensitive' } } },
                    { interviews: { some: { status: 'COMPLETED' } } },
                  ],
                },
                { isCancelled: false },
              ],
            },
          },
        });
      } else if (
        statusIdNum === 5 ||
        statusNameUpper === 'LETTER_OUT' ||
        statusNameUpper.includes('LETTER') ||
        statusNameUpper.includes('SELECTION')
      ) {
        andConditions.push({
          collegeApplications: {
            some: {
              AND: [
                { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                {
                  OR: [
                    { statusId: 5 },
                    { status: { name: { equals: 'LETTER_OUT', mode: 'insensitive' } } },
                    { selectionLetters: { some: {} } },
                    { interviews: { some: { result: 'PASSED' } } },
                  ],
                },
                { isCancelled: false },
              ],
            },
          },
        });
      } else if (
        statusIdNum === 6 ||
        statusNameUpper === 'ADMISSION_DONE' ||
        statusNameUpper === 'CONFIRMED'
      ) {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  AND: [
                    { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                    {
                      OR: [
                        { statusId: 6 },
                        { status: { name: { equals: 'ADMISSION_DONE', mode: 'insensitive' } } },
                        { status: { name: { equals: 'CONFIRMED', mode: 'insensitive' } } },
                        { payments: { some: { type: 'ADMISSION_FEE' } } },
                      ],
                    },
                  ],
                },
              },
            },
            {
              AND: [
                { finalCollegeId: collegeIdVal },
                {
                  OR: [
                    { statusId: 6 },
                    { status: { name: { equals: 'ADMISSION_DONE', mode: 'insensitive' } } },
                  ],
                },
              ],
            },
          ],
        });
      } else if (
        statusIdNum === 7 ||
        statusNameUpper === 'CANCELLED' ||
        statusNameUpper.includes('CANCEL')
      ) {
        andConditions.push({
          collegeApplications: {
            some: {
              AND: [
                { OR: [{ collegeId: collegeIdVal }, { college: { id: collegeIdVal } }] },
                {
                  OR: [
                    { statusId: 7 },
                    { isCancelled: true },
                    { status: { name: { contains: 'CANCEL', mode: 'insensitive' } } },
                    { approvalStatus: { contains: 'CANCEL', mode: 'insensitive' } },
                  ],
                },
              ],
            },
          },
        });
      }
    } else if (hasCollege) {
      andConditions.push({
        OR: [
          {
            collegeApplications: {
              some: {
                OR: [
                  { collegeId: collegeIdVal },
                  { college: { id: collegeIdVal } },
                ],
              },
            },
          },
          { finalCollegeId: collegeIdVal },
        ],
      });
    } else if (hasStatus) {
      if (statusIdNum === 1 || statusNameUpper === 'LEAD') {
        // Rule 2: A student who has reached APPLICATION must still count in LEAD because the student originally entered the pipeline as a lead.
        // All students in scope originally entered as a lead!
      } else if (statusIdNum === 2 || statusNameUpper === 'APPLICATION') {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 2 },
                    { status: { name: { equals: 'APPLICATION', mode: 'insensitive' } } },
                  ],
                  isCancelled: false,
                },
              },
            },
            { statusId: 2 },
            { status: { name: { equals: 'APPLICATION', mode: 'insensitive' } } },
          ],
        });
      } else if (statusIdNum === 3 || statusNameUpper === 'INTERVIEW_SCHEDULED') {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 3 },
                    { status: { name: { equals: 'INTERVIEW_SCHEDULED', mode: 'insensitive' } } },
                    { interviews: { some: { status: 'SCHEDULED' } } },
                  ],
                  isCancelled: false,
                },
              },
            },
            { statusId: 3 },
            { status: { name: { equals: 'INTERVIEW_SCHEDULED', mode: 'insensitive' } } },
          ],
        });
      } else if (statusIdNum === 4 || statusNameUpper === 'INTERVIEW_DONE') {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 4 },
                    { status: { name: { equals: 'INTERVIEW_DONE', mode: 'insensitive' } } },
                    { interviews: { some: { status: 'COMPLETED' } } },
                  ],
                  isCancelled: false,
                },
              },
            },
            { statusId: 4 },
            { status: { name: { equals: 'INTERVIEW_DONE', mode: 'insensitive' } } },
          ],
        });
      } else if (
        statusIdNum === 5 ||
        statusNameUpper === 'LETTER_OUT' ||
        statusNameUpper.includes('LETTER') ||
        statusNameUpper.includes('SELECTION')
      ) {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 5 },
                    { status: { name: { equals: 'LETTER_OUT', mode: 'insensitive' } } },
                    { selectionLetters: { some: {} } },
                    { interviews: { some: { result: 'PASSED' } } },
                  ],
                  isCancelled: false,
                },
              },
            },
            { statusId: 5 },
            { status: { name: { equals: 'LETTER_OUT', mode: 'insensitive' } } },
          ],
        });
      } else if (
        statusIdNum === 6 ||
        statusNameUpper === 'ADMISSION_DONE' ||
        statusNameUpper === 'CONFIRMED'
      ) {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 6 },
                    { status: { name: { equals: 'ADMISSION_DONE', mode: 'insensitive' } } },
                    { status: { name: { equals: 'CONFIRMED', mode: 'insensitive' } } },
                    { payments: { some: { type: 'ADMISSION_FEE' } } },
                  ],
                },
              },
            },
            { statusId: 6 },
            { status: { name: { equals: 'ADMISSION_DONE', mode: 'insensitive' } } },
            { status: { name: { equals: 'CONFIRMED', mode: 'insensitive' } } },
          ],
        });
      } else if (
        statusIdNum === 7 ||
        statusNameUpper === 'CANCELLED' ||
        statusNameUpper.includes('CANCEL')
      ) {
        andConditions.push({
          OR: [
            {
              collegeApplications: {
                some: {
                  OR: [
                    { statusId: 7 },
                    { isCancelled: true },
                    { status: { name: { contains: 'CANCEL', mode: 'insensitive' } } },
                    { approvalStatus: { contains: 'CANCEL', mode: 'insensitive' } },
                  ],
                },
              },
            },
            { statusId: 7 },
            { status: { name: { contains: 'CANCEL', mode: 'insensitive' } } },
          ],
        });
      }
    }

    // Search Filter
    if (filters.search && filters.search.trim() !== '') {
      const term = filters.search.trim();
      andConditions.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
          { status: { name: { contains: term, mode: 'insensitive' } } },
          { collegeApplications: { some: { college: { name: { contains: term, mode: 'insensitive' } } } } },
        ],
      });
    }

    return {
      WHERE: andConditions.length === 0 ? {} : andConditions.length === 1 ? andConditions[0] : { AND: andConditions },
    };
  }

  isCollegeCancelled(app: any): boolean {
    const stName = (app.status?.name || '').toUpperCase();
    const appSt = (app.approvalStatus || '').toUpperCase();
    return Boolean(
      app.isCancelled ||
      app.statusId === 7 ||
      stName.includes('CANCEL') ||
      appSt.includes('CANCEL'),
    );
  }

  isCollegeAdmission(app: any, lead: any): boolean {
    const stName = (app.status?.name || '').toUpperCase();
    return Boolean(
      app.statusId === 6 ||
      stName === 'ADMISSION_DONE' ||
      stName === 'CONFIRMED' ||
      (app.payments &&
        app.payments.some(
          (p: any) =>
            p.type === 'ADMISSION_FEE' || p.paymentType === 'ADMISSION_FEE',
        )) ||
      (lead.finalCollegeId &&
        (lead.finalCollegeId === app.collegeId ||
          lead.finalCollegeId === app.college?.id) &&
        (lead.statusId === 6 ||
          (lead.status?.name || '').toUpperCase() === 'ADMISSION_DONE')),
    );
  }

  async getCRMReport(user: RequestUser, filters: CRMReportFilters) {
    const { WHERE } = await this.resolveScopeAndFilters(user, filters);

    // Retrieve full authorized + filtered leads for complete scope calculations
    const leads = await this.prisma.lead.findMany({
      where: WHERE,
      include: {
        status: true,
        team: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignments: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        collegeApplications: {
          include: {
            college: {
              select: { id: true, name: true },
            },
            status: true,
            interviews: {
              orderBy: { createdAt: 'desc' },
            },
            selectionLetters: true,
            payments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 1. Summary Metrics
    const total = leads.length;
    let applications = 0;
    let interviewScheduled = 0;
    let interviewDone = 0;
    let selected = 0;
    let letterOut = 0;
    let admissionsDone = 0;
    let cancelled = 0;

    const targetCollegeId =
      filters.collegeId && filters.collegeId !== 'ALL'
        ? filters.collegeId
        : null;

    leads.forEach((l) => {
      let apps = l.collegeApplications || [];
      if (targetCollegeId) {
        apps = apps.filter(
          (a) =>
            a.collegeId === targetCollegeId ||
            a.college?.id === targetCollegeId,
        );
      }

      if (apps.length > 0) {
        apps.forEach((app) => {
          const stName = (app.status?.name || '').toUpperCase();
          const isCancelled = this.isCollegeCancelled(app);
          const isAdmission = this.isCollegeAdmission(app, l);

          if (isCancelled) {
            cancelled++;
          }

          if (isAdmission) {
            admissionsDone++;
          }

          if (!isCancelled) {
            if (app.statusId === 2 || stName === 'APPLICATION') {
              applications++;
            }
            if (
              app.statusId === 3 ||
              stName === 'INTERVIEW_SCHEDULED' ||
              app.interviews?.some((i) => i.status === 'SCHEDULED')
            ) {
              interviewScheduled++;
            }
            if (
              app.statusId === 4 ||
              stName === 'INTERVIEW_DONE' ||
              app.interviews?.some(
                (i) => i.status === 'COMPLETED' && i.result !== 'PASSED',
              )
            ) {
              interviewDone++;
            }
            if (
              app.interviews?.some((i) => i.result === 'PASSED') ||
              (app.selectionLetters && app.selectionLetters.length > 0) ||
              app.statusId === 5 ||
              stName.includes('SELECTION')
            ) {
              selected++;
            }
            if (
              app.statusId === 5 ||
              stName === 'LETTER_OUT' ||
              (app.selectionLetters && app.selectionLetters.length > 0)
            ) {
              letterOut++;
            }
          }
        });
      } else if (!targetCollegeId) {
        const stName = (l.status?.name || '').toUpperCase();
        const isCancelled = l.statusId === 7 || stName.includes('CANCEL');
        const isAdmission =
          l.statusId === 6 ||
          stName === 'ADMISSION_DONE' ||
          stName === 'CONFIRMED' ||
          stName.includes('ADMISSION');

        if (isCancelled) {
          cancelled++;
        }

        if (isAdmission) {
          admissionsDone++;
        }

        if (!isCancelled) {
          if (l.statusId === 2 || stName.includes('APP')) applications++;
          if (
            l.statusId === 3 ||
            stName.includes('INTERVIEW_SCHEDULED') ||
            stName === 'INTERVIEW SCHEDULED'
          ) {
            interviewScheduled++;
          }
          if (
            l.statusId === 4 ||
            stName.includes('INTERVIEW_DONE') ||
            stName === 'INTERVIEW DONE'
          ) {
            interviewDone++;
          }
          if (
            l.statusId === 5 ||
            stName.includes('LETTER') ||
            stName === 'LETTER OUT' ||
            stName.includes('SELECTION')
          ) {
            selected++;
            letterOut++;
          }
        }
      }
    });

    const summaryMetrics = {
      total,
      applications,
      interviewScheduled,
      interviewDone,
      selected,
      letterOut,
      admissionsDone,
      cancelled,
    };

    // 2. College Performance Aggregations
    const collegeMap = new Map<
      string,
      { id: string; name: string; leads: number; apps: number; interviews: number; admissions: number }
    >();

    leads.forEach((lead) => {
      const apps = lead.collegeApplications || [];
      if (apps.length > 0) {
        apps.forEach((app) => {
          if (
            targetCollegeId &&
            app.collegeId !== targetCollegeId &&
            app.college?.id !== targetCollegeId
          ) {
            return;
          }

          const cId = app.collegeId || app.college?.id || 'Unknown';
          const cName = app.college?.name || 'Other College';
          if (!collegeMap.has(cId)) {
            collegeMap.set(cId, { id: cId, name: cName, leads: 0, apps: 0, interviews: 0, admissions: 0 });
          }
          const curr = collegeMap.get(cId)!;
          curr.leads++;

          const isCancelled = this.isCollegeCancelled(app);
          const isAdmission = this.isCollegeAdmission(app, lead);

          // Apps: college applications that reached application stage or beyond
          if (
            !isCancelled &&
            (app.statusId === 2 ||
              (app.status?.name || '').toUpperCase() === 'APPLICATION' ||
              app.statusId >= 3 ||
              Boolean(app.applicationId))
          ) {
            curr.apps++;
          }

          // Interviews: scheduled or completed interviews for this college
          if (
            !isCancelled &&
            (app.statusId === 3 ||
              app.statusId === 4 ||
              (app.interviews && app.interviews.length > 0))
          ) {
            curr.interviews++;
          }

          // Admissions: confirmed admissions for this college
          if (isAdmission && !isCancelled) {
            curr.admissions++;
          }
        });
      } else if (!targetCollegeId) {
        const cId = 'UNSPECIFIED';
        if (!collegeMap.has(cId)) {
          collegeMap.set(cId, { id: cId, name: 'Direct / General Leads', leads: 0, apps: 0, interviews: 0, admissions: 0 });
        }
        const curr = collegeMap.get(cId)!;
        curr.leads++;
        const st = (lead.status?.name || '').toUpperCase();
        if (lead.statusId === 2 || st.includes('APP')) curr.apps++;
        if (st.includes('INTERVIEW')) curr.interviews++;
        if (lead.statusId === 6 || st.includes('ADMISSION') || st === 'CONFIRMED') curr.admissions++;
      }
    });
    const collegeWiseData = Array.from(collegeMap.values());

    // 3. Member Performance Aggregations
    const memberMap = new Map<
      string,
      { id: string; name: string; leads: number; apps: number; interviews: number; admissions: number }
    >();

    leads.forEach((lead) => {
      const activeAssignment = lead.assignments?.find((a) => a.status === 'ACTIVE');
      const assignedUser = activeAssignment?.user || lead.createdBy;
      const mId = assignedUser?.id || 'UNASSIGNED';
      const mName = assignedUser
        ? `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim()
        : 'Unassigned';

      if (!memberMap.has(mId)) {
        memberMap.set(mId, { id: mId, name: mName, leads: 0, apps: 0, interviews: 0, admissions: 0 });
      }
      const curr = memberMap.get(mId)!;
      curr.leads++;

      let apps = lead.collegeApplications || [];
      if (targetCollegeId) {
        apps = apps.filter(
          (a) => a.collegeId === targetCollegeId || a.college?.id === targetCollegeId,
        );
      }

      const hasApp = apps.some(
        (a) =>
          !this.isCollegeCancelled(a) &&
          (a.statusId === 2 ||
            (a.status?.name || '').toUpperCase() === 'APPLICATION' ||
            a.statusId >= 3 ||
            Boolean(a.applicationId)),
      );
      if (
        hasApp ||
        (apps.length === 0 &&
          (lead.statusId === 2 ||
            (lead.status?.name || '').toUpperCase().includes('APP')))
      ) {
        curr.apps++;
      }

      const hasInterview = apps.some(
        (a) =>
          !this.isCollegeCancelled(a) &&
          (a.statusId === 3 ||
            a.statusId === 4 ||
            (a.interviews && a.interviews.length > 0)),
      );
      if (
        hasInterview ||
        (apps.length === 0 &&
          (lead.statusId === 3 ||
            lead.statusId === 4 ||
            (lead.status?.name || '').toUpperCase().includes('INTERVIEW')))
      ) {
        curr.interviews++;
      }

      const hasAdmission = apps.some(
        (a) => this.isCollegeAdmission(a, lead) && !this.isCollegeCancelled(a),
      );
      if (
        hasAdmission ||
        (apps.length === 0 &&
          (lead.statusId === 6 ||
            (lead.status?.name || '').toUpperCase() === 'ADMISSION_DONE' ||
            (lead.status?.name || '').toUpperCase() === 'CONFIRMED'))
      ) {
        curr.admissions++;
      }
    });
    const memberWiseData = Array.from(memberMap.values());

    // 4. Pagination ONLY for Detailed Lead Dataset
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 10;
    const totalFilteredCount = leads.length;
    const totalPages = Math.ceil(totalFilteredCount / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const paginatedLeads = leads.slice(startIndex, startIndex + pageSize);

    return {
      summaryMetrics,
      collegeWiseData,
      memberWiseData,
      leadDataset: paginatedLeads,
      totalFilteredCount,
      totalPages,
      currentPage: page,
      pageSize,
    };
  }

  async exportCRMReport(user: RequestUser, filters: CRMReportFilters) {
    const { WHERE } = await this.resolveScopeAndFilters(user, filters);

    // Retrieve COMPLETE matching dataset without pagination limits
    const leads = await this.prisma.lead.findMany({
      where: WHERE,
      include: {
        status: true,
        team: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignments: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        collegeApplications: {
          include: {
            college: {
              select: { id: true, name: true },
            },
            status: true,
            interviews: {
              orderBy: { createdAt: 'desc' },
            },
            selectionLetters: true,
            payments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      leads,
      totalCount: leads.length,
    };
  }
}

