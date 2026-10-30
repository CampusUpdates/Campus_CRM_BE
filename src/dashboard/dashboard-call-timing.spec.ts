import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamLeadAuthorizationService } from 'src/teams/team-lead-authorization.service';

describe('DashboardService - Call Timing Filters (Pre-Lunch, Post-Lunch, All Day)', () => {
  let service: DashboardService;
  let prismaMock: any;
  let teamLeadAuthMock: any;

  const mockSuperAdminUser = {
    id: 'super-admin-uuid',
    firstName: 'Super',
    lastName: 'Admin',
    role: { id: 1, name: 'SUPER_ADMIN' },
  };

  const mockAdvisors = [
    {
      id: 'adv-1',
      firstName: 'Alice',
      lastName: 'Sharma',
      team: { id: 101, name: 'Alpha Team' },
    },
    {
      id: 'adv-2',
      firstName: 'Bob',
      lastName: 'Verma',
      team: { id: 101, name: 'Alpha Team' },
    },
  ];

  const mockTeams = [
    {
      id: 101,
      name: 'Alpha Team',
      manager: { id: 'mgr-1', firstName: 'John', lastName: 'Doe' },
      users: mockAdvisors,
    },
  ];

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockSuperAdminUser),
        findMany: jest.fn().mockResolvedValue(mockAdvisors),
        count: jest.fn().mockResolvedValue(2),
      },
      team: {
        findMany: jest.fn().mockResolvedValue(mockTeams),
      },
      callRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      interaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadCollegeInterview: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tPCUser: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      activityLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      leadStatus: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studentData: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      dataAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      attendance: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      interview: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tpcCandidate: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      position: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      candidate: {
        count: jest.fn().mockResolvedValue(0),
      },
      dataUpload: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalRows: 0 } }),
      },
    };

    teamLeadAuthMock = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthMock },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  describe('Boundary Conditions for Call Timing Filters', () => {
    it('1. PRE_LUNCH filters createdAt between 10:00:00 and 14:00:00 inclusive', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        undefined,
        'PRE_LUNCH',
      );

      // Inspect callRecord.count filter
      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      expect(countCall.where).toBeDefined();
      expect(countCall.where.createdAt).toBeDefined();

      const { gte, lte } = countCall.where.createdAt;
      expect(gte).toBeInstanceOf(Date);
      expect(lte).toBeInstanceOf(Date);

      // 10:00:00.000 local time
      expect(gte.getHours()).toBe(10);
      expect(gte.getMinutes()).toBe(0);
      expect(gte.getSeconds()).toBe(0);

      // 14:00:00.000 local time (2:00 PM)
      expect(lte.getHours()).toBe(14);
      expect(lte.getMinutes()).toBe(0);
      expect(lte.getSeconds()).toBe(0);

      // Check boundary conditions against the filter:
      // Call at 10:00:00 (start boundary) -> MATCHES
      const callAt10 = new Date(gte);
      expect(callAt10 >= gte && callAt10 <= lte).toBe(true);

      // Call at 14:00:00 (end boundary: 2:00 PM) -> MATCHES
      const callAt14 = new Date(lte);
      expect(callAt14 >= gte && callAt14 <= lte).toBe(true);

      // Call at 14:00:01 (1 second past 2:00 PM) -> DOES NOT MATCH
      const callAt1401 = new Date(lte.getTime() + 1000);
      expect(callAt1401 >= gte && callAt1401 <= lte).toBe(false);

      // Call at 14:15:00 (lunch break) -> DOES NOT MATCH
      const callAtLunch = new Date(lte);
      callAtLunch.setMinutes(15);
      expect(callAtLunch >= gte && callAtLunch <= lte).toBe(false);

      // Call at 14:30:00 (post-lunch start) -> DOES NOT MATCH
      const callAtPostLunchStart = new Date(lte);
      callAtPostLunchStart.setMinutes(30);
      expect(callAtPostLunchStart >= gte && callAtPostLunchStart <= lte).toBe(false);
    });

    it('2. POST_LUNCH filters createdAt between 14:30:00 and 19:00:00 inclusive', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        undefined,
        'POST_LUNCH',
      );

      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      const { gte, lte } = countCall.where.createdAt;

      // 14:30:00.000 local time (2:30 PM)
      expect(gte.getHours()).toBe(14);
      expect(gte.getMinutes()).toBe(30);
      expect(gte.getSeconds()).toBe(0);

      // 19:00:00.000 local time (7:00 PM)
      expect(lte.getHours()).toBe(19);
      expect(lte.getMinutes()).toBe(0);
      expect(lte.getSeconds()).toBe(0);

      // Call at 14:00:00 (pre-lunch) -> DOES NOT MATCH
      const callAt14 = new Date(gte);
      callAt14.setMinutes(0);
      expect(callAt14 >= gte && callAt14 <= lte).toBe(false);

      // Call at 14:15:00 (lunch break) -> DOES NOT MATCH
      const callAt1415 = new Date(gte);
      callAt1415.setMinutes(15);
      expect(callAt1415 >= gte && callAt1415 <= lte).toBe(false);

      // Call at 14:29:59 -> DOES NOT MATCH
      const callAt1429 = new Date(gte.getTime() - 1000);
      expect(callAt1429 >= gte && callAt1429 <= lte).toBe(false);

      // Call at 14:30:00 (start boundary: 2:30 PM) -> MATCHES
      const callAt1430 = new Date(gte);
      expect(callAt1430 >= gte && callAt1430 <= lte).toBe(true);

      // Call at 19:00:00 (end boundary: 7:00 PM) -> MATCHES
      const callAt19 = new Date(lte);
      expect(callAt19 >= gte && callAt19 <= lte).toBe(true);

      // Call at 19:00:01 (1 second past 7:00 PM) -> DOES NOT MATCH
      const callAt1901 = new Date(lte.getTime() + 1000);
      expect(callAt1901 >= gte && callAt1901 <= lte).toBe(false);
    });

    it('3. ALL_DAY retains the existing working-hours behaviour without restricting to pre/post lunch', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        'ALL',
        'ALL',
      );

      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      const { gte, lte } = countCall.where.createdAt;

      // Entire day from 00:00:00.000 to 23:59:59.999
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
      expect(lte.getHours()).toBe(23);
      expect(lte.getMinutes()).toBe(59);
    });

    it('4. Backward compatibility: supports PRE_LUNCH and POST_LUNCH when passed via callTimeParam', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        'PRE_LUNCH', // passed as 6th param
      );

      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      const { gte, lte } = countCall.where.createdAt;
      expect(gte.getHours()).toBe(10);
      expect(lte.getHours()).toBe(14);
    });

    it('5. Hourly filter coordination: intersecting PRE_LUNCH with 11:00-12:00', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        '11:00-12:00',
        'PRE_LUNCH',
      );

      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      const { gte, lte } = countCall.where.createdAt;
      expect(gte.getHours()).toBe(11);
      expect(lte.getHours()).toBe(12);
    });

    it('6. Hourly filter coordination: disjoint ranges PRE_LUNCH with 15:00-16:00 matches nothing', async () => {
      prismaMock.callRecord.findMany.mockResolvedValue([]);
      prismaMock.callRecord.count.mockResolvedValue(0);

      await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        '15:00-16:00',
        'PRE_LUNCH',
      );

      const countCall = prismaMock.callRecord.count.mock.calls[0][0];
      expect(countCall.where.id).toBe('__NO_MATCH_CALL_WINDOW__');
    });
  });

  describe('Report Metrics & Zero-Call Advisors Accuracy', () => {
    it('7. Correctly calculates zero-call advisors within the selected time window', async () => {
      // Scenario:
      // Alice (adv-1) made 1 call in Pre-Lunch.
      // Bob (adv-2) made NO calls in Pre-Lunch (he only made a call in Post-Lunch).
      // When PRE_LUNCH is selected, the database returns ONLY calls within Pre-Lunch (Alice's call).
      const preLunchCalls = [
        {
          id: 'call-1',
          outcome: 'INTERESTED',
          createdById: 'adv-1',
          createdBy: {
            id: 'adv-1',
            firstName: 'Alice',
            lastName: 'Sharma',
            teamId: 101,
            team: { id: 101, name: 'Alpha Team' },
          },
          createdAt: new Date('2026-10-29T05:30:00.000Z'), // 11:00 AM IST
        },
      ];

      // findMany call 21: summary call records for stats
      // findMany call 22: paginated call records for activity log
      prismaMock.callRecord.findMany.mockImplementation(({ skip }: any) => {
        if (skip !== undefined) {
          return Promise.resolve(preLunchCalls);
        }
        return Promise.resolve(preLunchCalls);
      });
      prismaMock.callRecord.count.mockResolvedValue(1);

      const result = await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        undefined,
        'PRE_LUNCH',
      );

      // Verify Calls Logged Today
      expect(result.kpis.callsTodayCount).toBe(1);

      // Verify Advisor Performance
      const alicePerf = result.advisorPerformance.find((a) => a.userId === 'adv-1');
      const bobPerf = result.advisorPerformance.find((a) => a.userId === 'adv-2');

      expect(alicePerf).toBeDefined();
      expect(alicePerf?.callsCount).toBe(1);
      expect(alicePerf?.answeredCallsCount).toBe(1);
      expect(alicePerf?.notAnsweredCallsCount).toBe(0);

      // Bob has 0 calls in this window!
      expect(bobPerf).toBeDefined();
      expect(bobPerf?.callsCount).toBe(0);
      expect(bobPerf?.answeredCallsCount).toBe(0);
      expect(bobPerf?.notAnsweredCallsCount).toBe(0);

      // Verify Zero-Call Advisors count
      expect(result.attentionRequired.zeroCallAdvisorsCount).toBe(1);

      // Paginated list
      expect(result.callsTodayList.pagination.total).toBe(1);
      expect(result.callsTodayList.data.length).toBe(1);
    });

    it('8. Answered vs Not Answered call categorization within selected time window', async () => {
      const callsInWindow = [
        {
          id: 'call-ans-1',
          outcome: 'INTERESTED',
          createdById: 'adv-1',
          createdBy: mockAdvisors[0],
          createdAt: new Date('2026-10-29T10:00:00.000Z'),
        },
        {
          id: 'call-ans-2',
          outcome: 'CALL_BACK_LATER',
          createdById: 'adv-1',
          createdBy: mockAdvisors[0],
          createdAt: new Date('2026-10-29T11:00:00.000Z'),
        },
        {
          id: 'call-not-ans-1',
          outcome: 'NO_ANSWER',
          createdById: 'adv-1',
          createdBy: mockAdvisors[0],
          createdAt: new Date('2026-10-29T12:00:00.000Z'),
        },
        {
          id: 'call-not-ans-2',
          outcome: 'WRONG_NUMBER',
          createdById: 'adv-1',
          createdBy: mockAdvisors[0],
          createdAt: new Date('2026-10-29T13:00:00.000Z'),
        },
      ];

      prismaMock.callRecord.findMany.mockImplementation(({ skip }: any) => {
        if (skip !== undefined) {
          return Promise.resolve(callsInWindow);
        }
        return Promise.resolve(callsInWindow);
      });
      prismaMock.callRecord.count.mockResolvedValue(4);

      const result = await service.getSuperAdminDashboardStats(
        mockSuperAdminUser.id,
        '2026-10-29',
        '2026-10-29',
        1,
        10,
        undefined,
        'POST_LUNCH',
      );

      const alicePerf = result.advisorPerformance.find((a) => a.userId === 'adv-1');
      expect(alicePerf?.callsCount).toBe(4);
      expect(alicePerf?.answeredCallsCount).toBe(2);
      expect(alicePerf?.notAnsweredCallsCount).toBe(2);
      expect(result.kpis.callsTodayCount).toBe(4);
    });
  });
});
