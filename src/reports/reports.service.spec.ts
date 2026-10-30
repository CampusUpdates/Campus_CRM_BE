import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';

describe('ReportsService - CRM Pipeline Rules & Data Calculations', () => {
  let service: ReportsService;
  let prismaService: any;
  let teamLeadAuthService: any;

  beforeEach(async () => {
    prismaService = {
      lead: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      leadStatus: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, name: 'LEAD', color: '#6B7280' },
          { id: 2, name: 'APPLICATION', color: '#3B82F6' },
          { id: 3, name: 'INTERVIEW_SCHEDULED', color: '#8B5CF6' },
          { id: 4, name: 'INTERVIEW_DONE', color: '#EC4899' },
          { id: 5, name: 'LETTER_OUT', color: '#F59E0B' },
          { id: 6, name: 'ADMISSION_DONE', color: '#10B981' },
          { id: 7, name: 'CANCELLED', color: '#EF4444' },
        ]),
      },
      college: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    teamLeadAuthService = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('Business Logic: isCollegeCancelled & isCollegeAdmission', () => {
    it('should identify cancelled college applications properly', () => {
      expect(service.isCollegeCancelled({ isCancelled: true })).toBe(true);
      expect(service.isCollegeCancelled({ statusId: 7 })).toBe(true);
      expect(service.isCollegeCancelled({ status: { name: 'CANCELLED' } })).toBe(true);
      expect(service.isCollegeCancelled({ approvalStatus: 'CANCELLED' })).toBe(true);
      expect(service.isCollegeCancelled({ statusId: 2, status: { name: 'APPLICATION' } })).toBe(false);
    });

    it('should identify admissions based on statusId, payment, and finalCollegeId', () => {
      // 1. Direct statusId 6
      const app1 = { collegeId: 'c1', statusId: 6, status: { name: 'ADMISSION_DONE' } };
      expect(service.isCollegeAdmission(app1, {})).toBe(true);

      // 2. Admission fee payment
      const app2 = {
        collegeId: 'c2',
        statusId: 2,
        payments: [{ type: 'ADMISSION_FEE', status: 'COMPLETED' }],
      };
      expect(service.isCollegeAdmission(app2, {})).toBe(true);

      // 3. Final college matched on admitted student
      const app3 = { collegeId: 'c3', statusId: 5 };
      const leadWithFinalCollege = { finalCollegeId: 'c3', statusId: 6, status: { name: 'ADMISSION_DONE' } };
      expect(service.isCollegeAdmission(app3, leadWithFinalCollege)).toBe(true);

      // 4. Non-matching college on admitted student is not admitted
      const appOther = { collegeId: 'c4', statusId: 5 };
      expect(service.isCollegeAdmission(appOther, leadWithFinalCollege)).toBe(false);
    });
  });

  describe('Business Logic: Summary Metrics & Multi-College Pipeline Progression', () => {
    it('calculates independent college stage counts, counts application student in leads, and handles cancellations/retained', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'SUPER_ADMIN' },
      });

      // Lead 1: applied to College A (status APPLICATION, statusId 2) and College B (status LEAD, statusId 1)
      // Rule 1: A student can have multiple colleges, and each progresses independently.
      // Rule 2: A student who reached APPLICATION must still count in LEAD.
      // Rule 4: The same student may appear in multiple stage counts through different colleges.
      const lead1 = {
        id: 'lead-1',
        statusId: 2,
        status: { id: 2, name: 'APPLICATION' },
        createdAt: new Date('2026-01-01'),
        collegeApplications: [
          {
            id: 'app-1a',
            collegeId: 'c-a',
            statusId: 2,
            isCancelled: false,
            status: { name: 'APPLICATION' },
            college: { id: 'c-a', name: 'College A', code: 'CA' },
            interviews: [],
            selectionLetters: [],
            payments: [],
          },
          {
            id: 'app-1b',
            collegeId: 'c-b',
            statusId: 1,
            isCancelled: false,
            status: { name: 'LEAD' },
            college: { id: 'c-b', name: 'College B', code: 'CB' },
            interviews: [],
            selectionLetters: [],
            payments: [],
          },
        ],
        assignments: [],
      };

      // Lead 2: College C in ADMISSION_DONE (statusId 6, finalCollegeId matches), College D CANCELLED (statusId 7)
      // Rule 5: Admissions Done reflects admission-confirmation rules
      // Rule 6: Cancelled counts colleges whose admissions or applications are cancelled
      // Rule 7: Retained represents final successful admissions after accounting for cancellations
      const lead2 = {
        id: 'lead-2',
        statusId: 6,
        status: { id: 6, name: 'ADMISSION_DONE' },
        finalCollegeId: 'c-c',
        createdAt: new Date('2026-01-02'),
        collegeApplications: [
          {
            id: 'app-2c',
            collegeId: 'c-c',
            statusId: 6,
            isCancelled: false,
            status: { name: 'ADMISSION_DONE' },
            college: { id: 'c-c', name: 'College C', code: 'CC' },
            interviews: [],
            selectionLetters: [],
            payments: [{ type: 'ADMISSION_FEE', status: 'COMPLETED' }],
          },
          {
            id: 'app-2d',
            collegeId: 'c-d',
            statusId: 7,
            isCancelled: true,
            status: { name: 'CANCELLED' },
            college: { id: 'c-d', name: 'College D', code: 'CD' },
            interviews: [],
            selectionLetters: [],
            payments: [],
          },
        ],
        assignments: [],
      };

      // Lead 3: College E in INTERVIEW_SCHEDULED (statusId 3)
      const lead3 = {
        id: 'lead-3',
        statusId: 3,
        status: { id: 3, name: 'INTERVIEW_SCHEDULED' },
        createdAt: new Date('2026-01-03'),
        collegeApplications: [
          {
            id: 'app-3e',
            collegeId: 'c-e',
            statusId: 3,
            isCancelled: false,
            status: { name: 'INTERVIEW_SCHEDULED' },
            college: { id: 'c-e', name: 'College E', code: 'CE' },
            interviews: [{ status: 'SCHEDULED' }],
            selectionLetters: [],
            payments: [],
          },
        ],
        assignments: [],
      };

      // Lead 4: College F with Selection Letter (statusId 5)
      const lead4 = {
        id: 'lead-4',
        statusId: 5,
        status: { id: 5, name: 'LETTER_OUT' },
        createdAt: new Date('2026-01-04'),
        collegeApplications: [
          {
            id: 'app-4f',
            collegeId: 'c-f',
            statusId: 5,
            isCancelled: false,
            status: { name: 'LETTER_OUT' },
            college: { id: 'c-f', name: 'College F', code: 'CF' },
            interviews: [{ result: 'PASSED' }],
            selectionLetters: [{ id: 'letter-1' }],
            payments: [],
          },
        ],
        assignments: [],
      };

      prismaService.lead.findMany.mockImplementation((args: any) => {
        return Promise.resolve([lead1, lead2, lead3, lead4]);
      });
      prismaService.lead.count.mockResolvedValue(4);

      const report = await service.getCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL' },
      );

      // Verify the 8 Summary Metrics cards
      // Total leads: 4 students entered pipeline
      expect(report.summaryMetrics.total).toBe(4);

      // Application Done: 1 (Lead 1 - College A)
      expect(report.summaryMetrics.applications).toBe(1);

      // Interview Scheduled: 1 (Lead 3 - College E)
      expect(report.summaryMetrics.interviewScheduled).toBe(1);

      // Interview Done: 0
      expect(report.summaryMetrics.interviewDone).toBe(0);

      // Selected / Letter Out: 1 (Lead 4 - College F)
      expect(report.summaryMetrics.selected).toBe(1);
      expect(report.summaryMetrics.letterOut).toBe(1);

      // Admissions Done: 1 (Lead 2 - College C)
      expect(report.summaryMetrics.admissionsDone).toBe(1);

      // Cancelled: 1 (Lead 2 - College D)
      expect(report.summaryMetrics.cancelled).toBe(1);
    });

    it('filters correlated collegeId and statusId without cross-college false positive matches', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'SUPER_ADMIN' },
      });

      prismaService.lead.findMany.mockResolvedValue([]);
      prismaService.lead.count.mockResolvedValue(0);

      await service.getCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL', collegeId: 'c-a', statusId: '2' },
      );

      const findManyCall = prismaService.lead.findMany.mock.calls[0][0];
      const where = findManyCall.where;
      const andClauses = where.AND ? where.AND : [where];

      const collegeAppFilter = andClauses.find(
        (clause: any) => clause.collegeApplications !== undefined,
      );

      expect(collegeAppFilter).toBeDefined();
      expect(collegeAppFilter.collegeApplications.some.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([{ collegeId: 'c-a' }, { college: { id: 'c-a' } }]),
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([
              { statusId: 2 },
              { status: { name: { equals: 'APPLICATION', mode: 'insensitive' } } },
            ]),
          }),
          { isCancelled: false },
        ]),
      );
    });

    it('allows students who progressed to APPLICATION or beyond to match when filtering statusId 1 (LEAD)', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'SUPER_ADMIN' },
      });

      prismaService.lead.findMany.mockResolvedValue([]);
      prismaService.lead.count.mockResolvedValue(0);

      // Case 1: Filtering statusId 1 (LEAD) across all colleges
      await service.getCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL', statusId: '1' },
      );

      const findManyCall1 = prismaService.lead.findMany.mock.calls[0][0];
      // Rule 2: All leads entered pipeline as leads, so filtering statusId 1 without collegeId does not exclude them
      expect(findManyCall1.where).toEqual({});

      // Case 2: Filtering statusId 1 (LEAD) for a specific college
      await service.getCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL', collegeId: 'c-a', statusId: '1' },
      );

      const findManyCall2 = prismaService.lead.findMany.mock.calls[1][0];
      const where2 = findManyCall2.where;
      // Should match any student who had college 'c-a' pitched/applied
      expect(where2.OR).toBeDefined();
      expect(where2.OR).toContainEqual({
        collegeApplications: {
          some: {
            OR: [{ collegeId: 'c-a' }, { college: { id: 'c-a' } }],
          },
        },
      });
    });

    it('attributes admission metrics accurately to only the admitted college', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'SUPER_ADMIN' },
      });

      // Lead applied to College A and College B. Admitted ONLY to College A.
      const lead = {
        id: 'lead-multi-college',
        statusId: 6,
        status: { id: 6, name: 'ADMISSION_DONE' },
        finalCollegeId: 'c-a',
        createdAt: new Date('2026-01-01'),
        collegeApplications: [
          {
            id: 'app-a',
            collegeId: 'c-a',
            statusId: 6,
            isCancelled: false,
            status: { name: 'ADMISSION_DONE' },
            college: { id: 'c-a', name: 'College A', code: 'CA' },
            interviews: [],
            selectionLetters: [],
            payments: [{ type: 'ADMISSION_FEE', status: 'COMPLETED' }],
          },
          {
            id: 'app-b',
            collegeId: 'c-b',
            statusId: 1, // LEAD status pitch
            isCancelled: false,
            status: { name: 'LEAD' },
            college: { id: 'c-b', name: 'College B', code: 'CB' },
            interviews: [],
            selectionLetters: [],
            payments: [],
          },
        ],
        assignments: [],
      };

      prismaService.lead.findMany.mockResolvedValue([lead]);
      prismaService.lead.count.mockResolvedValue(1);

      const report = await service.getCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL' },
      );

      const collegeAData = report.collegeWiseData.find((c: any) => c.id === 'c-a');
      const collegeBData = report.collegeWiseData.find((c: any) => c.id === 'c-b');

      expect(collegeAData).toBeDefined();
      expect(collegeAData!.admissions).toBe(1);

      // College B must NOT be credited with an admission
      expect(collegeBData).toBeDefined();
      expect(collegeBData!.admissions).toBe(0);
      // College B was only a LEAD pitch, not an APPLICATION (statusId 2+)
      expect(collegeBData!.apps).toBe(0);
    });

    it('supports exportCRMReport with exact filter resolution and required relations', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: { name: 'SUPER_ADMIN' },
      });

      prismaService.lead.findMany.mockResolvedValue([]);

      const result = await service.exportCRMReport(
        { sub: 'admin-1' },
        { period: 'ALL', collegeId: 'c-a' },
      );

      expect(result).toBeDefined();
      expect(result.leads).toEqual([]);
      expect(prismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            collegeApplications: expect.objectContaining({
              include: expect.objectContaining({
                payments: true,
                selectionLetters: true,
                interviews: expect.anything(),
              }),
            }),
          }),
        }),
      );
    });
  });
});
