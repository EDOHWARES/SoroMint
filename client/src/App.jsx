import React, { useState } from 'react'
import axios from 'axios'
import { Wallet, Coins, Plus, List, ArrowRight, ShieldCheck } from 'lucide-react'
import ErrorBoundary from './components/error-boundary'
import { AppCrashPage, SectionCrashCard } from './components/error-fallbacks'

const API_BASE = 'http://localhost:5000/api'

function AppHeader({ address, onConnectWallet }) {
  return (
    <header className="mb-16 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-stellar-blue p-2">
          <Coins className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Soro<span className="text-stellar-blue">Mint</span>
        </h1>
      </div>

      <button
        onClick={onConnectWallet}
        className="btn-primary flex items-center gap-2"
      >
        <Wallet size={18} />
        {address ? `${address.substring(0, 6)}...${address.slice(-4)}` : 'Connect Wallet'}
      </button>
    </header>
  )
}

function MintTokenPanel({
  address,
  formData,
  isMinting,
  onFormChange,
  onSubmit,
}) {
  return (
    <section className="lg:col-span-1">
      <div className="glass-card">
        <h2 className="mb-6 flex items-center gap-2 text-xl font-semibold">
          <Plus size={20} className="text-stellar-blue" />
          Mint New Token
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-400">Token Name</label>
            <input
              type="text"
              placeholder="e.g. My Stellar Asset"
              className="input-field w-full"
              value={formData.name}
              onChange={(event) => onFormChange({ name: event.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-400">Symbol</label>
            <input
              type="text"
              placeholder="e.g. MSA"
              className="input-field w-full"
              value={formData.symbol}
              onChange={(event) => onFormChange({ symbol: event.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-400">Decimals</label>
            <input
              type="number"
              className="input-field w-full"
              value={formData.decimals}
              onChange={(event) => onFormChange({ decimals: parseInt(event.target.value, 10) || 0 })}
              required
            />
          </div>
          <button
            type="submit"
            disabled={isMinting || !address}
            className="btn-primary mt-4 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isMinting ? 'Deploying...' : 'Mint Token'}
            {!isMinting && <ArrowRight size={18} />}
          </button>
        </form>
      </div>
    </section>
  )
}

function AssetsPanel({ address, tokens }) {
  return (
    <section className="lg:col-span-2">
      <div className="glass-card min-h-[400px]">
        <h2 className="mb-6 flex items-center gap-2 text-xl font-semibold">
          <List size={20} className="text-stellar-blue" />
          My Assets
        </h2>

        {!address ? (
          <div className="flex h-64 flex-col items-center justify-center text-slate-500">
            <ShieldCheck size={48} className="mb-4 opacity-20" />
            <p>Connect your wallet to see your assets</p>
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-slate-500">
            <p>No tokens minted yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10 text-sm text-slate-400">
                  <th className="pb-4 font-medium">Name</th>
                  <th className="pb-4 font-medium">Symbol</th>
                  <th className="pb-4 font-medium">Contract ID</th>
                  <th className="pb-4 font-medium">Decimals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tokens.map((token, index) => (
                  <tr key={index} className="group transition-colors hover:bg-white/5">
                    <td className="py-4 font-medium">{token.name}</td>
                    <td className="py-4 text-slate-300">{token.symbol}</td>
                    <td className="max-w-[120px] truncate py-4 font-mono text-sm text-stellar-blue">
                      {token.contractId}
                    </td>
                    <td className="py-4 text-slate-400">{token.decimals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

const defaultAppComponents = {
  Header: AppHeader,
  MintPanel: MintTokenPanel,
  AssetsPanel,
}

function App({ components = defaultAppComponents }) {
  const Header = components.Header ?? defaultAppComponents.Header
  const MintPanel = components.MintPanel ?? defaultAppComponents.MintPanel
  const TokensPanel = components.AssetsPanel ?? defaultAppComponents.AssetsPanel

  const [address, setAddress] = useState('')
  const [tokens, setTokens] = useState([])
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7,
  })
  const [isMinting, setIsMinting] = useState(false)
import React, { Suspense, lazy, useState } from 'react'
import axios from 'axios'
import {
  ArrowRight,
  BookOpenText,
  Coins,
  LayoutDashboard,
  List,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { useState } from 'react';
import React, { useState } from 'react';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Wallet, Coins, Plus, List, ArrowRight, ShieldCheck } from 'lucide-react';
import { SkeletonList, SkeletonTokenForm } from './components/Skeleton';
import { useWalletStore, useTokenStore, useUIStore } from './store';
import ThemeToggle from './components/ThemeToggle';
import ThemeToggle from './components/ThemeToggle';
import { useWalletStore, useTokenStore } from './store';
import React from "react"
import { useForm } from "react-hook-form"
import axios from "axios"

const DeveloperHub = lazy(() => import('./components/developer-hub'))

const API_BASE = 'http://localhost:5000/api'
const views = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'developer-hub', label: 'Developer Hub', icon: BookOpenText },
]

function App() {
  const [activeView, setActiveView] = useState('developer-hub')
  const [address, setAddress] = useState('')
  const [tokens, setTokens] = useState([])
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7,
  })
  const [isMinting, setIsMinting] = useState(false)

  const connectWallet = async () => {
    const mockAddress = `GB...${Math.random().toString(36).substring(7).toUpperCase()}`
    setAddress(mockAddress)
    fetchTokens(mockAddress)
  }

  const fetchTokens = async (userAddress) => {
    try {
      const response = await axios.get(`${API_BASE}/tokens/${userAddress}`)
      const tokenList = response.data?.data ?? response.data ?? []
      setTokens(Array.isArray(tokenList) ? tokenList : [])
    } catch (err) {
      console.error('Error fetching tokens', err)
  // Use Zustand stores for global state
  const { address, setWallet, disconnectWallet } = useWalletStore();
  const { tokens, addToken, isLoading, setLoading, fetchTokens } = useTokenStore();
  
  const { t } = useTranslation();
  const { address, setWallet, disconnectWallet } = useWalletStore();
  const { tokens, addToken, isLoading, fetchTokens } = useTokenStore();
  const { theme, setTheme } = useUIStore();

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7
  });
  const [isMinting, setIsMinting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Apply theme to document and detect system preference
  useEffect(() => {
    // If no theme is set yet, detect system preference
    if (!theme) {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(systemPrefersDark ? 'dark' : 'light');
    }
  }, [theme, setTheme]);

  useEffect(() => {
    // Apply theme class to document element
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const connectWallet = async () => {
    // In a real app, use @stellar/freighter-api
    const mockAddress = `GB...${Math.random().toString(36).substring(7).toUpperCase()}`
    setAddress(mockAddress)
    fetchTokens(mockAddress)
  }

  const fetchTokens = async (userAddress) => {
    try {
      const response = await axios.get(`${API_BASE}/tokens/${userAddress}`)
      const tokenList = response.data?.data ?? response.data ?? []
      setTokens(Array.isArray(tokenList) ? tokenList : [])
    } catch (err) {
      console.error('Error fetching tokens', err)
    const mockAddress = 'GB...' + Math.random().toString(36).substring(7).toUpperCase();
    setWallet(mockAddress);
    fetchTokens(mockAddress);
  };

    setAddress(mockAddress);
    setStatusMessage('Wallet connected');
    toast.success(t('app.walletConnected') || 'Wallet connected');
    fetchTokens(mockAddress);
  };

  const fetchTokens = async (userAddress) => {
    try {
      const resp = await axios.get(`${API_BASE}/tokens/${userAddress}`);
      const tokenList = Array.isArray(resp.data?.data)
        ? resp.data.data
        : Array.isArray(resp.data)
          ? resp.data
          : [];

      setTokens(tokenList);
    } catch (err) {
      console.error('Error fetching tokens', err);
      setStatusMessage('Error fetching tokens');
    }
  }

  const updateFormData = (updates) => {
    setFormData((currentData) => ({
      ...currentData,
      ...updates,
    }))
  }

  const handleMint = async (event) => {
    event.preventDefault()

    if (!address) {
      alert('Connect wallet first')
      return
    }

    setIsMinting(true)

    try {
      const mockContractId = `C${Math.random().toString(36).substring(2, 10).toUpperCase()}`
      const response = await axios.post(`${API_BASE}/tokens`, {
  const handleMint = async (e) => {
    e.preventDefault()
    if (!address) return alert('Connect wallet first');
    
    setIsMinting(true)
    try {
      // Logic for Minting:
      // 1. Sign transaction on client (Freighter)
      // 2. Submit to Soroban RPC
      // 3. Save metadata to server
      const mockContractId = `C${Math.random().toString(36).substring(2, 10).toUpperCase()}`
      
      const response = await axios.post(`${API_BASE}/tokens`, {
    e.preventDefault();
    if (!address) {
      toast.warn(t('mint.connectFirst') || 'Please connect wallet first');
      return;
    }

    setIsMinting(true);
    setStatusMessage('Minting token...');

    try {
      const mockContractId = 'C' + Math.random().toString(36).substring(2, 10).toUpperCase();

      const resp = await axios.post(`${API_BASE}/tokens`, {
        ...formData,
        contractId: mockContractId,
        ownerPublicKey: address,
      })

      const createdToken = response.data?.data ?? response.data
      setTokens((currentTokens) => [...currentTokens, createdToken])
      setFormData({ name: '', symbol: '', decimals: 7 })
      alert('Token Minted Successfully!')
    } catch (err) {
      alert(`Minting failed: ${err.message}`)
      const createdToken = resp.data?.data ?? resp.data;

      if (createdToken) {
        setTokens((currentTokens) => [...currentTokens, createdToken]);
      }
      addToken(resp.data);
      setFormData({ name: '', symbol: '', decimals: 7 });
      setStatusMessage('');
      toast.success(t('mint.success') || 'Token minted successfully');
    } catch (err) {
      setStatusMessage('');
      toast.error((t('mint.failed') || 'Minting failed') + ': ' + err.message);
    } finally {
      setIsMinting(false)
    }
  }

  const updateFormData = (updates) => {
    setFormData((currentData) => ({
      ...currentData,
      ...updates,
    }))
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <Header address={address} onConnectWallet={connectWallet} />

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <ErrorBoundary
          context={{ area: 'mint-panel' }}
          resetKeys={[address, formData.name, formData.symbol, formData.decimals, isMinting]}
          fallbackRender={({ resetErrorBoundary }) => (
            <SectionCrashCard
              className="lg:col-span-1"
              title="Mint form temporarily unavailable"
              description="The token creation panel hit an unexpected issue. You can retry this section without reloading the rest of the app."
              onRetry={resetErrorBoundary}
            />
          )}
        >
          <MintPanel
            address={address}
            formData={formData}
            isMinting={isMinting}
            onFormChange={updateFormData}
            onSubmit={handleMint}
          />
        </ErrorBoundary>

        <ErrorBoundary
          context={{ area: 'assets-panel' }}
          resetKeys={[address, tokens.length]}
          fallbackRender={({ resetErrorBoundary }) => (
            <SectionCrashCard
              className="lg:col-span-2"
              title="Asset list unavailable"
              description="The asset table crashed, but the rest of the dashboard is still running. Retry this section or refresh the page."
              onRetry={resetErrorBoundary}
            />
          )}
        >
          <TokensPanel address={address} tokens={tokens} />
        </ErrorBoundary>

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-stellar-blue p-3 shadow-lg shadow-blue-500/30">
            <Coins className="h-8 w-8 text-white" />
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-sky-200/70">Platform</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Soro<span className="text-stellar-blue">Mint</span>
            </h1>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="view-switcher">
            {views.map((view) => {
              const Icon = view.icon
              const isActive = activeView === view.id

              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveView(view.id)}
                  className={`view-pill ${isActive ? 'view-pill-active' : ''}`}
                >
                  <Icon className="h-4 w-4" />
                  {view.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={connectWallet}
            className="btn-primary flex items-center gap-2"
          >
            <Wallet size={18} />
            {address ? `${address.substring(0, 6)}...${address.slice(-4)}` : 'Connect Wallet'}
    <div className="max-w-6xl mx-auto px-4 py-12" role="application">

      {/* Screen Reader Live Region */}
      <div aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      <header className="flex justify-between items-center mb-16" role="banner">
        <div className="flex items-center gap-3">
          <div className="bg-stellar-blue p-2 rounded-xl" aria-hidden="true">
            <Coins className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Soro<span className="text-stellar-blue">Mint</span>
          </h1>
        </div>
        
        <button 
          onClick={address ? disconnectWallet : connectWallet}
          className="flex items-center gap-2 btn-primary"

        <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <ThemeToggle />
          
          <button
            onClick={address ? disconnectWallet : connectWallet}
            className="flex items-center gap-2 btn-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            className="flex items-center gap-2 btn-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-stellar-dark"
            aria-label={address ? 'Wallet connected' : 'Connect wallet'}
          >
            <Wallet size={18} aria-hidden="true" />
            <span>
              {address
                ? `${address.substring(0, 6)}...${address.slice(-4)}`
                : 'Connect Wallet'}
            </span>
          </button>
        </div>
      </header>

      {activeView === 'developer-hub' ? (
        <Suspense
          fallback={(
            <div className="glass-card flex min-h-[320px] items-center justify-center">
              <div className="space-y-3 text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-sky-200/70">Developer Hub</p>
                <p className="text-lg font-medium text-white">Loading documentation...</p>
              </div>
            </div>
          )}
        >
          <DeveloperHub />
        </Suspense>
      ) : (
        <main className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <section className="lg:col-span-1">
            <div className="glass-card">
              <h2 className="mb-6 flex items-center gap-2 text-xl font-semibold text-white">
                <Plus size={20} className="text-stellar-blue" />
                Mint New Token
              </h2>
              <form onSubmit={handleMint} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">Token Name</label>
                  <input
                    type="text"
                    placeholder="e.g. My Stellar Asset"
                    className="input-field w-full"
                    value={formData.name}
                    onChange={(event) => updateFormData({ name: event.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">Symbol</label>
                  <input
                    type="text"
                    placeholder="e.g. MSA"
                    className="input-field w-full"
                    value={formData.symbol}
                    onChange={(event) => updateFormData({ symbol: event.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">Decimals</label>
                  <input
                    type="number"
                    className="input-field w-full"
                    value={formData.decimals}
                    onChange={(event) => updateFormData({ decimals: parseInt(event.target.value, 10) || 0 })}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isMinting}
                  className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
                >
                  {isMinting ? 'Deploying...' : 'Mint Token'}
                  {!isMinting && <ArrowRight size={18} />}
                </button>
              </form>
            </div>
          </section>

          <section className="lg:col-span-2">
            <div className="glass-card min-h-[400px]">
              <h2 className="mb-6 flex items-center gap-2 text-xl font-semibold text-white">
                <List size={20} className="text-stellar-blue" />
                My Assets
              </h2>

              {!address ? (
                <div className="flex h-64 flex-col items-center justify-center text-slate-500">
                  <ShieldCheck size={48} className="mb-4 opacity-20" />
                  <p>Connect your wallet to see your assets</p>
                </div>
              ) : tokens.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-slate-500">
                  <p>No tokens minted yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-white/10 text-sm text-slate-400">
                        <th className="pb-4 font-medium">Name</th>
                        <th className="pb-4 font-medium">Symbol</th>
                        <th className="pb-4 font-medium">Contract ID</th>
                        <th className="pb-4 font-medium">Decimals</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tokens.map((token, index) => (
                        <tr key={index} className="group transition-colors hover:bg-white/5">
                          <td className="py-4 font-medium">{token.name}</td>
                          <td className="py-4 text-slate-300">{token.symbol}</td>
                          <td className="max-w-[120px] truncate py-4 font-mono text-sm text-stellar-blue">
                            {token.contractId}
                          </td>
                          <td className="py-4 text-slate-400">{token.decimals}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      <footer className="mt-16 border-t border-white/5 pt-8 text-center text-sm text-slate-500">
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8" role="main">

        {/* Mint Form */}
        <section className="lg:col-span-1" aria-labelledby="mint-heading">
          <div className="glass-card">
            <h2
              id="mint-heading"
              className="text-xl font-semibold mb-6 flex items-center gap-2"
            >
              <Plus size={20} className="text-stellar-blue" aria-hidden="true" />
              Mint New Token
            </h2>
            {isLoading ? (
              <SkeletonTokenForm />
            ) : (
              <form onSubmit={handleMint} className="space-y-4">

            <form
              onSubmit={handleMint}
              className="space-y-4"
              aria-describedby="form-description"
            >
              <p id="form-description" className="sr-only">
                Form to create a new token with name, symbol, and decimals
              </p>

              <div>
                <label htmlFor="token-name" className="block text-sm font-medium text-slate-300 mb-1">
                  Token Name
                </label>
                <input
                  id="token-name"
                  type="text"
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>

              <div>
                <label htmlFor="token-symbol" className="block text-sm font-medium text-slate-300 mb-1">
                  Symbol
                </label>
                <input
                  id="token-symbol"
                  type="text"
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.symbol}
                  onChange={(e) =>
                    setFormData({ ...formData, symbol: e.target.value })
                  }
                  required
                />
              </div>

              <div>
                <label htmlFor="token-decimals" className="block text-sm font-medium text-slate-300 mb-1">
                  Decimals
                </label>
                <input
                  id="token-decimals"
                  type="number"
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.decimals}
                  onChange={(e) => setFormData({...formData, decimals: parseInt(e.target.value, 10) || 0})}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      decimals: parseInt(e.target.value)
                    })
                  }
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isMinting}
                aria-busy={isMinting}
                className="w-full btn-primary mt-4 flex justify-center items-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <span>{isMinting ? 'Deploying...' : 'Mint Token'}</span>
                {!isMinting && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </form>
              <form onSubmit={handleMint} className="space-y-4" aria-describedby="form-description">
                <p id="form-description" className="sr-only">
                  Form to create a new token with name, symbol, and decimals
                </p>

                <div>
                  <label htmlFor="token-name" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Token Name
                  </label>
                  <input
                    id="token-name"
                    type="text"
                    className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="token-symbol" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Symbol
                  </label>
                  <input
                    id="token-symbol"
                    type="text"
                    className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="token-decimals" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Decimals
                  </label>
                  <input
                    id="token-decimals"
                    type="number"
                    className="w-full input-field focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.decimals}
                    onChange={(e) => setFormData({ ...formData, decimals: parseInt(e.target.value) })}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isMinting}
                  aria-busy={isMinting}
                  className="w-full btn-primary mt-4 flex justify-center items-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <span>{isMinting ? 'Deploying...' : 'Mint Token'}</span>
                  {!isMinting && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </form>
            )}
          </div>
        </section>

        {/* Assets Grid */}
        <section className="lg:col-span-2">
          <div className="glass-card asset-panel min-h-[400px]">
            <div className="assets-section-header">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <List size={20} className="text-stellar-blue" />
                  My Assets
                </h2>
                <p className="assets-section-copy">
                  Browse your minted tokens in a mobile-first grid that stays readable from pocket screens to
                  widescreen dashboards.
                </p>
              </div>

              {address && tokens.length > 0 && (
                <span className="asset-count-pill">
                  {tokens.length} {tokens.length === 1 ? 'asset' : 'assets'}
                </span>
              )}
            </div>
            
        {/* Assets Table */}
        <section className="lg:col-span-2" aria-labelledby="assets-heading">
          <div className="glass-card min-h-[400px]">
            <h2
              id="assets-heading"
              className="text-xl font-semibold mb-6 flex items-center gap-2"
            >
              <List size={20} className="text-stellar-blue" aria-hidden="true" />
              My Assets
            </h2>

            {!address ? (
              <div
                className="flex flex-col items-center justify-center h-64 text-slate-400"
                role="status"
              >
                <ShieldCheck size={48} className="mb-4 opacity-20" aria-hidden="true" />
                <p>Connect your wallet to see your assets</p>
              </div>
            ) : isLoading ? (
              <div className="py-8">
                <SkeletonList count={5} />
              </div>
            ) : tokens.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400"
                role="status"
              >
                <p>No tokens minted yet</p>
              </div>
            ) : (
              <div className="token-grid" role="list" aria-label="Token cards">
                {tokens.map((token, index) => (
                  <article
                    key={token.contractId ?? `${token.symbol}-${index}`}
                    className="token-card"
                    role="listitem"
                  >
                    <div className="token-card-accent" aria-hidden="true" />

                    <div className="token-card-header">
                      <div className="token-card-brand">
                        <div className="token-card-icon">
                          <Coins size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="token-card-kicker">Token {String(index + 1).padStart(2, '0')}</p>
                          <h3 className="token-card-title">{token.name}</h3>
                        </div>
                      </div>

                      <span className="token-card-symbol">{token.symbol}</span>
                    </div>

                    <div className="token-card-body">
                      <div className="token-card-stat-row">
                        <div className="token-card-stat">
                          <span className="token-card-label">Decimals</span>
                          <span className="token-card-value">{token.decimals}</span>
                        </div>

                        <div className="token-card-stat">
                          <span className="token-card-label">Network</span>
                          <span className="token-card-value">Soroban</span>
                        </div>
                      </div>

                      <div className="token-card-contract-block">
                        <span className="token-card-label">Contract ID</span>
                        <p className="token-card-contract">{token.contractId}</p>
                      </div>
                    </div>
                  </article>
                ))}
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left"
                  role="table"
                  aria-label="User tokens"
                >
                  <thead>
                    <tr className="border-b border-black/5 dark:border-white/10 text-slate-500 dark:text-slate-300 text-sm">
                      <th scope="col" className="pb-4 font-medium">Name</th>
                      <th scope="col" className="pb-4 font-medium">Symbol</th>
                      <th scope="col" className="pb-4 font-medium">Contract ID</th>
                      <th scope="col" className="pb-4 font-medium">Decimals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {tokens.map((token, i) => (
                      <tr
                        key={i}
                        className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-within:bg-black/10 dark:focus-within:bg-white/10"
                      >
                        <td className="py-4 font-medium">{token.name}</td>
                        <td className="py-4 text-slate-600 dark:text-slate-300">{token.symbol}</td>
                        <td className="py-4 font-mono text-sm text-stellar-blue truncate max-w-[120px]">
                          {token.contractId}
                        </td>
                        <td className="py-4 text-slate-600 dark:text-slate-300">{token.decimals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer
        className="mt-16 pt-8 border-t border-black/5 dark:border-white/5 text-center text-slate-500 dark:text-slate-400 text-sm"
        role="contentinfo"
      >
        <p>&copy; 2026 SoroMint Platform. Built on Soroban.</p>
      </footer>
    </div>
  )
}

export function AppRoot(props) {
  return (
    <ErrorBoundary
      context={{ area: 'main-app' }}
      fallbackRender={() => <AppCrashPage />}
    >
      <App {...props} />
    </ErrorBoundary>
  )
}

export default App
