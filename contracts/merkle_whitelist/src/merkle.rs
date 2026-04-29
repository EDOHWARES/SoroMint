use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

/// Verify a Merkle proof for an address
pub fn verify_proof(
    e: &Env,
    address: &Address,
    proof: &Vec<BytesN<32>>,
    root: &BytesN<32>,
) -> bool {
    let leaf = compute_leaf(e, address);
    let computed_root = compute_root(e, &leaf, proof);
    
    // Compare the computed root with the stored root
    computed_root == *root
}

/// Compute the leaf hash for an address
fn compute_leaf(e: &Env, address: &Address) -> BytesN<32> {
    // Create a bytes representation of the address
    let mut data = Bytes::new(e);
    
    // Serialize address to bytes
    let addr_bytes = address.to_string();
    for byte in addr_bytes.as_bytes() {
        data.push(*byte);
    }
    
    // Hash the address to create the leaf
    e.crypto().sha256(&data)
}

/// Compute the Merkle root from a leaf and proof
fn compute_root(e: &Env, leaf: &BytesN<32>, proof: &Vec<BytesN<32>>) -> BytesN<32> {
    let mut current_hash = leaf.clone();

    for i in 0..proof.len() {
        let proof_element = proof.get(i).unwrap();
        current_hash = hash_pair(e, &current_hash, &proof_element);
    }

    current_hash
}

/// Hash two nodes together (order-independent for security)
fn hash_pair(e: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::new(e);
    
    // Sort the hashes to make the tree order-independent
    // This prevents second preimage attacks
    if compare_hashes(a, b) {
        // a < b
        for i in 0..32 {
            data.push(a.get(i).unwrap());
        }
        for i in 0..32 {
            data.push(b.get(i).unwrap());
        }
    } else {
        // b <= a
        for i in 0..32 {
            data.push(b.get(i).unwrap());
        }
        for i in 0..32 {
            data.push(a.get(i).unwrap());
        }
    }
    
    e.crypto().sha256(&data)
}

/// Compare two hashes (returns true if a < b)
fn compare_hashes(a: &BytesN<32>, b: &BytesN<32>) -> bool {
    for i in 0..32 {
        let a_byte = a.get(i).unwrap();
        let b_byte = b.get(i).unwrap();
        
        if a_byte < b_byte {
            return true;
        } else if a_byte > b_byte {
            return false;
        }
    }
    false // Equal
}

/// Helper function to compute Merkle root from a list of leaves (for testing)
#[cfg(test)]
pub fn compute_merkle_root(e: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
    if leaves.len() == 0 {
        panic!("cannot compute root of empty tree");
    }
    
    if leaves.len() == 1 {
        return leaves.get(0).unwrap();
    }
    
    let mut current_level = leaves.clone();
    
    while current_level.len() > 1 {
        let mut next_level = Vec::new(e);
        
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level.get(i).unwrap();
            
            if i + 1 < current_level.len() {
                let right = current_level.get(i + 1).unwrap();
                let parent = hash_pair(e, &left, &right);
                next_level.push_back(parent);
                i += 2;
            } else {
                // Odd number of nodes, promote the last one
                next_level.push_back(left);
                i += 1;
            }
        }
        
        current_level = next_level;
    }
    
    current_level.get(0).unwrap()
}

/// Generate Merkle proof for a leaf at given index (for testing)
#[cfg(test)]
pub fn generate_proof(e: &Env, leaves: &Vec<BytesN<32>>, index: u32) -> Vec<BytesN<32>> {
    let mut proof = Vec::new(e);
    let mut current_level = leaves.clone();
    let mut current_index = index;
    
    while current_level.len() > 1 {
        let mut next_level = Vec::new(e);
        
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level.get(i).unwrap();
            
            if i + 1 < current_level.len() {
                let right = current_level.get(i + 1).unwrap();
                
                // Add sibling to proof if current index is in this pair
                if current_index == i {
                    proof.push_back(right);
                } else if current_index == i + 1 {
                    proof.push_back(left);
                }
                
                let parent = hash_pair(e, &left, &right);
                next_level.push_back(parent);
                i += 2;
            } else {
                next_level.push_back(left);
                i += 1;
            }
        }
        
        current_index = current_index / 2;
        current_level = next_level;
    }
    
    proof
}
