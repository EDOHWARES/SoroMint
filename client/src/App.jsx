import { useState } from 'react';
import axios from 'axios';
import { Wallet, Coins, Plus, List, ArrowRight, ShieldCheck } from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

function App() {
  const [address, setAddress] = useState('');
  const [tokens, setTokens] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7
  });
  const [isMinting, setIsMinting] = useState(false);

  // Placeholder for Wallet Connection (Freighter/Albedo)
  const connectWallet = async () => {
    // In a real app, use @stellar/freighter-api
    const mockAddress = 'GB...' + Math.random().toString(36).substring(7).toUpperCase();
    setAddress(mockAddress);
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
    }
  };

  const handleMint = async (e) => {
    e.preventDefault();
    if (!address) return alert('Connect wallet first');
    
    setIsMinting(true);
    try {
      // Logic for Minting:
      // 1. Sign transaction on client (Freighter)
      // 2. Submit to Soroban RPC
      // 3. Save metadata to server
      const mockContractId = 'C' + Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const resp = await axios.post(`${API_BASE}/tokens`, {
        ...formData,
        contractId: mockContractId,
        ownerPublicKey: address
      });

      const createdToken = resp.data?.data ?? resp.data;

      if (createdToken) {
        setTokens((currentTokens) => [...currentTokens, createdToken]);
      }
      setFormData({ name: '', symbol: '', decimals: 7 });
      alert('Token Minted Successfully!');
    } catch (err) {
      alert('Minting failed: ' + err.message);
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <header className="flex justify-between items-center mb-16">
        <div className="flex items-center gap-3">
          <div className="bg-stellar-blue p-2 rounded-xl">
            <Coins className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Soro<span className="text-stellar-blue">Mint</span></h1>
        </div>
        
        <button 
          onClick={connectWallet}
          className="flex items-center gap-2 btn-primary"
        >
          <Wallet size={18} />
          {address ? `${address.substring(0, 6)}...${address.slice(-4)}` : 'Connect Wallet'}
        </button>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Mint Form */}
        <section className="lg:col-span-1">
          <div className="glass-card">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <Plus size={20} className="text-stellar-blue" />
              Mint New Token
            </h2>
            <form onSubmit={handleMint} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Token Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. My Stellar Asset"
                  className="w-full input-field"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Symbol</label>
                <input 
                  type="text" 
                  placeholder="e.g. MSA"
                  className="w-full input-field"
                  value={formData.symbol}
                  onChange={(e) => setFormData({...formData, symbol: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Decimals</label>
                <input 
                  type="number" 
                  className="w-full input-field"
                  value={formData.decimals}
                  onChange={(e) => setFormData({...formData, decimals: parseInt(e.target.value, 10) || 0})}
                  required
                />
              </div>
              <button 
                type="submit" 
                disabled={isMinting}
                className="w-full btn-primary mt-4 flex justify-center items-center gap-2"
              >
                {isMinting ? 'Deploying...' : 'Mint Token'}
                {!isMinting && <ArrowRight size={18} />}
              </button>
            </form>
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
            
            {!address ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <ShieldCheck size={48} className="mb-4 opacity-20" />
                <p>Connect your wallet to see your assets</p>
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
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
              </div>
            )}
          </div>
        </section>
      </main>
      
      <footer className="mt-16 pt-8 border-t border-white/5 text-center text-slate-500 text-sm">
        <p>&copy; 2026 SoroMint Platform. Built on Soroban.</p>
      </footer>
    </div>
  );
}

export default App;
