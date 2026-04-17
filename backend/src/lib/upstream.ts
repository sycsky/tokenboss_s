/** True when the backend should synthesize fake LLM responses instead of calling a real upstream. */
export function isMockMode(): boolean {
  return process.env.MOCK_UPSTREAM === "1";
}
