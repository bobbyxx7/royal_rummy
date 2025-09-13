"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDbConnected = isDbConnected;
exports.validateUserToken = validateUserToken;
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = require("./db");
function isDbConnected() {
    return mongoose_1.default.connection?.readyState === 1;
}
async function validateUserToken(userId, token) {
    // In development (no DB), allow; in production, do not allow missing DB/token
    if (!isDbConnected())
        return process.env.NODE_ENV !== 'production';
    if (!userId || !token)
        return false;
    try {
        const user = await db_1.UserModel.findOne({ _id: userId, token }).select('_id').lean().exec();
        return !!user;
    }
    catch {
        return false;
    }
}
