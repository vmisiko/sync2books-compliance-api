import { callbackUrlProblem, isPrivateAddress } from './callback-url';

describe('callbackUrlProblem', () => {
  it.each([
    'https://erp.example.com/hooks/etims',
    'https://erp.example.com:8443/hooks?tenant=1',
    'https://93.184.216.34/hook',
  ])('accepts %s', (url) => {
    expect(callbackUrlProblem(url, false)).toBeNull();
  });

  it.each([
    ['http://erp.example.com/hook', 'must use https'],
    ['ftp://erp.example.com/hook', 'must use https'],
    ['https://user:pass@erp.example.com/hook', 'must not contain credentials'],
    ['https://localhost/hook', 'must be a public host'],
    ['https://api.localhost/hook', 'must be a public host'],
    ['https://127.0.0.1/hook', 'must be a public host'],
    ['https://10.1.2.3/hook', 'must be a public host'],
    ['https://192.168.0.5/hook', 'must be a public host'],
    ['https://169.254.169.254/latest/meta-data', 'must be a public host'],
    ['https://[::1]/hook', 'must be a public host'],
    ['https://[::ffff:10.0.0.1]/hook', 'must be a public host'],
    ['/relative', 'must be an absolute URL'],
    [
      `https://erp.example.com/${'a'.repeat(2048)}`,
      'must be at most 2048 characters',
    ],
  ])('rejects %s', (url, problem) => {
    expect(callbackUrlProblem(url, false)).toBe(problem);
  });

  it('lets local development point at localhost over http', () => {
    expect(callbackUrlProblem('http://localhost:4000/hook', true)).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '172.20.1.1',
    '100.64.0.1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '2606:2800:220:1::1'])('%s is public', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});
