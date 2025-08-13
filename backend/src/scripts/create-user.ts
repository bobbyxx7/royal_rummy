import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectMongo, UserModel } from '../db';

async function main() {
  const [,, mobileArg, passwordArg, walletArg] = process.argv;
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

  await connectMongo(uri);
  const existing: any = await UserModel.findOne({ mobile }).select('_id').lean().exec();
  if (existing) {
    // eslint-disable-next-line no-console
    console.log('User already exists:', existing._id);
    process.exit(0);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const doc = await UserModel.create({
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


