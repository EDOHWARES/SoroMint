import React, { useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Wallet, Coins, Plus, List, ArrowRight, ShieldCheck } from 'lucide-react';
import { SkeletonList, SkeletonTokenForm } from './components/Skeleton';
import { useWalletStore, useTokenStore } from './store';

const API_BASE = 'http://localhost:5000/api';

function App() {
  const { t } = useTranslation();
  const { address, setWallet, disconnectWallet } = useWalletStore();
  const { tokens, addToken, isLoading, fetchTokens } = useTokenStore();

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7
  });
  const [isMinting, setIsMinting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const connectWallet = async () => {
    const mockAddress = 'GB...' + Math.random().toString(36).substring(7).toUpperCase();
    setWallet(mockAddress);
    toast.success(t('app.walletConnected') || 'Wallet connected');
    fetchTokens(mockAddress);
  };

  const handleMint = async (e) => {
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
        ownerPublicKey: address
      });

      addToken(resp.data);
      setFormData({ name: '', symbol: '', decimals: 7 });
      setStatusMessage('');
      toast.success(t('mint.success') || 'Token minted successfully');
    } catch (err) {
      setStatusMessage('');
      toast.error((t('mint.failed') || 'Minting failed') + ': ' + err.message);
    } finally {
      setIsMinting(false);
    }
  };

  return (
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
          className="flex items-center gap-2 btn-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          aria-label={address ? 'Wallet connected' : 'Connect wallet'}
        >
          <Wallet size={18} aria-hidden="true" />
          <span>
            {address
              ? `${address.substring(0, 6)}...${address.slice(-4)}`
              : 'Connect Wallet'}
          </span>
        </button>
      </header>

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
              <form onSubmit={handleMint} className="space-y-4" aria-describedby="form-description">
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
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
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
                className="flex flex-col items-center justify-center h-64 text-slate-400"
                role="status"
              >
                <p>No tokens minted yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left"
                  role="table"
                  aria-label="User tokens"
                >
                  <thead>
                    <tr className="border-b border-white/10 text-slate-300 text-sm">
                      <th scope="col" className="pb-4 font-medium">Name</th>
                      <th scope="col" className="pb-4 font-medium">Symbol</th>
                      <th scope="col" className="pb-4 font-medium">Contract ID</th>
                      <th scope="col" className="pb-4 font-medium">Decimals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {tokens.map((token, i) => (
                      <tr
                        key={i}
                        className="hover:bg-white/5 transition-colors focus-within:bg-white/10"
                      >
                        <td className="py-4 font-medium">{token.name}</td>
                        <td className="py-4 text-slate-300">{token.symbol}</td>
                        <td className="py-4 font-mono text-sm text-stellar-blue truncate max-w-[120px]">
                          {token.contractId}
                        </td>
                        <td className="py-4 text-slate-300">{token.decimals}</td>
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
        className="mt-16 pt-8 border-t border-white/5 text-center text-slate-400 text-sm"
        role="contentinfo"
      >
        <p>&copy; 2026 SoroMint Platform. Built on Soroban.</p>
      </footer>
    </div>
  );
}

export default App;
