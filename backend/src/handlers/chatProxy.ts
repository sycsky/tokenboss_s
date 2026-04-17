/**
 * POST /v1/chat/completions — Lambda Function URL entry point.
 *
 * This file is deliberately thin: all the request / credit / upstream logic
 * lives in `lib/chatProxyCore.ts` so it can also run in the local dev server
 * without depending on the `awslambda` runtime global.
 *
 * Deployment shape:
 *   - Lambda Function URL with InvokeMode = RESPONSE_STREAM
 *   - `awslambda.streamifyResponse` wraps the handler so every `write()` is
 *     flushed to the client instead of being buffered until the handler
 *     returns.
 *
 * The `awslambda` global is injected by the Node.js Lambda runtime. It is
 * NOT present in local dev, which is why this file MUST NOT be imported by
 * `local.ts` — `local.ts` imports `chatProxyCore.ts` directly.
 */

import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import type { Writable } from "node:stream";

import { streamChatCore, type StreamWriter } from "../lib/chatProxyCore.js";

/** Subset of the `awslambda` runtime global we rely on. */
interface AwsLambdaStreaming {
  streamifyResponse: (
    handler: (
      event: APIGatewayProxyEventV2,
      responseStream: Writable,
      context: Context,
    ) => Promise<void>,
  ) => (event: APIGatewayProxyEventV2, context: Context) => Promise<void>;
  HttpResponseStream: {
    from: (
      responseStream: Writable,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ) => Writable;
  };
}

// Injected by the Lambda Node.js runtime at cold start. Referencing this at
// module scope is safe inside Lambda; in any other environment, importing
// this file will throw a ReferenceError — which is intentional.
declare const awslambda: AwsLambdaStreaming;

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    let stream: Writable = responseStream;
    let headWritten = false;
    let ended = false;

    const writer: StreamWriter = {
      writeHead(statusCode, headers) {
        if (headWritten) return;
        stream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode,
          headers,
        });
        headWritten = true;
      },
      write(chunk) {
        if (!headWritten) {
          stream = awslambda.HttpResponseStream.from(responseStream, {
            statusCode: 200,
            headers: {},
          });
          headWritten = true;
        }
        stream.write(chunk);
      },
      end() {
        if (ended) return;
        stream.end();
        ended = true;
      },
    };

    try {
      await streamChatCore(event, writer);
    } finally {
      if (!ended) {
        try {
          stream.end();
        } catch {
          /* stream may already be closed */
        }
      }
    }
  },
);
