"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = require("../services/cors");
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
        const opts = (0, cors_1.getCorsOptions)();
        expect(opts.origin).toBe(false);
    });
    test('allows only configured origins in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.CLIENT_ORIGIN = 'https://a.com, https://b.com';
        process.env.JWT_SECRET = 'x';
        process.env.ADMIN_TOKEN = 'x';
        process.env.MONGO_URI = 'mongodb://x';
        const opts = (0, cors_1.getCorsOptions)();
        const cb = (o, exp) => opts.origin(o, (_, allowed) => expect(allowed).toBe(exp));
        cb('https://a.com', true);
        cb('https://b.com', true);
        cb('https://c.com', false);
    });
});
