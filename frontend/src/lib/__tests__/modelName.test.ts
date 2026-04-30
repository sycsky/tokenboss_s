import { describe, it, expect } from 'vitest';
import { formatModelName } from '../modelName';

describe('formatModelName', () => {
  it('uppercases GPT family + title-cases the tier', () => {
    expect(formatModelName('gpt-5.4-mini')).toBe('GPT-5.4 Mini');
    expect(formatModelName('gpt-5.4')).toBe('GPT-5.4');
    expect(formatModelName('gpt-5.5')).toBe('GPT-5.5');
    expect(formatModelName('gpt-5-4')).toBe('GPT-5.4'); // backend dash form
    expect(formatModelName('gpt-5.5-codex')).toBe('GPT-5.5 Codex');
    expect(formatModelName('gpt-5.5-pro')).toBe('GPT-5.5 Pro');
  });

  it('preserves OpenAI o-series lowercase prefix', () => {
    expect(formatModelName('o1')).toBe('o1');
    expect(formatModelName('o3')).toBe('o3');
    expect(formatModelName('o4-mini')).toBe('o4 Mini');
  });

  it('formats Claude family with version + tier', () => {
    expect(formatModelName('claude-sonnet-4')).toBe('Claude Sonnet 4');
    expect(formatModelName('claude-sonnet-4-7')).toBe('Claude Sonnet 4.7');
    expect(formatModelName('claude-opus-4-7')).toBe('Claude Opus 4.7');
    expect(formatModelName('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
  });

  it('formats Gemini family', () => {
    expect(formatModelName('gemini-2.0-pro')).toBe('Gemini 2.0 Pro');
    expect(formatModelName('gemini-2-5-flash')).toBe('Gemini 2.5 Flash');
  });

  it('handles other known families', () => {
    expect(formatModelName('deepseek-v3')).toBe('DeepSeek 3');
    expect(formatModelName('qwen-3-72b')).toBe('Qwen 3.72b');
    expect(formatModelName('glm-4.5')).toBe('GLM 4.5');
  });

  it('passes unknown patterns through unchanged', () => {
    expect(formatModelName('some-future-model-x9')).toBe('some-future-model-x9');
    expect(formatModelName('totallyrandom')).toBe('totallyrandom');
  });

  it('handles empty / null / whitespace gracefully', () => {
    expect(formatModelName('')).toBe('—');
    expect(formatModelName(null)).toBe('—');
    expect(formatModelName(undefined)).toBe('—');
    expect(formatModelName('   ')).toBe('—');
  });
});
