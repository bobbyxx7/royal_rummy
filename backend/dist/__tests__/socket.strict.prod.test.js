"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const socket_io_client_1 = require("socket.io-client");
const auth = __importStar(require("../auth"));
const rummy_namespace_1 = require("../socket/rummy.namespace");
jest.setTimeout(20000);
describe('Production strict auth when DB disconnected', () => {
    const OLD_ENV = process.env;
    let httpServer;
    let ioServer;
    let addr;
    beforeEach((done) => {
        process.env = { ...OLD_ENV };
        httpServer = http_1.default.createServer();
        ioServer = new socket_io_1.Server(httpServer, { path: '/socket.io' });
        (0, rummy_namespace_1.rummyNamespace)(ioServer);
        httpServer.listen(() => { addr = httpServer.address(); done(); });
    });
    afterEach((done) => {
        ioServer.of('/rummy').disconnectSockets(true);
        ioServer.close(() => httpServer.close(() => { process.env = OLD_ENV; done(); }));
    });
    test('disconnects in production when DB is not connected', async () => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        process.env.NODE_ENV = 'production';
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
        await new Promise((resolve) => {
            c1.on('disconnect', () => resolve());
            c1.on('connect_error', () => resolve());
        });
    });
    test('allows connection in non-production when DB is not connected', async () => {
        jest.spyOn(auth, 'isDbConnected').mockReturnValue(false);
        process.env.NODE_ENV = 'development';
        const url = `http://localhost:${addr.port}/rummy`;
        const c1 = (0, socket_io_client_1.io)(url, { transports: ['websocket'], query: { userId: 'u1', token: 't1' } });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { try {
                c1.close();
            }
            catch { } ; reject(new Error('did not connect in dev')); }, 2000);
            c1.on('connect', () => { clearTimeout(timeout); try {
                c1.close();
            }
            catch { } ; resolve(); });
            c1.on('disconnect', () => { });
        });
    });
});
