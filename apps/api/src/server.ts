import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  config,
  createLogger,
  closeClickHouseClient,
  closeRedisClient,
} from '@dln/shared';
import { ordersRoutes } from './routes/orders.js';
import { volumesRoutes } from './routes/volumes.js';

const logger = createLogger('api');

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    },
  });
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
  fastify.get('/', async () => ({
    name: 'DLN Indexer API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      orders: '/api/orders',
      volumes: '/api/volumes',
      dailyVolumes: '/api/volumes/daily',
      volumeSummary: '/api/volumes/summary',
    },
  }));
  await fastify.register(
    async (api) => {
      await api.register(ordersRoutes);
      await api.register(volumesRoutes);
    },
    { prefix: '/api' }
  );
  return fastify;
}

async function main() {
  const server = await buildServer();
  try {
    await server.listen({
      port: config.api.port,
      host: config.api.host,
    });
    logger.info(
      { port: config.api.port, host: config.api.host },
      'API server started'
    );
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
  const shutdown = async () => {
    logger.info('Shutting down...');
    await server.close();
    await closeClickHouseClient();
    await closeRedisClient();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Unhandled error');
  process.exit(1);
});
