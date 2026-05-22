import Link from "next/link";
import { Wallet, Menu } from "lucide-react";

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-white font-bold text-xl">S</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-white">SoroMint</span>
        </Link>
        
        <div className="hidden md:flex items-center gap-8">
          <Link href="/" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
            Home
          </Link>
          <Link href="/dashboard" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/docs" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
            Documentation
          </Link>
        </div>
        
        <div className="flex items-center gap-4">
          <button className="hidden md:flex items-center gap-2 bg-white/10 hover:bg-white/20 transition-colors border border-white/10 px-4 py-2 rounded-full text-sm font-medium text-white">
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
          <button className="md:hidden text-gray-300 hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>
    </nav>
  );
}
