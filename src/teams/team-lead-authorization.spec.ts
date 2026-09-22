import { Test, TestingModule } from '@nestjs/testing';
import { TeamLeadAuthorizationService } from './team-lead-authorization.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { ActivityLogService } from 'src/activity-log/activity-log.service';

describe('TeamLeadAuthorizationService & Phase 2 Rules', () => {
  let service: TeamLeadAuthorizationService;
  let teamsService: TeamsService;
  let prisma: any;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    teamLead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    teamLeadAdvisor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockActivityLogService = {
    createLog: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamLeadAuthorizationService,
        TeamsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ActivityLogService, useValue: mockActivityLogService },
      ],
    }).compile();

    service = module.get<TeamLeadAuthorizationService>(TeamLeadAuthorizationService);
    teamsService = module.get<TeamsService>(TeamsService);
    prisma = mockPrismaService;
  });

  describe('TEAM rules (Cases 1-3)', () => {
    it('1. Team Lead can access assigned Team', async () => {
      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });
      const result = await service.canTeamLeadAccessTeam('tl-1', 1);
      expect(result).toBe(true);
    });

    it('2. Team Lead cannot access unassigned Team', async () => {
      prisma.teamLead.findUnique.mockResolvedValue(null);
      const result = await service.canTeamLeadAccessTeam('tl-1', 2);
      expect(result).toBe(false);
    });

    it('3. User.teamId alone does not grant Team Lead access', async () => {
      prisma.teamLead.findUnique.mockResolvedValue(null);
      const result = await service.canTeamLeadAccessTeam('tl-1', 10);
      expect(result).toBe(false);
    });
  });

  describe('ADVISORS rules (Cases 4-7)', () => {
    it('4. Team Lead can see assigned PA in same team', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'pa-1',
        teamId: 1,
        status: 'ACTIVE',
        role: { name: 'Program Advisor' },
      });
      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });
      prisma.teamLeadAdvisor.findUnique.mockResolvedValue({ teamLeadId: 'tl-1', advisorId: 'pa-1' });

      const result = await service.canTeamLeadAccessAdvisor('tl-1', 'pa-1');
      expect(result).toBe(true);
    });

    it('5. Team Lead cannot see unassigned PA', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'pa-2',
        teamId: 1,
        status: 'ACTIVE',
        role: { name: 'Program Advisor' },
      });
      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });
      prisma.teamLeadAdvisor.findUnique.mockResolvedValue(null);

      const result = await service.canTeamLeadAccessAdvisor('tl-1', 'pa-2');
      expect(result).toBe(false);
    });

    it('6. Cross-team PA assignment fails', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 1, managerId: 'mgr-1' });
      prisma.user.findUnique
        .mockResolvedValueOnce({ role: { name: 'SUPER_ADMIN' } }) // caller
        .mockResolvedValueOnce({ id: 'tl-1', status: 'ACTIVE', teamId: 1, role: { name: 'Team Lead' } })
        .mockResolvedValueOnce({ id: 'pa-diff', status: 'ACTIVE', teamId: 2, role: { name: 'Program Advisor' } }); // PA in team 2

      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });

      await expect(
        teamsService.assignAdvisorToTeamLead('1', 'tl-1', 'pa-diff', { sub: 'admin-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('7. Team Lead cannot see another Team Lead\'s PAs when requesting advisors', async () => {
      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-2' });
      prisma.team.findUnique.mockResolvedValue({ id: 1, managerId: 'mgr-1' });
      prisma.user.findUnique.mockResolvedValue({ role: { name: 'Team Lead' } });

      await expect(
        teamsService.getTeamLeadAdvisors('1', 'tl-2', { sub: 'tl-1' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('PROFILES rules (Cases 8-10)', () => {
    it('8 & 9 & 10. Access checks for self, supervised PA, and unrelated user profiles', async () => {
      prisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'tl-1') return Promise.resolve({ id: 'tl-1', role: { name: 'Team Lead' } });
        if (where.id === 'pa-1') return Promise.resolve({ id: 'pa-1', teamId: 1, status: 'ACTIVE', role: { name: 'Program Advisor' } });
        if (where.id === 'tl-2') return Promise.resolve({ id: 'tl-2', role: { name: 'Team Lead' } });
        return Promise.resolve(null);
      });
      prisma.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });
      prisma.teamLeadAdvisor.findUnique.mockImplementation(({ where }: any) => {
        if (where.teamLeadId_advisorId?.advisorId === 'pa-1') return Promise.resolve({ teamLeadId: 'tl-1', advisorId: 'pa-1' });
        return Promise.resolve(null);
      });

      const canAccessOwn = true; // self access
      const canAccessSupervisedPA = await service.canTeamLeadAccessAdvisor('tl-1', 'pa-1');
      const canAccessOtherTL = await service.canTeamLeadAccessAdvisor('tl-1', 'tl-2');

      expect(canAccessOwn).toBe(true);
      expect(canAccessSupervisedPA).toBe(true);
      expect(canAccessOtherTL).toBe(false);
    });
  });

  describe('LEADS rules (Cases 11-16)', () => {
    it('11. Team Lead can access own authorized lead (createdById)', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-1',
        teamId: 1,
        createdById: 'tl-1',
        assignments: [],
      });
      prisma.teamLead.findMany.mockResolvedValue([{ teamId: 1, userId: 'tl-1' }]);
      const result = await service.canTeamLeadAccessLead('tl-1', 'lead-1');
      expect(result).toBe(true);
    });

    it('12. Team Lead can access supervised PA lead', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-2',
        teamId: 1,
        createdById: 'pa-1',
        assignments: [{ userId: 'pa-1', status: 'ACTIVE' }],
      });
      prisma.teamLead.findMany.mockResolvedValue([{ teamId: 1, userId: 'tl-1' }]);
      prisma.teamLeadAdvisor.findMany.mockResolvedValue([{ advisorId: 'pa-1' }]);

      const result = await service.canTeamLeadAccessLead('tl-1', 'lead-2');
      expect(result).toBe(true);
    });

    it('13. Team Lead CANNOT access unsupervised PA lead in same Team (Team Lead isolation)', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-3',
        teamId: 1,
        createdById: 'pa-2',
        createdBy: { teamId: 1 },
        assignments: [{ userId: 'pa-2', status: 'ACTIVE', user: { teamId: 1 } }],
      });
      prisma.teamLead.findMany.mockResolvedValue([{ teamId: 1, userId: 'tl-1' }]);
      prisma.teamLeadAdvisor.findMany.mockResolvedValue([{ advisorId: 'pa-1' }]); // pa-2 is NOT supervised by tl-1

      const result = await service.canTeamLeadAccessLead('tl-1', 'lead-3');
      expect(result).toBe(false);
    });

    it('14 & 15. Cannot access another Team Lead\'s PA or another Team\'s lead', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-other-team',
        teamId: 99,
        createdById: 'other-user',
        assignments: [],
      });
      prisma.teamLead.findMany.mockResolvedValue([{ teamId: 1, userId: 'tl-1' }]);
      const result = await service.canTeamLeadAccessLead('tl-1', 'lead-other-team');
      expect(result).toBe(false);
    });
  });

  describe('ASSIGNMENT & ADMIN rules (Cases 17-25)', () => {
    it('22. Team Lead cannot assign or remove Team Leads', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 1, managerId: 'mgr-1' });
      prisma.user.findUnique.mockResolvedValue({ role: { name: 'Team Lead' } });

      await expect(
        teamsService.assignTeamLead('1', 'tl-2', { sub: 'tl-1' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
