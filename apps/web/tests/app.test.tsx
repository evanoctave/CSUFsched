import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App.tsx';
import { useScheduleStore, STORE_DEFAULTS } from '../src/store.ts';

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    useScheduleStore.setState(STORE_DEFAULTS);
  });

  it('renders the title, sidebar hint and calendar', () => {
    render(<App />);
    expect(screen.getByText('CSUF Schedule Builder')).toBeInTheDocument();
    expect(screen.getByText('Pick a term to start.')).toBeInTheDocument();
    expect(screen.getByTestId('calendar')).toBeInTheDocument();
  });
});
