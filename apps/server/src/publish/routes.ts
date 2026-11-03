import type { FastifyInstance } from "fastify";
import type { PublicationService } from "./service.js";
const params = {
  type: "object",
  required: ["reportId"],
  additionalProperties: false,
  properties: { reportId: { type: "string", minLength: 1, maxLength: 256 } },
};
export function registerPublicationRoutes(
  app: FastifyInstance,
  service: PublicationService,
) {
  app.get<{ Params: { reportId: string } }>(
    "/news/reports/:reportId/publication",
    { schema: { params } },
    async (request) => service.inspect(request.params.reportId),
  );
  app.post<{
    Params: { reportId: string };
    Body: { contentHash: string; confirm: boolean };
  }>(
    "/news/reports/:reportId/approve",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["contentHash", "confirm"],
          properties: {
            contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
            confirm: { const: true },
          },
        },
      },
    },
    async (request) =>
      service.approve(request.params.reportId, request.body.contentHash),
  );
  app.post<{ Params: { reportId: string } }>(
    "/news/reports/:reportId/publish",
    {
      schema: { params, body: { type: "object", additionalProperties: false } },
    },
    async (request, reply) => {
      const publication = await service.publish(request.params.reportId);
      if (publication.status === "failed") reply.code(502);
      return { publication };
    },
  );
}
