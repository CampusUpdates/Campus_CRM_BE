const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/tpc/users',
  method: 'GET',
  headers: {
    // We would need a valid JWT token. But wait, the backend endpoint is protected by JwtAuthGuard!
  }
};
// I can just check the backend code in tpc.service.ts.
