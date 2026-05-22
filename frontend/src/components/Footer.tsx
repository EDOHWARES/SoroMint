import Link from "next/link";
import { Code, MessageCircle, Terminal } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black/20 mt-20">
      <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <span className="text-lg font-bold tracking-tight text-white">SoroMint</span>
            </Link>
            <p className="text-gray-400 text-sm max-w-sm mb-6">
              The premier platform for minting and managing digital assets on the Stellar blockchain, powered by Soroban smart contracts.
            </p>
            <div className="flex items-center gap-4 text-gray-400">
              <a href="#" className="hover:text-white transition-colors"><Code className="w-5 h-5" /></a>
              <a href="#" className="hover:text-white transition-colors"><MessageCircle className="w-5 h-5" /></a>
              <a href="#" className="hover:text-white transition-colors"><Terminal className="w-5 h-5" /></a>
            </div>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">Platform</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><Link href="/dashboard" className="hover:text-blue-400 transition-colors">Dashboard</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">Explorer</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">Collections</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">Stats</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><Link href="/docs" className="hover:text-blue-400 transition-colors">Documentation</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">Smart Contracts</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">API/SDK</Link></li>
              <li><Link href="#" className="hover:text-blue-400 transition-colors">Stellar Ecosystem</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between text-xs text-gray-500">
          <p>© {new Date().getFullYear()} SoroMint Protocol. All rights reserved.</p>
          <div className="flex items-center gap-4 mt-4 md:mt-0">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
