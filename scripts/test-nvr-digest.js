const https = require('https');
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^,]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] || match[3];
  }
  return params;
}

function makeDigestRequest(endpoint, username, password) {
  return new Promise((resolve, reject) => {
    const fullUrl = `https://pheetomxwm.a.pinggy.link${endpoint}`;
    const urlObj = new URL(fullUrl);

    // Step 1: Initial request to get 401 and WWW-Authenticate header
    https
      .get(urlObj, (res) => {
        if (res.statusCode !== 401) {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body }));
          return;
        }

        const authHeader = res.headers['www-authenticate'];
        if (!authHeader || !authHeader.startsWith('Digest')) {
          return reject(
            new Error(
              'Expected Digest WWW-Authenticate header, got: ' + authHeader,
            ),
          );
        }

        const params = parseDigestHeader(authHeader);
        const realm = params.realm;
        const nonce = params.nonce;
        const qop = params.qop || 'auth';
        const opaque = params.opaque || '';

        const nc = '00000001';
        const cnonce = crypto.randomBytes(8).toString('hex');
        const uri = urlObj.pathname + urlObj.search;
        const method = 'GET';

        const ha1 = md5(`${username}:${realm}:${password}`);
        const ha2 = md5(`${method}:${uri}`);
        const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

        let authValue = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", cnonce="${cnonce}", nc=${nc}, qop=${qop}`;
        if (opaque) {
          authValue += `, opaque="${opaque}"`;
        }

        const authenticatedReq = https.get(
          urlObj,
          {
            headers: {
              Authorization: authValue,
            },
          },
          (authRes) => {
            let body = '';
            authRes.on('data', (chunk) => (body += chunk));
            authRes.on('end', () =>
              resolve({ status: authRes.statusCode, body }),
            );
          },
        );

        authenticatedReq.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  const username = 'admin';
  const password = 'Chand@12345';

  const endpoints = [
    '/cgi-bin/magicBox.cgi?action=getSystemInfo',
    '/cgi-bin/magicBox.cgi?action=getDeviceType',
    '/cgi-bin/configManager.cgi?action=getConfig&name=Network',
    '/cgi-bin/configManager.cgi?action=getConfig&name=NTP',
    '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle',
    '/cgi-bin/configManager.cgi?action=getConfig&name=RemoteDevice',
    '/cgi-bin/magicBox.cgi?action=getDeviceType',
  ];

  for (const ep of endpoints) {
    console.log(`\n================= Querying: ${ep} =================`);
    try {
      const res = await makeDigestRequest(ep, username, password);
      console.log(`Status: ${res.status}`);
      console.log(`Response:\n${res.body}`);
    } catch (e) {
      console.error(`Error querying ${ep}:`, e.message);
    }
  }
}

main();
