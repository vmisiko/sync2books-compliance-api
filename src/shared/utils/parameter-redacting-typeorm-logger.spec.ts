import { ParameterRedactingTypeOrmLogger } from './parameter-redacting-typeorm-logger';

const SECRET = 'sk_live_SECRET_API_KEY_VALUE';

describe('ParameterRedactingTypeOrmLogger', () => {
  let lines: string[];
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    lines = [];
    const grab = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
    spies = [
      jest.spyOn(console, 'log').mockImplementation(grab),
      jest.spyOn(console, 'info').mockImplementation(grab),
      jest.spyOn(console, 'warn').mockImplementation(grab),
      jest.spyOn(console, 'error').mockImplementation(grab),
    ];
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  const logger = () => new ParameterRedactingTypeOrmLogger(true);
  const out = () => lines.join('\n');

  it('logs the statement but not its parameters', () => {
    logger().logQuery('SELECT * FROM credentials WHERE apiKey = ?', [SECRET]);

    expect(out()).toContain('SELECT * FROM credentials WHERE apiKey = ?');
    expect(out()).not.toContain(SECRET);
    expect(out()).not.toContain('PARAMETERS');
  });

  it('does the same for a failed query', () => {
    logger().logQueryError('ER_BAD_FIELD_ERROR', 'UPDATE users SET token = ?', [SECRET]);

    expect(out()).toContain('UPDATE users SET token = ?');
    expect(out()).toContain('ER_BAD_FIELD_ERROR');
    expect(out()).not.toContain(SECRET);
  });

  it('does the same for a slow query', () => {
    logger().logQuerySlow(5000, 'SELECT * FROM users WHERE email = ?', [SECRET]);

    expect(out()).toContain('SELECT * FROM users WHERE email = ?');
    expect(out()).not.toContain(SECRET);
  });

  it('still logs queries that carry no parameters', () => {
    logger().logQuery('SELECT 1', []);
    expect(out()).toContain('SELECT 1');
  });
});
