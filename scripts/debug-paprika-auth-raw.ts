/**
 * Hit the Paprika login endpoint and print the raw response body,
 * bypassing all schema validation so we can see the real shape.
 * Usage: npm run script:debug:paprika:auth
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';

const config = loadConfig();

const form = new FormData();
form.append('email', config.paprika.email);
form.append('password', config.paprika.password);

const response = await fetch('https://www.paprikaapp.com/api/v2/account/login/', {
  method: 'POST',
  body: form,
  headers: {
    'User-Agent': 'Paprika Recipe Manager 3/3.3.1 (macOS)',
    'Accept-Encoding': 'gzip, deflate',
  },
});

console.log(`Status: ${response.status} ${response.statusText}`);
console.log('Headers:');
for (const [key, value] of response.headers.entries()) {
  console.log(`  ${key}: ${value}`);
}

const text = await response.text();
console.log('\nRaw body:');
console.log(text);

try {
  const json: unknown = JSON.parse(text);
  console.log('\nParsed JSON:');
  console.log(JSON.stringify(json, null, 2));
} catch {
  console.log('\n(Body is not JSON)');
}
