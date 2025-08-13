"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const socket_io_1 = require("socket.io");
const auth_routes_1 = require("./services/auth.routes");
const user_routes_1 = require("./services/user.routes");
const rummy_namespace_1 = require("./socket/rummy.namespace");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = Number(process.env.PORT || 6969);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
app.use((0, morgan_1.default)('dev'));
// Health
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// API base matching mobile app constants
// ApiConstants.apiUrl is https://syspsy.live/ and endpoints begin with /api/ and /Rummy/ and /rummy/
// We'll locally expose the same paths so the app can point to our backend by changing apiUrl.
app.use('/api/user', auth_routes_1.authRouter);
app.use('/api/user', user_routes_1.userRouter);
const io = new socket_io_1.Server(server, {
    cors: { origin: CLIENT_ORIGIN, credentials: true },
    path: '/socket.io',
});
// Socket namespace expected by app: '/rummy'
(0, rummy_namespace_1.rummyNamespace)(io);
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${PORT}`);
});
