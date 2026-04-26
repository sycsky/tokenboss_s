import { render } from '@testing-library/react';
import { ConsumeChart24h, HourBucket } from '../ConsumeChart24h';

describe('<ConsumeChart24h>', () => {
  it('renders 24 bars', () => {
    const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ hour: i, consumeUsd: i * 0.1 }));
    const { container } = render(<ConsumeChart24h buckets={buckets} />);
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(24);
  });

  it('marks peak hour with peak class', () => {
    const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ hour: i, consumeUsd: i === 12 ? 5 : 0.1 }));
    const { container } = render(<ConsumeChart24h buckets={buckets} />);
    const peak = container.querySelector('[data-bar][data-peak="true"]');
    expect(peak).toBeTruthy();
  });
});
