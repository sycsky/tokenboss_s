import { PhoneFrame } from '../components/PhoneFrame.js';
import { BackButton } from '../components/BackButton.js';
import { APIKeyList } from '../components/APIKeyList.js';

/**
 * API key management screen. Thin wrapper around <APIKeyList />.
 */
export default function Keys() {
  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-6 flex flex-col">
        <div className="mb-4">
          <BackButton to="/dashboard" label="账户" />
        </div>
        <h1 className="text-h2 mb-1">API Keys</h1>
        <p className="text-caption text-text-secondary mb-4">
          用这些 key 调用 OpenAI 兼容的 /v1/chat/completions
        </p>
        <div className="flex-1 overflow-y-auto">
          <APIKeyList />
        </div>
      </div>
    </PhoneFrame>
  );
}
