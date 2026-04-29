/**
 * Merkle Tree Helper Script
 * 
 * This script helps generate Merkle trees and proofs for the whitelist contract.
 * Usage: node merkle_helper.js
 */

const crypto = require('crypto');

class MerkleTree {
  constructor(leaves) {
    this.leaves = leaves.map(leaf => this.hash(leaf));
    this.tree = this.buildTree(this.leaves);
  }

  hash(data) {
    return crypto.createHash('sha256').update(data).digest();
  }

  hashPair(a, b) {
    // Sort to make tree order-independent
    const sorted = Buffer.compare(a, b) < 0 ? [a, b] : [b, a];
    return this.hash(Buffer.concat(sorted));
  }

  buildTree(leaves) {
    if (leaves.length === 0) {
      throw new Error('Cannot build tree with no leaves');
    }

    const tree = [leaves];
    let currentLevel = leaves;

    while (currentLevel.length > 1) {
      const nextLevel = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(this.hashPair(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Odd number of nodes, promote the last one
          nextLevel.push(currentLevel[i]);
        }
      }
      
      tree.push(nextLevel);
      currentLevel = nextLevel;
    }

    return tree;
  }

  getRoot() {
    return this.tree[this.tree.length - 1][0];
  }

  getProof(leaf) {
    const leafHash = typeof leaf === 'string' ? this.hash(leaf) : leaf;
    let index = this.leaves.findIndex(l => l.equals(leafHash));
    
    if (index === -1) {
      throw new Error('Leaf not found in tree');
    }

    const proof = [];
    
    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      
      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]);
      }
      
      index = Math.floor(index / 2);
    }

    return proof;
  }

  verify(leaf, proof, root) {
    let hash = typeof leaf === 'string' ? this.hash(leaf) : leaf;
    
    for (const proofElement of proof) {
      hash = this.hashPair(hash, proofElement);
    }
    
    return hash.equals(root);
  }
}

// Example usage
function example() {
  console.log('=== Merkle Whitelist Helper ===\n');

  // Example addresses (in production, load from file or database)
  const addresses = [
    'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'GKLM1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'GNOP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  ];

  console.log(`Building Merkle tree for ${addresses.length} addresses...\n`);

  // Build tree
  const tree = new MerkleTree(addresses);
  const root = tree.getRoot();

  console.log('Merkle Root (hex):');
  console.log(root.toString('hex'));
  console.log('\nMerkle Root (base64):');
  console.log(root.toString('base64'));
  console.log('\n---\n');

  // Generate proofs for each address
  console.log('Proofs for each address:\n');
  
  addresses.forEach((address, index) => {
    const proof = tree.getProof(address);
    const isValid = tree.verify(address, proof, root);
    
    console.log(`Address ${index + 1}: ${address}`);
    console.log(`Proof (${proof.length} elements):`);
    proof.forEach((element, i) => {
      console.log(`  [${i}]: ${element.toString('hex')}`);
    });
    console.log(`Verification: ${isValid ? '✓ Valid' : '✗ Invalid'}`);
    console.log('---\n');
  });

  // Test with invalid address
  console.log('Testing with non-whitelisted address:');
  const invalidAddress = 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  try {
    tree.getProof(invalidAddress);
  } catch (error) {
    console.log(`✓ Correctly rejected: ${error.message}\n`);
  }

  // Statistics
  console.log('=== Statistics ===');
  console.log(`Total addresses: ${addresses.length}`);
  console.log(`Tree depth: ${tree.tree.length - 1}`);
  console.log(`Proof size: ${tree.getProof(addresses[0]).length} elements`);
  console.log(`Root size: 32 bytes`);
  console.log(`\nGas savings vs traditional storage:`);
  console.log(`Traditional: ~${addresses.length * 20000} gas`);
  console.log(`Merkle: ~5000 gas (${((1 - 5000 / (addresses.length * 20000)) * 100).toFixed(2)}% savings)`);
}

// Helper function to load addresses from file
function loadAddressesFromFile(filename) {
  const fs = require('fs');
  const content = fs.readFileSync(filename, 'utf-8');
  return content.split('\n').filter(line => line.trim().length > 0);
}

// Helper function to save proofs to JSON
function saveProofsToFile(addresses, tree, filename) {
  const fs = require('fs');
  const root = tree.getRoot();
  
  const data = {
    root: root.toString('hex'),
    rootBase64: root.toString('base64'),
    addresses: addresses.map(address => ({
      address,
      proof: tree.getProof(address).map(p => p.toString('hex')),
      proofBase64: tree.getProof(address).map(p => p.toString('base64')),
    })),
  };
  
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`Saved proofs to ${filename}`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run example
    example();
  } else if (args[0] === '--file' && args[1]) {
    // Load addresses from file
    const addresses = loadAddressesFromFile(args[1]);
    const tree = new MerkleTree(addresses);
    const outputFile = args[2] || 'merkle_proofs.json';
    saveProofsToFile(addresses, tree, outputFile);
  } else {
    console.log('Usage:');
    console.log('  node merkle_helper.js                    # Run example');
    console.log('  node merkle_helper.js --file <input> [output]  # Generate from file');
  }
}

module.exports = { MerkleTree };
