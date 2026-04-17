import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      service: "tokenboss-backend",
      stage: process.env.STAGE ?? "dev",
      time: new Date().toISOString(),
    }),
  };
};
