import net from 'node:net';

// A tiny SMTP server in the test's own process, for the email settings' tests (owner, 23 October 2026: "why dont we add
// SMTP setup in the organization setup"): the other mail tests keep messages in MailService's outbox
// (MAIL_TRANSPORT=memory), which never speaks SMTP, so the test email's plain-words answers (a refused password, a
// sender not allowed, STARTTLS refused, nothing listening) need a real conversation. On 127.0.0.1 only, a free port each
// time; it understands what nodemailer says: EHLO, AUTH PLAIN and LOGIN, MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT,
// and refuses STARTTLS (no certificate here). Never reached by anything but the test that started it.

export interface FakeMessage {
  /** The envelope's sender and recipients, as MAIL FROM and RCPT TO said them. */
  from: string;
  to: string[];
  /** Who signed in for it, or null. */
  user: string | null;
  /** The message as sent: its headers and body. */
  data: string;
}

export interface FakeSmtp {
  port: number;
  messages: FakeMessage[];
  close(): Promise<void>;
}

export interface FakeSmtpOptions {
  /** The one sign-in it takes; none: no sign-in asked for. */
  user?: string;
  pass?: string;
  /** The senders it allows (MAIL FROM); none: any. */
  senders?: readonly string[];
}

const addressIn = (line: string) => (/<([^>]*)>/.exec(line)?.[1] ?? '').toLowerCase();

export async function fakeSmtp(opts: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const messages: FakeMessage[] = [];
  const sockets = new Set<net.Socket>();
  const auth = opts.user !== undefined;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffer = '';
    let mode: 'command' | 'data' | 'plain' | 'login-user' | 'login-pass' = 'command';
    let user: string | null = null;
    let loginUser = '';
    let envelope: { from: string; to: string[] } | null = null;
    let data: string[] = [];
    const say = (line: string) => socket.write(`${line}\r\n`);
    const signIn = (name: string, pass: string) => {
      if (name === opts.user && pass === opts.pass) {
        user = name;
        say('235 2.7.0 Authentication successful');
      } else {
        say('535 5.7.8 Authentication credentials invalid');
      }
      mode = 'command';
    };

    const onLine = (line: string) => {
      if (mode === 'data') {
        if (line === '.') {
          messages.push({ from: envelope!.from, to: envelope!.to, user, data: data.join('\r\n') });
          envelope = null;
          data = [];
          mode = 'command';
          say('250 2.0.0 Ok: queued');
        } else {
          data.push(line.startsWith('..') ? line.slice(1) : line);
        }
        return;
      }
      if (mode === 'plain') {
        const [, name, pass] = Buffer.from(line, 'base64').toString('utf8').split('\0');
        return signIn(name ?? '', pass ?? '');
      }
      if (mode === 'login-user') {
        loginUser = Buffer.from(line, 'base64').toString('utf8');
        mode = 'login-pass';
        return say('334 UGFzc3dvcmQ6');
      }
      if (mode === 'login-pass') return signIn(loginUser, Buffer.from(line, 'base64').toString('utf8'));

      const [verb, ...rest] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          return socket.write(auth ? '250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n' : '250-fake.test\r\n250 8BITMIME\r\n');
        case 'HELO':
          return say('250 fake.test');
        case 'STARTTLS':
          return say('454 4.7.0 TLS not available');
        case 'AUTH': {
          if (!auth) return say('503 5.5.1 Authentication not enabled');
          const method = (rest[0] ?? '').toUpperCase();
          if (method === 'PLAIN' && rest[1]) {
            const [, name, pass] = Buffer.from(rest[1], 'base64').toString('utf8').split('\0');
            return signIn(name ?? '', pass ?? '');
          }
          if (method === 'PLAIN') {
            mode = 'plain';
            return say('334 ');
          }
          if (method === 'LOGIN') {
            mode = 'login-user';
            return say('334 VXNlcm5hbWU6');
          }
          return say('504 5.5.4 Unrecognized authentication type');
        }
        case 'MAIL': {
          if (auth && !user) return say('530 5.7.0 Authentication required');
          const from = addressIn(line);
          if (opts.senders && !opts.senders.includes(from)) return say(`553 5.7.1 <${from}>: Sender address rejected: not owned by user ${user ?? ''}`.trim());
          envelope = { from, to: [] };
          return say('250 2.1.0 Ok');
        }
        case 'RCPT':
          if (!envelope) return say('503 5.5.1 Error: need MAIL command');
          envelope.to.push(addressIn(line));
          return say('250 2.1.5 Ok');
        case 'DATA':
          if (!envelope?.to.length) return say('503 5.5.1 Error: need RCPT command');
          mode = 'data';
          return say('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET':
          envelope = null;
          data = [];
          return say('250 2.0.0 Ok');
        case 'NOOP':
          return say('250 2.0.0 Ok');
        case 'QUIT':
          say('221 2.0.0 Bye');
          return socket.end();
        default:
          return say('502 5.5.2 Error: command not recognized');
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        onLine(line);
      }
    });
    say('220 fake.test ESMTP');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port on 127.0.0.1 that nothing listens on: taken and given back at once. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
