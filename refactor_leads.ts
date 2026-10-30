import * as fs from 'fs';

const filePath = 'src/leads/leads.service.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Find the start of findAll
const findAllRegex = /async findAll\([\s\S]*?scope: string = 'OWN',\s*\)\s*\{/;
const findAllMatch = content.match(findAllRegex);
if (!findAllMatch) {
  console.log("Could not find findAll method");
  process.exit(1);
}

// Find where finalWhere is defined
const finalWhereRegex = /const finalWhere = andConditions\.length > 0 \? \{ AND: andConditions \} : \{\};/;
const finalWhereMatch = content.match(finalWhereRegex);
if (!finalWhereMatch) {
  console.log("Could not find finalWhere definition");
  process.exit(1);
}

const startIdx = findAllMatch.index + findAllMatch[0].length;
const endIdx = finalWhereMatch.index + finalWhereMatch[0].length;

const filterLogic = content.substring(startIdx, endIdx);

// The filter logic contains variables initialized from query.
// We should replace the start of findAll with a call to buildLeadWhere

const newFindAllStart = `
    const finalWhere = await this.buildLeadWhere(user, query, scope);
`;

const buildWhereMethod = `
  async buildLeadWhere(
    user: { sub: string; teamId?: number | null },
    query: any,
    scope: string = 'OWN',
  ) {
    ${filterLogic}
    return finalWhere;
  }
`;

// Insert buildLeadWhere before findAll
content = content.substring(0, findAllMatch.index) + buildWhereMethod + '\n  ' + findAllMatch[0] + newFindAllStart + content.substring(endIdx);

fs.writeFileSync(filePath, content);
console.log("Refactored findAll successfully!");
