import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { getActiveBucketsForUser } from '../lib/store.js';
import { verifySessionHeader, isAuthFailure } from '../lib/auth.js';

export async function listBucketsHandler(evt: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headerUserId = (evt.headers?.['x-tb-user-id'] as string | undefined) ?? null;
  let userId: string | null = headerUserId;
  if (!userId) {
    const authHeader =
      evt.headers?.authorization ?? evt.headers?.Authorization ?? undefined;
    const session = await verifySessionHeader(authHeader);
    if (isAuthFailure(session)) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized' }) };
    }
    userId = session.userId;
  }
  const buckets = getActiveBucketsForUser(userId!);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buckets }),
  };
}
