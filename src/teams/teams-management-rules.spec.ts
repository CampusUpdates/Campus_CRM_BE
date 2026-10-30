import { Test, TestingModule } from '@nestjs/testing';
import { TeamsService } from './teams.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { TeamLeadAuthorizationService } from './team-lead-authorization.service';
import { BadRequestException } from '@nestjs/common';

describe('TeamsService - Complete Team Lead & PA Team Management Rules', () => {
  let service: TeamsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((cb) => cb(prismaMock)),
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      team: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      teamLead: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      teamLeadAdvisor: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      lead: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      activityLog: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        TeamLeadAuthorizationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ActivityLogService, useValue: { createLog: jest.fn() } },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  describe('Team Creation Rules', () => {
    it('1. should create team with teamLeads and teamLeadAdvisorAssignments transactionally', async () => {
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'hr-1') return Promise.resolve({ id: 'hr-1', role: { name: 'HR' } });
        if (where.id === 'mgr-1') {
          return Promise.resolve({
            id: 'mgr-1',
            status: 'ACTIVE',
            role: { name: 'Manager', permissions: [] },
          });
        }
        return Promise.resolve(null);
      });

      prismaMock.team.findUnique.mockImplementation(({ where }: any) => {
        if (where.name === 'Team Alpha') return Promise.resolve(null);
        if (where.id === 10) {
          return Promise.resolve({
            id: 10,
            name: 'Team Alpha',
            manager: { id: 'mgr-1', firstName: 'Mgr', lastName: 'One', email: 'm@test.com' },
            users: [],
            _count: { users: 0 },
          });
        }
        return Promise.resolve(null);
      });

      prismaMock.user.findMany.mockImplementation(({ where }: any) => {
        if (where.id?.in?.includes('pa-1')) {
          return Promise.resolve([
            { id: 'pa-1', status: 'ACTIVE', teamId: null, role: { name: 'Program Advisor' } },
          ]);
        }
        if (where.id?.in?.includes('tl-1')) {
          return Promise.resolve([
            { id: 'tl-1', status: 'ACTIVE', role: { name: 'Team Lead' } },
          ]);
        }
        return Promise.resolve([]);
      });

      prismaMock.team.create.mockResolvedValue({ id: 10, name: 'Team Alpha', managerId: 'mgr-1' });

      const result = await service.create(
        {
          name: 'Team Alpha',
          managerId: 'mgr-1',
          memberIds: ['pa-1'],
          teamLeadIds: ['tl-1'],
          teamLeadAdvisorAssignments: [
            { teamLeadId: 'tl-1', advisorIds: ['pa-1'] },
          ],
        },
        { sub: 'hr-1' },
      );

      expect(prismaMock.team.create).toHaveBeenCalledWith({
        data: { name: 'Team Alpha', description: undefined, managerId: 'mgr-1' },
      });

      expect(prismaMock.teamLead.upsert).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 10, userId: 'tl-1' } },
        create: { teamId: 10, userId: 'tl-1' },
        update: {},
      });

      expect(prismaMock.teamLeadAdvisor.upsert).toHaveBeenCalledWith({
        where: { teamLeadId_advisorId: { teamLeadId: 'tl-1', advisorId: 'pa-1' } },
        create: { teamLeadId: 'tl-1', advisorId: 'pa-1' },
        update: {},
      });

      expect(result.id).toBe(10);
    });

    it('2. should reject team creation if member is already assigned to another team', async () => {
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'hr-1') return Promise.resolve({ id: 'hr-1', role: { name: 'HR' } });
        if (where.id === 'mgr-1') {
          return Promise.resolve({
            id: 'mgr-1',
            status: 'ACTIVE',
            role: { name: 'Manager', permissions: [] },
          });
        }
        return Promise.resolve(null);
      });

      prismaMock.team.findUnique.mockResolvedValue(null);

      prismaMock.user.findMany.mockResolvedValue([
        { id: 'pa-assigned', status: 'ACTIVE', teamId: 5, role: { name: 'Program Advisor' } },
      ]);

      await expect(
        service.create(
          {
            name: 'Team Beta',
            managerId: 'mgr-1',
            memberIds: ['pa-assigned'],
          },
          { sub: 'hr-1' },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Team Lead Multi-Team Safety & Removal Rules', () => {
    it('3. removing Team Lead from a specific team deletes ONLY that teamLead record', async () => {
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'mgr-1') return Promise.resolve({ role: { name: 'Manager' } });
        return Promise.resolve(null);
      });

      prismaMock.team.findUnique.mockResolvedValue({ id: 1, managerId: 'mgr-1' });

      prismaMock.teamLead.findUnique.mockResolvedValue({
        teamId: 1,
        userId: 'tl-1',
      });

      prismaMock.user.findMany.mockResolvedValue([{ id: 'pa-1' }]);
      prismaMock.teamLead.delete.mockResolvedValue({});

      await service.removeTeamLead('1', 'tl-1', { sub: 'mgr-1' });

      // Verifies exact composite key deletion for teamId 1 ONLY
      expect(prismaMock.teamLead.delete).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 1, userId: 'tl-1' } },
      });

      // Verifies supervision cleanup is scoped to advisors in team 1
      expect(prismaMock.teamLeadAdvisor.deleteMany).toHaveBeenCalledWith({
        where: {
          teamLeadId: 'tl-1',
          advisorId: { in: ['pa-1'] },
        },
      });
    });
  });

  describe('Operational Visibility', () => {
    it('4. getTeamMembersForManager allows authorized Team Lead to view all active members in authorized team', async () => {
      prismaMock.team.findUnique.mockResolvedValue({ id: 1, managerId: 'mgr-1' });

      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'tl-1') return Promise.resolve({ role: { name: 'Team Lead' } });
        return Promise.resolve(null);
      });

      // Mock Team Lead authorization for team 1
      prismaMock.teamLead.findUnique.mockResolvedValue({ teamId: 1, userId: 'tl-1' });

      prismaMock.user.findMany.mockResolvedValue([
        { id: 'tl-1', firstName: 'TL', lastName: 'One' },
        { id: 'pa-1', firstName: 'PA', lastName: 'One' },
        { id: 'pa-2', firstName: 'PA', lastName: 'Two' },
      ]);

      const members = await service.getTeamMembersForManager('1', { sub: 'tl-1' });

      expect(members.length).toBe(3);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ teamId: 1 }, { managerId: 'mgr-1' }],
          status: 'ACTIVE',
          role: {
            name: {
              in: ['PROGRAM_ADVISOR', 'Program Advisor', 'TEAM_LEAD', 'Team Lead'],
            },
          },
        },
        select: expect.anything(),
        orderBy: { firstName: 'asc' },
      });
    });
  });
});
