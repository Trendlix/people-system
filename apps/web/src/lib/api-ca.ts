import 'server-only';
import tls from 'node:tls';

// People System's API serves HTTPS with a certificate from its own private authority (deploy/Caddyfile, `tls internal`),
// because ports 80/443 of its server belong to another system. API_CA_CERT holds that authority's root certificate,
// base64-encoded on one line as deploy/ca-cert.sh prints it (a plain PEM works too). It is added to the certificates
// this server trusts, next to the usual public ones. Not set (local development over http): nothing changes.
const raw = process.env.API_CA_CERT?.trim();
if (raw) {
  const pem = raw.includes('BEGIN CERTIFICATE') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('API_CA_CERT is not a certificate. Copy it again from deploy/ca-cert.sh.');
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), pem]);
}
