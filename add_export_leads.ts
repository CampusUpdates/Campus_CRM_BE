import * as fs from 'fs';

const filePath = 'src/leads/leads.service.ts';
let content = fs.readFileSync(filePath, 'utf8');

const exportMethod = `
  async exportExcelStream(
    user: { sub: string; teamId?: number | null },
    query: any,
    scope: string = 'OWN',
  ): Promise<any> {
    const finalWhere = await this.buildLeadWhere(user, query, scope);
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leads');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Course Interested', key: 'courseInterested', width: 20 },
      { header: 'City', key: 'city', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 },
    ];

    const leads = await this.prisma.lead.findMany({
      where: finalWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        status: true,
      }
    });

    for (const lead of leads) {
      worksheet.addRow({
        id: lead.id,
        name: \`\${lead.firstName} \${lead.lastName || ''}\`.trim(),
        email: lead.email,
        phone: lead.phone,
        status: lead.status?.name || 'Unknown',
        courseInterested: lead.courseInterested,
        city: lead.city,
        createdAt: lead.createdAt.toISOString(),
      });
    }

    return workbook;
  }
`;

// Insert it before async update(
const insertIdx = content.indexOf('async update(');
if (insertIdx !== -1) {
  content = content.substring(0, insertIdx) + exportMethod + '\n  ' + content.substring(insertIdx);
  fs.writeFileSync(filePath, content);
  console.log("Added exportExcelStream successfully!");
} else {
  console.log("Could not find update method");
}
