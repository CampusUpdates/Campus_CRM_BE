const { Client } = require('pg');
require('dotenv').config();

// Strip ssl parameters if any
let url = process.env.DATABASE_URL;
if (url.includes('?')) {
  url = url.split('?')[0];
}

const client = new Client({ connectionString: url });
async function main() {
  console.log('Connecting...');
  await client.connect();
  console.log('Connected. Running query...');
  const res = await client.query('SELECT 1 as result');
  console.log(res.rows);
  await client.end();
}
main().catch(console.error);
