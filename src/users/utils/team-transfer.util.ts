import { PrismaClient, UserStatus } from '@prisma/client';

/**
 * Processes a user's team transfer transactionally.
 *
 * Rules:
 * - Updates User.teamId.
 * - Removes only obsolete TeamLead / TeamLeadAdvisor relationships
 *   belonging to the user's old team.
 * - Only Program Advisors carry their currently-owned ACTIVE leads
 *   to the new team.
 * - Lead IDs, assignments, history and other historical data are preserved.
 * - Never deletes TeamLead relationships belonging to another team.
 * - Never sends leads to the working pool during a team transfer.
 */
export async function processUserTeamTransfer(
  tx: any,
  userId: string,
  newTeamId: number | null,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      teamId: true,
      role: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!user) return;

  const oldTeamId = user.teamId;

  // Nothing to do if the user is already in this team.
  if (oldTeamId === newTeamId) {
    return;
  }

  const roleNameClean = (user.role?.name || '')
    .toUpperCase()
    .replace(/\s+/g, '_');

  const isProgramAdvisor = [
    'PROGRAM_ADVISOR',
    'PROGRAMADVISOR',
    'PA',
    'ADVISOR',
  ].includes(roleNameClean);

  // ------------------------------------------------------------
  // 1. Update user's team
  // ------------------------------------------------------------

  await tx.user.update({
    where: { id: userId },
    data: {
      teamId: newTeamId,
    },
  });

  // ------------------------------------------------------------
  // 2. Clean up relationships belonging to the OLD team only
  // ------------------------------------------------------------

  if (oldTeamId !== null) {
    // A. Find all Team Lead user IDs belonging to oldTeamId
    const oldTeamLeads = await tx.teamLead.findMany({
      where: {
        teamId: oldTeamId,
      },
      select: {
        userId: true,
      },
    });

    const oldTeamLeadUserIds = oldTeamLeads.map(
      (teamLead: { userId: string }) => teamLead.userId,
    );

    // If this user was supervised by Team Leads in oldTeamId, remove supervision
    if (oldTeamLeadUserIds.length > 0) {
      await tx.teamLeadAdvisor.deleteMany({
        where: {
          advisorId: userId,
          teamLeadId: {
            in: oldTeamLeadUserIds,
          },
        },
      });
    }

    // B. Find all member user IDs belonging to oldTeamId
    const oldTeamMembers = await tx.user.findMany({
      where: {
        teamId: oldTeamId,
      },
      select: {
        id: true,
      },
    });

    const oldTeamMemberIds = oldTeamMembers.map(
      (u: { id: string }) => u.id,
    );

    // If this user was a Team Lead supervising PAs in oldTeamId, remove supervision over oldTeamId members
    if (oldTeamMemberIds.length > 0) {
      await tx.teamLeadAdvisor.deleteMany({
        where: {
          teamLeadId: userId,
          advisorId: {
            in: oldTeamMemberIds,
          },
        },
      });
    }

    // C. Only remove the user's TeamLead membership from the OLD team.
    // NEVER: deleteMany({ where: { userId } })
    // because a Team Lead may belong to multiple teams.
    await tx.teamLead.deleteMany({
      where: {
        teamId: oldTeamId,
        userId,
      },
    });
  }

  // ------------------------------------------------------------
  // 3. Move ACTIVE currently-owned leads
  //    ONLY for Program Advisors
  // ------------------------------------------------------------

  if (!isProgramAdvisor) {
    return;
  }

  const activeLeads = await tx.lead.findMany({
    where: {
      status: {
        name: {
          notIn: [
            'ADMISSION_DONE',
            'CANCELLED',
          ],
        },
      },
      assignments: {
        some: {
          userId,
          status: 'ACTIVE',
        },
      },
    },
    select: {
      id: true,
    },
  });

  const activeLeadIds = activeLeads.map(
    (lead: { id: number }) => lead.id,
  );

  if (activeLeadIds.length === 0) {
    return;
  }

  // Preserve the Lead itself and its assignment/history.
  // Only update its current team context in-place.
  await tx.lead.updateMany({
    where: {
      id: {
        in: activeLeadIds,
      },
    },
    data: {
      teamId: newTeamId,
    },
  });
}

/**
 * Releases a user's currently-owned ACTIVE leads to the working pool upon deactivation.
 *
 * Rules:
 * - Only affects active non-terminal leads (status NOT IN ('ADMISSION_DONE', 'CANCELLED')).
 * - Updates active LeadAssignment status to 'EXPIRED' (and expiresAt to now).
 * - Leaves lead records, lead IDs, and historical assignments/ownership intact.
 * - Does NOT release terminal leads.
 */
export async function releaseUserLeadsToPool(
  tx: any,
  userId: string,
): Promise<void> {
  const now = new Date();
  await tx.leadAssignment.updateMany({
    where: {
      userId: userId,
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
      expiresAt: now,
    },
  });
}