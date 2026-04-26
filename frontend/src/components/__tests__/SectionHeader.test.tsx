import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../SectionHeader';

it('renders num / cn / en in editorial style', () => {
  render(<SectionHeader num="01" cn="标准价" en="Pay as you go" />);
  expect(screen.getByText('01')).toBeInTheDocument();
  expect(screen.getByText('标准价')).toBeInTheDocument();
  expect(screen.getByText('Pay as you go')).toBeInTheDocument();
});
