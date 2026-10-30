  async getTpcReport(user: any, query: GetTpcReportDto) {
    const userId = user.sub;
    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true, role: { select: { name: true } } },
    });

    const userRole = (userRecord?.role?.name || '').toUpperCase();
    const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(userRole);
    const isManager = ['MANAGER'].includes(userRole);
    const isTeamLead = await this.teamLeadAuthService.isTeamLead(userId);

    // 1. Determine which users the requester is allowed to see
    let authorizedUserIds: string[] = [];
    if (!isSuperAdmin) {
      if (isManager) {
        const managedTeams = await this.prisma.team.findMany({
          where: { managerId: userId },
          select: { id: true },
        });
        const managedTeamIds = managedTeams.map((t) => t.id);
        const allTeamIds = Array.from(new Set([...managedTeamIds, ...(userRecord?.teamId ? [userRecord.teamId] : [])]));

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
        authorizedUserIds = teamMembers.map((m) => m.id);
      } else if (isTeamLead) {
        const supervisedAdvisorIds = await this.teamLeadAuthService.getTeamLeadAdvisorIds(userId);
        authorizedUserIds = Array.from(new Set([userId, ...supervisedAdvisorIds]));
      } else {
        authorizedUserIds = [userId];
      }
    }

    // Filter by requested teamId if provided
    let targetUserIds = [...authorizedUserIds];
    if (query.teamId) {
      const teamMembers = await this.prisma.user.findMany({
        where: { teamId: query.teamId },
        select: { id: true },
      });
      const teamUserIds = teamMembers.map(m => m.id);

      if (!isSuperAdmin) {
         // Intersect authorized with requested team
         targetUserIds = authorizedUserIds.filter(id => teamUserIds.includes(id));
      } else {
         targetUserIds = teamUserIds;
      }
    }

    // Date Filtering
    const { startDate, endDate } = getDateRangeForPeriod(query.period);

    let baseWhere: any = {};
    if (!isSuperAdmin || query.teamId) {
      baseWhere.assignedToId = { in: targetUserIds };
    }

    if (startDate && endDate) {
      baseWhere.assignedAt = {
        gte: startDate,
        lte: endDate,
      };
    }

    // Aggregations
    const grouped = await this.prisma.tPCUser.groupBy({
      by: ['assignedToId', 'status'],
      where: baseWhere,
      _count: {
        _all: true
      }
    });

    // Also get the users info
    let usersWhere: any = {};
    if (!isSuperAdmin || query.teamId) {
        usersWhere.id = { in: targetUserIds };
    } else {
        // Find all users who have TPC assignments in this report
        const userIdsInReport = Array.from(new Set(grouped.map(g => g.assignedToId)));
        usersWhere.id = { in: userIdsInReport };
    }

    const users = await this.prisma.user.findMany({
        where: usersWhere,
        select: { id: true, firstName: true, lastName: true }
    });

    const userMap = new Map();
    for (const u of users) {
        userMap.set(u.id, `${u.firstName} ${u.lastName || ''}`.trim());
    }

    // Process data
    let total = 0;
    let completed = 0;
    let pending = 0;
    let noReply = 0;
    let notInterested = 0;
    let cancelled = 0;

    const memberStats = new Map();
    for (const u of users) {
        memberStats.set(u.id, {
            userId: u.id,
            name: userMap.get(u.id),
            total: 0,
            completed: 0,
            pending: 0,
            noReply: 0,
            notInterested: 0,
            cancelled: 0,
            completionRate: 0
        });
    }

    for (const group of grouped) {
        const count = group._count._all;
        const status = group.status;
        const uid = group.assignedToId;

        total += count;
        if (status === 'COMPLETED') completed += count;
        else if (status === 'PENDING') pending += count;
        else if (status === 'NO_REPLY') noReply += count;
        else if (status === 'NOT_INTERESTED') notInterested += count;
        else if (status === 'CANCELLED') cancelled += count;

        if (!memberStats.has(uid)) {
            // Unlikely due to users filter, but just in case
             memberStats.set(uid, {
                userId: uid,
                name: 'Unknown User',
                total: 0,
                completed: 0,
                pending: 0,
                noReply: 0,
                notInterested: 0,
                cancelled: 0,
                completionRate: 0
            });
        }

        const st = memberStats.get(uid);
        st.total += count;
        if (status === 'COMPLETED') st.completed += count;
        else if (status === 'PENDING') st.pending += count;
        else if (status === 'NO_REPLY') st.noReply += count;
        else if (status === 'NOT_INTERESTED') st.notInterested += count;
        else if (status === 'CANCELLED') st.cancelled += count;
    }

    const teamMembersArray = Array.from(memberStats.values()).map(m => {
        m.completionRate = m.total > 0 ? (m.completed / m.total) * 100 : 0;
        return m;
    });

    const completionRate = total > 0 ? (completed / total) * 100 : 0;

    // Trend: Group by date
    const targetUserIdsList = targetUserIds.length > 0 ? targetUserIds : [];

    // Build SQL condition string
    let sqlWhereParts = [];
    if (!isSuperAdmin || query.teamId) {
       if (targetUserIdsList.length > 0) {
          const idsString = targetUserIdsList.map(id => `'${id}'`).join(',');
          sqlWhereParts.push(`"assignedToId" IN (${idsString})`);
       } else {
          // Empty result case
          sqlWhereParts.push(`1=0`);
       }
    }

    if (startDate) sqlWhereParts.push(`"assignedAt" >= '${startDate.toISOString()}'`);
    if (endDate) sqlWhereParts.push(`"assignedAt" <= '${endDate.toISOString()}'`);

    const sqlWhere = sqlWhereParts.length > 0 ? `WHERE ${sqlWhereParts.join(' AND ')}` : '';

    const trendRecords = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE_TRUNC('day', "assignedAt") as date,
               COUNT(*) as total,
               SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
        FROM "TPCUser"
        ${sqlWhere}
        GROUP BY DATE_TRUNC('day', "assignedAt")
        ORDER BY date ASC
    `);

    const trend = trendRecords.map(r => ({
        date: r.date,
        total: Number(r.total),
        completed: Number(r.completed),
        pending: Number(r.pending),
    }));

    return {
      summary: {
        total,
        completed,
        pending,
        noReply,
        notInterested,
        cancelled,
        completionRate
      },
      teamMembers: teamMembersArray,
      trend,
    };
  }
}
