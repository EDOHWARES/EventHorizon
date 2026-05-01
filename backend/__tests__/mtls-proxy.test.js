const https = require('https');
const fs = require('fs');
const path = require('path');

describe('mTLS Proxy Integration', () => {
  const certsDir = path.join(__dirname, '../certs');
  const agent = new https.Agent({
    ca: fs.readFileSync(path.join(certsDir, 'ca.crt')),
    cert: fs.readFileSync(path.join(certsDir, 'client.crt')),
    key: fs.readFileSync(path.join(certsDir, 'client.key')),
    rejectUnauthorized: false, // For demo only
  });

  it('should return health status via mTLS', (done) => {
    https.get({
      host: 'localhost',
      port: 5000,
      path: '/api/health',
      agent,
      rejectUnauthorized: false,
    }, (res) => {
      expect(res.statusCode).toBe(200);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        expect(JSON.parse(data).status).toBe('ok');
        done();
      });
    }).on('error', done);
  });
});
