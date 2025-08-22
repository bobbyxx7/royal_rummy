import { getCorsOptions } from '../services/cors';

describe('CORS options', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  test('production denies all when CLIENT_ORIGIN is * or empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGIN = '*';
    process.env.JWT_SECRET = 'x';
    process.env.ADMIN_TOKEN = 'x';
    process.env.MONGO_URI = 'mongodb://x';
    const opts = getCorsOptions() as any;
    expect(opts.origin).toBe(false);
  });

  test('allows only configured origins in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGIN = 'https://a.com, https://b.com';
    process.env.JWT_SECRET = 'x';
    process.env.ADMIN_TOKEN = 'x';
    process.env.MONGO_URI = 'mongodb://x';
    const opts = getCorsOptions() as any;
    const cb = (o: string, exp: boolean) => opts.origin(o, (_: any, allowed: boolean) => expect(allowed).toBe(exp));
    cb('https://a.com', true);
    cb('https://b.com', true);
    cb('https://c.com', false);
  });
});


