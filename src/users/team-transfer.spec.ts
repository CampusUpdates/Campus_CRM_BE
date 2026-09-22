import { processUserTeamTransfer, releaseUserLeadsToPool } from './utils/team-transfer.util';

describe('processUserTeamTransfer - Team Transfer & Lead Ownership Logic', () => {
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      teamLead: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      teamLeadAdvisor: {
        deleteMany: jest.fn(),
      },
      lead: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      leadAssignment: {
        updateMany: jest.fn(),
      },
    };
  });

  it('1. should move ACTIVE leads of Program Advisor to new Team in-place when PA moves teams', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'pa-1',
      teamId: 1,
      role: { name: 'Program Advisor' },
    });

    mockTx.teamLead.findMany.mockResolvedValue([
      { userId: 'tl-team1' },
    ]);

    mockTx.lead.findMany.mockResolvedValue([
      { id: 101 },
      { id: 102 },
    ]);

    await processUserTeamTransfer(mockTx, 'pa-1', 2);

    // 1. User teamId updated
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'pa-1' },
      data: { teamId: 2 },
    });

    // 2. Old TeamLeadAdvisor relationships deleted for Team 1 Team Leads ONLY
    expect(mockTx.teamLeadAdvisor.deleteMany).toHaveBeenCalledWith({
      where: {
        advisorId: 'pa-1',
        teamLeadId: { in: ['tl-team1'] },
      },
    });

    // 3. TeamLead entry removed ONLY for oldTeamId (1)
    expect(mockTx.teamLead.deleteMany).toHaveBeenCalledWith({
      where: {
        teamId: 1,
        userId: 'pa-1',
      },
    });

    // 4. Active leads queried excluding terminal states (ADMISSION_DONE, CANCELLED)
    expect(mockTx.lead.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          name: {
            notIn: ['ADMISSION_DONE', 'CANCELLED'],
          },
        },
        assignments: {
          some: {
            userId: 'pa-1',
            status: 'ACTIVE',
          },
        },
      },
      select: { id: true },
    });

    // 5. Lead.teamId updated in-place for active leads
    expect(mockTx.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [101, 102] },
      },
      data: {
        teamId: 2,
      },
    });

    // 6. LeadAssignment is NOT expired or deleted during transfer (leads stay with PA)
    expect(mockTx.leadAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('2. should NOT execute any updates if user team does not change', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'pa-1',
      teamId: 1,
      role: { name: 'Program Advisor' },
    });

    await processUserTeamTransfer(mockTx, 'pa-1', 1);

    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.teamLeadAdvisor.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.teamLead.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.lead.findMany).not.toHaveBeenCalled();
    expect(mockTx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('3. should exclude terminal leads (e.g. ADMISSION_DONE) because lead.findMany filters them out', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'pa-1',
      teamId: 1,
      role: { name: 'Program Advisor' },
    });

    mockTx.teamLead.findMany.mockResolvedValue([]);
    mockTx.lead.findMany.mockResolvedValue([
      { id: 101 },
    ]);

    await processUserTeamTransfer(mockTx, 'pa-1', 2);

    expect(mockTx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [101] } },
      data: { teamId: 2 },
    });
  });

  it('4. should NOT move leads for non-Program Advisor roles (e.g. Team Lead or Manager)', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'tl-1',
      teamId: 1,
      role: { name: 'TEAM_LEAD' },
    });

    mockTx.teamLead.findMany.mockResolvedValue([]);

    await processUserTeamTransfer(mockTx, 'tl-1', 2);

    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'tl-1' },
      data: { teamId: 2 },
    });

    // Should NOT query or move leads for non-PA role
    expect(mockTx.lead.findMany).not.toHaveBeenCalled();
    expect(mockTx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('5. should preserve multi-team TeamLead entries for other teams during team transfer', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'tl-multi',
      teamId: 1,
      role: { name: 'Team Lead' },
    });

    mockTx.teamLead.findMany.mockResolvedValue([]);

    await processUserTeamTransfer(mockTx, 'tl-multi', 2);

    // Verify TeamLead deletion is scoped to teamId: 1 and NEVER deletes by userId alone
    expect(mockTx.teamLead.deleteMany).toHaveBeenCalledWith({
      where: {
        teamId: 1,
        userId: 'tl-multi',
      },
    });
    expect(mockTx.teamLead.deleteMany).not.toHaveBeenCalledWith({
      where: { userId: 'tl-multi' },
    });
  });

  it('6. should clean up TeamLeadAdvisor supervision relationships for Team Lead leaving old team', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: 'tl-1',
      teamId: 1,
      role: { name: 'TEAM_LEAD' },
    });

    mockTx.user.findMany.mockResolvedValue([
      { id: 'pa-1' },
      { id: 'pa-2' },
    ]);

    mockTx.teamLead.findMany.mockResolvedValue([]);

    await processUserTeamTransfer(mockTx, 'tl-1', 2);

    // Verify supervision over old team's members is removed
    expect(mockTx.teamLeadAdvisor.deleteMany).toHaveBeenCalledWith({
      where: {
        teamLeadId: 'tl-1',
        advisorId: { in: ['pa-1', 'pa-2'] },
      },
    });
  });
});

describe('releaseUserLeadsToPool - User Deactivation Logic', () => {
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      leadAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
  });

  it('1. should release active currently-owned non-terminal leads to the pool when user is deactivated', async () => {
    await releaseUserLeadsToPool(mockTx, 'pa-deactivated');

    expect(mockTx.leadAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'pa-deactivated',
        status: 'ACTIVE',
        lead: {
          status: {
            name: {
              notIn: ['ADMISSION_DONE', 'CANCELLED'],
            },
          },
        },
      },
      data: {
        status: 'EXPIRED',
        expiresAt: expect.any(Date),
      },
    });
  });
});
