const http = require('http');
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  { sub: '298c540b-77d4-43ea-b562-f73b718884ce', username: 'superadmin', type: 'access' },
  'your-existing-secret',
  { expiresIn: '1h' }
);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/tpc/lead/123e4567-e89b-12d3-a456-426614174000',
  method: 'GET',
  headers: { 'Authorization': 'Bearer ' + token }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Data length:", data.length);
    console.log("Data:", data);
  });
});
req.end();
