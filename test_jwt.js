const jwt = require('jsonwebtoken');
const http = require('http');

const token = jwt.sign(
  { sub: '298c540b-77d4-43ea-b562-f73b718884ce', username: 'superadmin', type: 'access' },
  'your-existing-secret',
  { expiresIn: '1h' }
);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/tpc/users',
  method: 'GET',
  headers: { 'Authorization': 'Bearer ' + token }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Response length:", data.length);
    console.log("Response JSON:", data);
  });
});
req.end();
