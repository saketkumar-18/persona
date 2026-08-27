import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NavBar from '../components/nav-bar';
import ToastHost, { pushToast } from '../components/toast';

describe('NavBar', () => {
  it('renders brand + privacy link + theme toggle', () => {
    render(<NavBar />);
    expect(screen.getByText('Persona')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(
      screen.getByRole('button', { name: /toggle color theme/i }),
    ).toBeInTheDocument();
  });

  it('shows online status chip when connected', () => {
    render(<NavBar connected />);
    expect(screen.getByText('online')).toBeInTheDocument();
  });
});

describe('ToastHost', () => {
  it('renders pushed toasts', async () => {
    render(<ToastHost />);
    pushToast('hello ghost');
    expect(await screen.findByText('hello ghost')).toBeInTheDocument();
  });
});
