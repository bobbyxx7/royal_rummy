import mongoose from 'mongoose';
import { UserModel } from './db';

export function isDbConnected(): boolean {
  return mongoose.connection?.readyState === 1;
}

export async function validateUserToken(userId?: string, token?: string): Promise<boolean> {
  // In development (no DB), allow; in production, do not allow missing DB/token
  if (!isDbConnected()) return process.env.NODE_ENV !== 'production';
  if (!userId || !token) return false;
  try {
    const user = await UserModel.findOne({ _id: userId, token }).select('_id').lean().exec();
    return !!user;
  } catch {
    return false;
  }
}


