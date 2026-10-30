import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class TeamLeadAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if user has the Team Lead role or any TeamLead relationship record
   */
  async isTeamLead(userId: string): Promise<boolean> {
    if (!userId) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { name: true } } },
    });
    const roleName = (user?.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    if (roleName === 'TEAM_LEAD' || roleName === 'TEAMLEAD') {
      return true;
    }
    const teamLeadRecord = await this.prisma.teamLead.findFirst({
      where: { userId },
    });
    return !!teamLeadRecord;
  }

  /**
   * Retrieve array of teamIds explicitly assigned to teamLeadId in TeamLead join table.
   * NOTE: Does NOT use User.teamId!
   */
  async getTeamLeadAssignedTeamIds(teamLeadId: string): Promise<number[]> {
    if (!teamLeadId) return [];
    const records = await this.prisma.teamLead.findMany({
      where: { userId: teamLeadId },
      select: { teamId: true },
    });
    return records.map((r) => r.teamId);
  }

  /**
   * Check if teamLeadId is assigned to teamId via TeamLead record
   */
  async canTeamLeadAccessTeam(teamLeadId: string, teamId: number): Promise<boolean> {
    if (!teamLeadId || !teamId || isNaN(teamId)) return false;
    const record = await this.prisma.teamLead.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: teamLeadId,
        },
      },
    });
    return !!record;
  }

  /**
   * Retrieve Program Advisor IDs supervised by teamLeadId.
   * Enforces BOTH:
   * 1. TeamLead(teamLeadId, teamId) exists for teamId
   * 2. TeamLeadAdvisor(teamLeadId, advisorId) exists AND advisor.teamId === teamId AND advisor has Program Advisor role
   */
  async getTeamLeadAdvisorIds(teamLeadId: string, teamId?: number): Promise<string[]> {
    if (!teamLeadId) return [];

    let authorizedTeamIds: number[];
    if (teamId) {
      const hasAccess = await this.canTeamLeadAccessTeam(teamLeadId, teamId);
      if (!hasAccess) return [];
      authorizedTeamIds = [teamId];
    } else {
      authorizedTeamIds = await this.getTeamLeadAssignedTeamIds(teamLeadId);
      if (authorizedTeamIds.length === 0) return [];
    }

    const records = await this.prisma.teamLeadAdvisor.findMany({
      where: {
        teamLeadId,
        advisor: {
          teamId: { in: authorizedTeamIds },
          status: 'ACTIVE',
          role: {
            name: {
              in: ['Program Advisor', 'PROGRAM_ADVISOR', 'PA', 'Advisor'],
            },
          },
        },
      },
      select: { advisorId: true },
    });

    return (records || []).map((r) => r.advisorId);
  }

  /**
   * Check if teamLeadId is allowed to supervise advisorId.
   * Enforces BOTH:
   * 1. Advisor is active, has PA role, belongs to a teamId
   * 2. TeamLead(teamLeadId, advisor.teamId) exists
   * 3. TeamLeadAdvisor(teamLeadId, advisorId) exists
   */
  async canTeamLeadAccessAdvisor(teamLeadId: string, advisorId: string): Promise<boolean> {
    if (!teamLeadId || !advisorId) return false;

    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: {
        id: true,
        teamId: true,
        status: true,
        role: { select: { name: true } },
      },
    });

    if (!advisor || !advisor.teamId || advisor.status !== 'ACTIVE') return false;

    const roleName = (advisor.role?.name || '').toUpperCase().replace(/\s+/g, '_');
    if (!['PROGRAM_ADVISOR', 'PROGRAMADVISOR', 'PA', 'ADVISOR'].includes(roleName)) {
      return false;
    }

    const teamLeadAccess = await this.canTeamLeadAccessTeam(teamLeadId, advisor.teamId);
    if (!teamLeadAccess) return false;

    const advisorRel = await this.prisma.teamLeadAdvisor.findUnique({
      where: {
        teamLeadId_advisorId: {
          teamLeadId,
          advisorId,
        },
      },
    });

    return !!advisorRel;
  }

  /**
   * Resolve the full Team Lead scope for dashboard/reporting.
   * Returns PA IDs, team IDs, and the team lead user ID.
   * Reusable by dashboard metrics, drilldowns, tables, and future reporting.
   */
  async getTeamLeadScope(userId: string): Promise<{
    paIds: string[];
    teamLeadId: string;
    teamIds: number[];
  }> {
    if (!userId) {
      return { paIds: [], teamLeadId: userId, teamIds: [] };
    }

    const teamIds = await this.getTeamLeadAssignedTeamIds(userId);
    if (teamIds.length === 0) {
      return { paIds: [], teamLeadId: userId, teamIds: [] };
    }

    const paIds = await this.getTeamLeadAdvisorIds(userId);
    return {
      paIds,
      teamLeadId: userId,
      teamIds,
    };
  }

  /**
   * Check if teamLeadId is authorized to access/mutate a Lead.
   * Rules:
   * 1. Lead created by teamLeadId or supervised Program Advisors
   * 2. Lead assigned (active or historical) to teamLeadId or supervised Program Advisors
   */
  async canTeamLeadAccessLead(teamLeadId: string, leadId: string): Promise<boolean> {
    if (!teamLeadId || !leadId) return false;

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        createdById: true,
        assignments: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!lead) return false;

    const supervisedAdvisorIds = await this.getTeamLeadAdvisorIds(teamLeadId);
    const authorizedUserIds = new Set([teamLeadId, ...supervisedAdvisorIds]);

    if (lead.createdById && authorizedUserIds.has(lead.createdById)) {
      return true;
    }

    if (lead.assignments.some((a) => authorizedUserIds.has(a.userId))) {
      return true;
    }

    return false;
  }
}
