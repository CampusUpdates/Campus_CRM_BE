const http = require('http');

async function login() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });
    req.write(JSON.stringify({ username: 'admin', password: 'password' }));
    req.end();
  });
}

async function fetchUsers(token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/tpc/users',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.end();
  });
}

async function main() {
  const loginRes = await login();
  console.log('Login Response:', loginRes);
  if (loginRes.access_token) {
    const users = await fetchUsers(loginRes.access_token);
    console.log('Users Response Type:', typeof JSON.parse(users));
    console.log('Users Response:', users);
  }
}
main().catch(console.error);
