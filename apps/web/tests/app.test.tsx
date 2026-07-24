import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App.tsx';

describe('App shell', () => {
  it('renders the title', () => {
    render(<App />);
    expect(screen.getByText('CSUF Schedule Builder')).toBeInTheDocument();
  });
});
