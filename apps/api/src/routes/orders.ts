import { FastifyInstance, FastifyRequest } from 'fastify';
import { getOrders, type OrdersResponse } from '@dln/shared';

interface OrdersQuerystring {
  page?: string;
  limit?: string;
  event_type?: string;
  start_date?: string;
  end_date?: string;
}

export async function ordersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: OrdersQuerystring }>(
    '/orders',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string' },
            limit: { type: 'string' },
            event_type: { type: 'string', enum: ['created', 'fulfilled'] },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: OrdersQuerystring }>): Promise<OrdersResponse> => {
      const { page, limit, event_type, start_date, end_date } = request.query;
      const pageNum = Math.max(1, parseInt(page || '1', 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10)));
      const { orders, total } = await getOrders({
        page: pageNum,
        limit: limitNum,
        eventType: event_type,
        startDate: start_date,
        endDate: end_date,
      });
      return {
        orders,
        total,
        page: pageNum,
        limit: limitNum,
      };
    }
  );
  fastify.get<{ Params: { orderId: string } }>(
    '/orders/:orderId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
          },
          required: ['orderId'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orderId: string } }>, reply) => {
      const { orderId } = request.params;
      const { orders } = await getOrders({
        page: 1,
        limit: 100,
      });
      const order = orders.find((o) => o.order_id === orderId);
      if (!order) {
        return reply.status(404).send({ error: 'Order not found' });
      }
      return order;
    }
  );
}
