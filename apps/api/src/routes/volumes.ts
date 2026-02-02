import { FastifyInstance, FastifyRequest } from 'fastify';
import { getDailyVolumes, getVolumeSummary, type VolumesResponse } from '@dln/shared';

interface VolumesQuerystring {
  start_date?: string;
  end_date?: string;
}

export async function volumesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: VolumesQuerystring }>(
    '/volumes',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            start_date: { type: 'string' },
            end_date: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: VolumesQuerystring }>): Promise<VolumesResponse> => {
      const { start_date, end_date } = request.query;
      const [volumes, summary] = await Promise.all([
        getDailyVolumes({ startDate: start_date, endDate: end_date }),
        getVolumeSummary({ startDate: start_date, endDate: end_date }),
      ]);
      return {
        volumes,
        summary,
      };
    }
  );
  fastify.get<{ Querystring: VolumesQuerystring }>(
    '/volumes/daily',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            start_date: { type: 'string' },
            end_date: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: VolumesQuerystring }>) => {
      const { start_date, end_date } = request.query;
      const volumes = await getDailyVolumes({ startDate: start_date, endDate: end_date });
      const byDate = new Map<
        string,
        { date: string; created_volume: number; fulfilled_volume: number; created_count: number; fulfilled_count: number }
      >();
      for (const vol of volumes) {
        const existing = byDate.get(vol.date) || {
          date: vol.date,
          created_volume: 0,
          fulfilled_volume: 0,
          created_count: 0,
          fulfilled_count: 0,
        };
        if (vol.event_type === 'created') {
          existing.created_volume = vol.volume_usd;
          existing.created_count = vol.order_count;
        } else {
          existing.fulfilled_volume = vol.volume_usd;
          existing.fulfilled_count = vol.order_count;
        }
        byDate.set(vol.date, existing);
      }
      return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  );
  fastify.get<{ Querystring: VolumesQuerystring }>(
    '/volumes/summary',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            start_date: { type: 'string' },
            end_date: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: VolumesQuerystring }>) => {
      const { start_date, end_date } = request.query;
      return getVolumeSummary({ startDate: start_date, endDate: end_date });
    }
  );
}
