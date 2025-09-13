"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
async function main() {
    const [, , mobileArg, passwordArg, walletArg] = process.argv;
    if (!mobileArg || !passwordArg || !walletArg) {
        // eslint-disable-next-line no-console
        console.log('Usage: ts-node src/scripts/create-user.ts <mobile> <password> <wallet>');
        process.exit(1);
    }
    const mobile = String(mobileArg);
    const password = String(passwordArg);
    const wallet = String(walletArg);
    const uri = process.env.MONGO_URI || '';
    if (!uri) {
        // eslint-disable-next-line no-console
        console.error('MONGO_URI is not set');
        process.exit(1);
    }
    await (0, db_1.connectMongo)(uri);
    const existing = await db_1.UserModel.findOne({ mobile }).select('_id').lean().exec();
    if (existing) {
        // eslint-disable-next-line no-console
        console.log('User already exists:', existing._id);
        process.exit(0);
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const doc = await db_1.UserModel.create({
        name: '',
        mobile,
        passwordHash,
        wallet,
        token,
    });
    // eslint-disable-next-line no-console
    console.log('Created user:', String(doc._id));
    process.exit(0);
}
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
