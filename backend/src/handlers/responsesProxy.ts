/**
 * POST /v1/responses — Lambda Function URL entry point.
 *
 * Mirror of `chatProxy.ts` for the OpenAI Responses API endpoint (used by
 * Codex CLI and any client targeting `${OPENAI_BASE_URL}/responses`). Kept
 * here for symmetry with the chat-completions Lambda handler — production
 * runs `local.ts` on Zeabur, so this file is only reached if the project
 * is later deployed via SAM.
 *
 * All forwarding logic lives in `lib/chatProxyCore.ts#streamResponsesCore`.
 */

import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import type { Writable } from "node:stream";

import { streamResponsesCore, type StreamWriter } from "../lib/chatProxyCore.js";

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
      await streamResponsesCore(event, writer);
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
