import React, { useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Wallet, Coins, Plus, List, ArrowRight, ShieldCheck } from 'lucide-react';
import SEO from './components/SEO';
import LanguageSelector from './components/LanguageSelector';

const API_BASE = 'http://localhost:5000/api';

function App() {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [tokens, setTokens] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 7
  });
  const [isMinting, setIsMinting] = useState(false);

  const connectWallet = async () => {
    const mockAddress = 'GB...' + Math.random().toString(36).substring(7).toUpperCase();
    setAddress(mockAddress);
    fetchTokens(mockAddress);
  };

  const fetchTokens = async (userAddress) => {
    try {
      const resp = await axios.get(`${API_BASE}/tokens/${userAddress}`);
      setTokens(resp.data);
    } catch (err) {
      console.error('Error fetching tokens', err);
    }
  };

  const handleMint = async (e) => {
    e.preventDefault();
    if (!address) return alert(t('mint.connectFirst'));
    
    setIsMinting(true);
    try {
      const mockContractId = 'C' + Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const resp = await axios.post(`${API_BASE}/tokens`, {
        ...formData,
        contractId: mockContractId,
        ownerPublicKey: address
      });

      setTokens([...tokens, resp.data]);
      setFormData({ name: '', symbol: '', decimals: 7 });
      alert(t('mint.success'));
    } catch (err) {
      alert(t('mint.failed') + ': ' + err.message);
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <SEO title={t('app.tagline')} description={t('app.tagline')} />
      <header className="flex justify-between items-center mb-16">
        <div className="flex items-center gap-3">
          <div className="bg-stellar-blue p-2 rounded-xl">
            <Coins className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Soro<span className="text-stellar-blue">Mint</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <LanguageSelector />
          <button 
            onClick={connectWallet}
            className="flex items-center gap-2 btn-primary"
          >
            <Wallet size={18} />
            {address ? `${address.substring(0, 6)}...${address.slice(-4)}` : t('app.connectWallet')}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-1">
          <div className="glass-card">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <Plus size={20} className="text-stellar-blue" />
              {t('mint.title')}
            </h2>
            <form onSubmit={handleMint} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('mint.tokenName')}</label>
                <input 
                  type="text" 
                  placeholder={t('mint.tokenNamePlaceholder')}
                  className="w-full input-field"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('mint.symbol')}</label>
                <input 
                  type="text" 
                  placeholder={t('mint.symbolPlaceholder')}
                  className="w-full input-field"
                  value={formData.symbol}
                  onChange={(e) => setFormData({...formData, symbol: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('mint.decimals')}</label>
                <input 
                  type="number" 
                  className="w-full input-field"
                  value={formData.decimals}
                  onChange={(e) => setFormData({...formData, decimals: parseInt(e.target.value)})}
                  required
                />
              </div>
              <button 
                type="submit" 
                disabled={isMinting}
                className="w-full btn-primary mt-4 flex justify-center items-center gap-2"
              >
                {isMinting ? t('mint.deploying') : t('mint.submit')}
                {!isMinting && <ArrowRight size={18} />}
              </button>
            </form>
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="glass-card min-h-[400px]">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <List size={20} className="text-stellar-blue" />
              {t('assets.title')}
            </h2>
            
            {!address ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <ShieldCheck size={48} className="mb-4 opacity-20" />
                <p>{t('assets.connectPrompt')}</p>
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <p>{t('assets.empty')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="pb-4 font-medium">{t('assets.name')}</th>
                      <th className="pb-4 font-medium">{t('assets.symbol')}</th>
                      <th className="pb-4 font-medium">{t('assets.contractId')}</th>
                      <th className="pb-4 font-medium">{t('assets.decimals')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {tokens.map((token, i) => (
                      <tr key={i} className="hover:bg-white/5 transition-colors group">
                        <td className="py-4 font-medium">{token.name}</td>
                        <td className="py-4 text-slate-300">{token.symbol}</td>
                        <td className="py-4 font-mono text-sm text-stellar-blue truncate max-w-[120px]">
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
      
      <footer className="mt-16 pt-8 border-t border-white/5 text-center text-slate-500 text-sm">
        <p>&copy; 2026 {t('app.footer')}</p>
      </footer>
    </div>
  );
}

export default App;
