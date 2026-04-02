import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { AppRoot } from './App'

function ThrowingHeader() {
  throw new Error('header crash')
}

function ThrowingMintPanel() {
  throw new Error('mint crash')
}

function StableAssetsPanel() {
  return <div>Assets still online</div>
}

describe('App error boundaries', () => {
  let consoleErrorSpy

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    delete globalThis.Sentry
    vi.restoreAllMocks()
  })

  it('renders the dashboard by default', () => {
    render(<App />)

    expect(screen.getByText(/mint new token/i)).toBeInTheDocument()
    expect(screen.getByText(/my assets/i)).toBeInTheDocument()
  })

  it('shows a section fallback and keeps healthy panels visible when a risky component crashes', () => {
    render(
      <App
        components={{
          MintPanel: ThrowingMintPanel,
          AssetsPanel: StableAssetsPanel,
        }}
      />,
    )

    expect(screen.getByText(/mint form temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/assets still online/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows the full oops page and refresh button for app-level crashes', () => {
    render(
      <AppRoot
        components={{
          Header: ThrowingHeader,
        }}
      />,
    )

    expect(screen.getByText(/oops/i)).toBeInTheDocument()
    expect(screen.getByText(/the app hit an unexpected problem/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh page/i })).toBeInTheDocument()
  })

  it('logs captured crashes to Sentry when available', () => {
    const captureException = vi.fn()
    globalThis.Sentry = { captureException }

    render(
      <AppRoot
        components={{
          Header: ThrowingHeader,
        }}
      />,
    )

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(captureException.mock.calls[0][1]).toMatchObject({
      extra: {
        area: 'main-app',
      },
    })
  })
})
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { describe, expect, it } from 'vitest'

describe('Developer hub interface', () => {
  it('renders the developer hub by default', async () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /developer hub/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /build against soromint without leaving the ui/i })).toBeInTheDocument()
    expect(screen.getAllByText(/^API Reference$/i).length).toBeGreaterThan(0)
  })

  it('switches between documentation sections from the side navigation', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /authentication/i }))

    expect(await screen.findByRole('heading', { level: 1, name: /backend authentication/i })).toBeInTheDocument()
    expect(screen.getAllByText(/jwt-based auth flow/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/jwt_secret/i)).toBeInTheDocument()
  })

  it('renders syntax-highlighted code snippets inside markdown content', async () => {
    const { container } = render(<App />)

    await screen.findByRole('heading', { name: /build against soromint without leaving the ui/i })
    expect(container.querySelector('pre code.hljs')).toBeTruthy()
  })

  it('still allows switching back to the dashboard view', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /dashboard/i }))

    expect(screen.getByText(/mint new token/i)).toBeInTheDocument()
    expect(screen.getByText(/my assets/i)).toBeInTheDocument()
  })
})
import { fireEvent, render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

describe('Responsive token card grid', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
  });

  it('shows the empty asset prompt before a wallet is connected', () => {
    render(<App />);

    expect(screen.getByText(/connect your wallet to see your assets/i)).toBeTruthy();
  });

  it('renders minted tokens as cards inside the responsive grid', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          name: 'Aurora Credit',
          symbol: 'AUR',
          contractId: 'CAURORA1234567890',
          decimals: 7
        },
        {
          name: 'Nebula Yield',
          symbol: 'NBY',
          contractId: 'CNBY1234567890ABCDE',
          decimals: 4
        }
      ]
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    const grid = await screen.findByRole('list', { name: /token cards/i });

    expect(grid.className).toContain('token-grid');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Aurora Credit')).toBeTruthy();
    expect(screen.getByText('Nebula Yield')).toBeTruthy();
    expect(screen.getAllByText(/contract id/i)).toHaveLength(2);
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/tokens\/GB/));
  });
});
