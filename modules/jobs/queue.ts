import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { required } from '@/lib/config';
const globalQueue = globalThis as unknown as { redis?: Redis; analysisQueue?: Queue };
export function redis() {
  return (globalQueue.redis ??= new Redis(required('REDIS_URL'), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  }));
}
export function analysisQueue() {
  return (globalQueue.analysisQueue ??= new Queue('hive-analysis', { connection: redis() }));
}
export async function rateLimit(key: string, limit = 20, seconds = 60) {
  const count = (await redis().eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
    1,
    `rate:${key}`,
    seconds,
  )) as number;
  return count <= limit;
}
