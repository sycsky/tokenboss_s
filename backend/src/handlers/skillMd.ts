import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILL_MD_PATH = join(__dirname, '../../public/skill.md');

export async function skillMdHandler(_evt: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const content = readFileSync(SKILL_MD_PATH, 'utf-8');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
    body: content,
  };
}
