import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export interface HRReportFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
