/**
 * POST /v1/messages — Lambda Function URL entry point.
 *
 * Anthropic-compat shim that lets Claude Code / Anthropic-native clients use
 * TokenBoss. Mirrors `handlers/chatProxy.ts` exactly — same streamingResponse
 * wrapper, same StreamWriter shape — but dispatches to `runMessagesCore`,
 * which handles the Anthropic ↔ OpenAI translation before delegating to
 * `streamChatCore` in-process.
 *
 * Deployment shape is identical to chatProxy: a Lambda Function URL with
 * InvokeMode = RESPONSE_STREAM and `awslambda.streamifyResponse` to flush
 * every `write()` to the client.
 *
 * The `awslambda` global is injected by the Node.js Lambda runtime; this
 * file MUST NOT be imported by `local.ts` — local.ts imports
 * `messagesProxyCore.ts` directly via the streaming dispatch path.
 */

import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import type { Writable } from "node:stream";

import { runMessagesCore } from "../lib/messagesProxyCore.js";
import type { StreamWriter } from "../lib/chatProxyCore.js";

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
      await runMessagesCore(event, writer);
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
