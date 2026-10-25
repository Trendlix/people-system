import { createHmac } from 'node:crypto';
import { twilioContentVariables } from '@trendlix/shared';
import {
  approvalOf,
  contentSidOf,
  EMPTY_TWIML,
  formParamsOf,
  listedContentsOf,
  TWILIO_PROBLEMS,
  twilioCreateContentRequest,
  twilioFetchApprovalRequest,
  twilioIncomingOf,
  twilioListContentRequest,
  twilioMessageForm,
  twilioMessageSidOf,
  twilioProblem,
  twilioSendRequest,
  twilioSignature,
  twilioSignatureOk,
  twilioStatusOf,
  twilioSubmitApprovalRequest,
  twilioUrlVariants,
} from './twilio.js';

// Twilio as the system calls it for WhatsApp (owner, 25 October 2026: "Add Twilio as a choice"; "No, WhatsApp only"):
// the Messages API's form, the Content API's requests and answers, Twilio's refusals in plain words, the signature of
// Twilio's calls (Twilio's own published example), the statuses and what people write. Every value is invented.

const SID = `AC${'a1'.repeat(16)}`;
const TOKEN = 'f'.repeat(32);
const MESSAGE = `SM${'0123456789abcdef'.repeat(2)}`;
const CONTENT = `HX${'fedcba9876543210'.repeat(2)}`;

describe('the Messages API’s request', () => {
  it('posts the form url-encoded with basic auth: To, From, ContentSid, ContentVariables (JSON), StatusCallback', () => {
    const form = twilioMessageForm({
      to: '+201001234567',
      sender: 'whatsapp:+201009998888',
      content: { sid: CONTENT, variables: twilioContentVariables(['Mona', 'a leave request', 'Omar, 02/11/2026'], 'leave/42') },
      statusCallback: 'https://people.trendlix.com/whatsapp/twilio/status',
    });
    expect(form).toEqual({
      To: 'whatsapp:+201001234567',
      From: 'whatsapp:+201009998888',
      ContentSid: CONTENT,
      ContentVariables: '{"1":"Mona","2":"a leave request","3":"Omar, 02/11/2026","4":"leave/42"}',
      StatusCallback: 'https://people.trendlix.com/whatsapp/twilio/status',
    });
    const req = twilioSendRequest(SID, TOKEN, form);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
    const sent = new URLSearchParams(req.body);
    expect(sent.get('To')).toBe('whatsapp:+201001234567');
    expect(JSON.parse(sent.get('ContentVariables')!)).toEqual({ 1: 'Mona', 2: 'a leave request', 3: 'Omar, 02/11/2026', 4: 'leave/42' });
  });

  it('sends a Messaging Service SID as MessagingServiceSid, and a text (the STOP answer) as Body', () => {
    const service = `MG${'0'.repeat(32)}`;
    expect(twilioMessageForm({ to: '+201001234567', sender: service, text: 'Done.' })).toEqual({ To: 'whatsapp:+201001234567', MessagingServiceSid: service, Body: 'Done.' });
    // the variables without a button: its number isn't sent
    expect(twilioContentVariables(['TrendLIX'], null)).toBe('{"1":"TrendLIX"}');
  });

  it('reads the message SID Twilio gave, only from an answer that took it', () => {
    expect(twilioMessageSidOf({ status: 201, body: { sid: MESSAGE, status: 'queued' } })).toBe(MESSAGE);
    expect(twilioMessageSidOf({ status: 201, body: { sid: 'nope' } })).toBeNull();
    expect(twilioMessageSidOf({ status: 400, body: { sid: MESSAGE } })).toBeNull();
    expect(twilioMessageSidOf(null)).toBeNull();
  });
});

describe('the Content API’s requests and answers', () => {
  it('makes, lists, submits and reads the approval with basic auth and JSON', () => {
    const made = twilioCreateContentRequest(SID, TOKEN, { friendly_name: 'people_test_message_en' });
    expect(made).toMatchObject({ method: 'POST', url: 'https://content.twilio.com/v1/Content', body: '{"friendly_name":"people_test_message_en"}' });
    expect(made.headers['content-type']).toBe('application/json');
    expect(twilioListContentRequest(SID, TOKEN).url).toBe('https://content.twilio.com/v1/Content?PageSize=100');
    expect(twilioListContentRequest(SID, TOKEN, 'https://content.twilio.com/v1/Content?PageSize=100&Page=1&PageToken=PT1').url).toContain('PageToken=PT1');
    expect(twilioSubmitApprovalRequest(SID, TOKEN, CONTENT, { name: 'people_test_message_en', category: 'UTILITY' })).toMatchObject({
      method: 'POST',
      url: `https://content.twilio.com/v1/Content/${CONTENT}/ApprovalRequests/whatsapp`,
      body: '{"name":"people_test_message_en","category":"UTILITY"}',
    });
    expect(twilioFetchApprovalRequest(SID, TOKEN, CONTENT)).toMatchObject({ method: 'GET', url: `https://content.twilio.com/v1/Content/${CONTENT}/ApprovalRequests` });
  });

  it('reads a Content’s SID, the list (following only Twilio’s own next page), and the approval', () => {
    expect(contentSidOf({ status: 201, body: { sid: CONTENT } })).toBe(CONTENT);
    expect(contentSidOf({ status: 400, body: { code: 20001 } })).toBeNull();
    const page = listedContentsOf({
      contents: [{ sid: CONTENT, friendly_name: 'people_test_message_en', language: 'en', date_created: '2026-10-25T08:00:00Z' }, { sid: 'bad', friendly_name: 'x' }],
      meta: { next_page_url: 'https://content.twilio.com/v1/Content?PageSize=100&Page=1' },
    });
    expect(page).toEqual({ items: [{ sid: CONTENT, name: 'people_test_message_en', language: 'en', createdAt: '2026-10-25T08:00:00Z' }], next: 'https://content.twilio.com/v1/Content?PageSize=100&Page=1' });
    // the next page elsewhere is never followed: the Auth Token would go with it
    expect(listedContentsOf({ contents: [], meta: { next_page_url: 'https://evil.example/v1/Content' } }).next).toBeNull();
    expect(approvalOf({ whatsapp: { status: 'approved', rejection_reason: '' } })).toEqual({ status: 'approved', reason: null });
    expect(approvalOf({ whatsapp: { status: 'rejected', rejection_reason: 'INVALID_FORMAT' } })).toEqual({ status: 'rejected', reason: 'Meta found its format invalid.' });
    expect(approvalOf({ whatsapp: { status: 'rejected', rejection_reason: 'The body has too many variables.' } }).reason).toBe('The body has too many variables.');
    // the POST's answer: the approval itself
    expect(approvalOf({ name: 'people_test_message_en', category: 'UTILITY', status: 'received' })).toEqual({ status: 'pending', reason: null });
    expect(approvalOf({ whatsapp: {} })).toEqual({ status: 'not_submitted', reason: null });
  });
});

describe('Twilio’s refusals in plain words', () => {
  const refused = (status: number, code: number, message = 'x') => twilioProblem({ status, body: { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status } });

  it('say authentication failed, the sender isn’t WhatsApp-enabled, the template isn’t approved, the recipient isn’t on WhatsApp, the account is suspended or out of funds', () => {
    expect(refused(401, 20003, 'Authenticate')).toEqual({ kind: 'auth', message: TWILIO_PROBLEMS.auth, retry: false, code: 20003 });
    expect(twilioProblem({ status: 401, body: null })).toMatchObject({ kind: 'auth' });
    expect(refused(400, 63007)).toMatchObject({ kind: 'sender', message: TWILIO_PROBLEMS.sender, retry: false });
    expect(refused(400, 21606)).toMatchObject({ kind: 'sender' });
    expect(refused(400, 21703)).toMatchObject({ kind: 'service', message: TWILIO_PROBLEMS.service });
    expect(twilioProblem({ code: 63016 })).toMatchObject({ kind: 'window', message: TWILIO_PROBLEMS.window, code: 63016 });
    expect(refused(400, 63027)).toMatchObject({ kind: 'template', message: TWILIO_PROBLEMS.template });
    expect(refused(400, 21656)).toMatchObject({ kind: 'template' });
    expect(twilioProblem({ code: 63003 })).toMatchObject({ kind: 'recipient', message: TWILIO_PROBLEMS.recipient });
    expect(refused(400, 21211)).toMatchObject({ kind: 'recipient' });
    expect(refused(401, 20005, 'Account not active')).toMatchObject({ kind: 'account', message: TWILIO_PROBLEMS.account });
    expect(twilioProblem({ code: 30002 })).toMatchObject({ kind: 'account' });
    expect(refused(400, 21999, 'Your account has insufficient funds')).toMatchObject({ kind: 'account' });
    expect(refused(400, 21608)).toMatchObject({ kind: 'account', message: TWILIO_PROBLEMS.trial });
    expect(twilioProblem({ code: 63031 })).toMatchObject({ kind: 'self' });
    expect(twilioProblem({ code: 63013 })).toMatchObject({ kind: 'policy' });
  });

  it('try again later for a rate limit, Twilio’s own trouble, or Twilio not reached', () => {
    expect(refused(429, 20429)).toMatchObject({ kind: 'rate', retry: true });
    expect(twilioProblem({ status: 429, body: null })).toMatchObject({ kind: 'rate', retry: true });
    expect(twilioProblem({ status: 503, body: null })).toMatchObject({ kind: 'twilio', retry: true, code: null });
    expect(twilioProblem(null)).toEqual({ kind: 'unreachable', message: TWILIO_PROBLEMS.unreachable, retry: true, code: null });
    // the retried ones' words end so the sender can say "Tried N times" instead
    for (const m of [TWILIO_PROBLEMS.rate, TWILIO_PROBLEMS.twilio, TWILIO_PROBLEMS.unreachable]) expect(m).toMatch(/: it will be tried again\.$/);
  });

  it('an unknown one gives Twilio’s own words and code, short and on one line; a callback’s code alone, its page', () => {
    expect(refused(400, 21999, 'Something\nnew   happened').message).toBe('Twilio refused it: Something new happened (code 21999).');
    expect(twilioProblem({ code: 30008 }).message).toBe('Twilio couldn’t send or deliver it (error 30008, twilio.com/docs/errors/30008).');
    expect(twilioProblem({ status: 201, body: null })).toMatchObject({ kind: 'other', message: 'Twilio answered without a message SID.' });
  });
});

describe('the signature of Twilio’s calls', () => {
  it('is Twilio’s published example: HMAC-SHA1 of the URL and the sorted parameters, base64', () => {
    // twilio.com/docs/usage/security#validating-requests: Auth Token 12345, this URL and these parameters
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params: [string, string][] = [
      ['Digits', '1234'],
      ['To', '+18005551212'],
      ['From', '+12349013030'],
      ['Caller', '+12349013030'],
      ['CallSid', 'CA1234567890ABCDE'],
    ];
    expect(twilioSignature(url, params, '12345')).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(twilioSignatureOk(url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', '12345')).toBe(true);
  });

  const url = 'https://people.trendlix.com/whatsapp/twilio/status';
  const params: [string, string][] = [
    ['MessageSid', MESSAGE],
    ['MessageStatus', 'delivered'],
    ['Body', 'توقف'],
  ];
  const signed = twilioSignature(url, params, TOKEN);

  it('is refused for another token, a changed parameter, the relay’s own URL, or nothing at all', () => {
    expect(twilioSignatureOk(url, params, signed, TOKEN)).toBe(true);
    expect(twilioSignatureOk(url, params, signed, 'e'.repeat(32))).toBe(false);
    expect(twilioSignatureOk(url, [...params.slice(0, 1), ['MessageStatus', 'read'], params[2]], signed, TOKEN)).toBe(false);
    // signed for the public URL Twilio called, never the API's address behind the website
    expect(twilioSignatureOk('https://api.internal:3001/api/public/whatsapp/twilio/status', params, signed, TOKEN)).toBe(false);
    expect(twilioSignatureOk(url, params, undefined, TOKEN)).toBe(false);
    expect(twilioSignatureOk(url, params, '', TOKEN)).toBe(false);
    expect(twilioSignatureOk(url, params, signed, null)).toBe(false);
    // the same, by HMAC-SHA1 written out
    const data = `${url}Body${'توقف'}MessageSid${MESSAGE}MessageStatusdelivered`;
    expect(signed).toBe(createHmac('sha1', TOKEN).update(Buffer.from(data, 'utf8')).digest('base64'));
  });

  it('is taken with the default port written or left out, as Twilio may sign either', () => {
    expect(twilioUrlVariants(url)).toEqual([url, 'https://people.trendlix.com:443/whatsapp/twilio/status']);
    expect(twilioUrlVariants('https://people.trendlix.com:443/x?a=1')).toEqual(['https://people.trendlix.com:443/x?a=1', 'https://people.trendlix.com/x?a=1']);
    expect(twilioUrlVariants('http://localhost:3000/x')).toEqual(['http://localhost:3000/x']);
    const withPort = twilioSignature('https://people.trendlix.com:443/whatsapp/twilio/status', params, TOKEN);
    expect(twilioSignatureOk(url, params, withPort, TOKEN)).toBe(true);
  });

  it('reads the parameters as Twilio sent them, form-encoded', () => {
    expect(formParamsOf(Buffer.from('Body=Stop.+Now&From=whatsapp%3A%2B201001234567&A%5Bb%5D=1'))).toEqual([
      ['Body', 'Stop. Now'],
      ['From', 'whatsapp:+201001234567'],
      ['A[b]', '1'],
    ]);
    expect(formParamsOf(undefined)).toEqual([]);
  });
});

describe('what Twilio’s calls say', () => {
  it('maps MessageStatus to the log’s: sent, delivered, read; failed and undelivered as failed with the ErrorCode; the rest left aside', () => {
    const s = (status: string, extra: [string, string][] = []) => twilioStatusOf([['MessageSid', MESSAGE], ['MessageStatus', status], ...extra]);
    expect(s('sent')).toEqual({ sid: MESSAGE, status: 'sent', errorCode: null });
    expect(s('delivered')).toMatchObject({ status: 'delivered' });
    expect(s('read')).toMatchObject({ status: 'read' });
    expect(s('failed', [['ErrorCode', '63016']])).toEqual({ sid: MESSAGE, status: 'failed', errorCode: 63016 });
    expect(s('undelivered', [['ErrorCode', '63003']])).toEqual({ sid: MESSAGE, status: 'failed', errorCode: 63003 });
    for (const before of ['queued', 'accepted', 'sending', 'scheduled', 'canceled', 'received']) expect(s(before), before).toBeNull();
    expect(twilioStatusOf([['MessageSid', 'nope'], ['MessageStatus', 'read']])).toBeNull();
  });

  it('reads who wrote and their words, from WhatsApp only (an SMS is never read)', () => {
    expect(twilioIncomingOf([['From', 'whatsapp:+201001234567'], ['Body', 'STOP'], ['WaId', '201001234567']])).toEqual({ from: '201001234567', text: 'STOP' });
    expect(twilioIncomingOf([['From', 'whatsapp:+201001234567'], ['Body', ''], ['ButtonText', 'Stop']])).toEqual({ from: '201001234567', text: 'Stop' });
    expect(twilioIncomingOf([['From', '+201001234567'], ['Body', 'STOP']])).toBeNull();
    expect(twilioIncomingOf([['From', 'whatsapp:+201001234567']])).toBeNull();
    expect(EMPTY_TWIML).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});
