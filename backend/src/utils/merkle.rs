//! RFC 6962 / RFC 9162 Merkle tree (the Certificate Transparency construction).
//!
//! Used by the transparency log to seal the audit hash-chain into signed
//! checkpoints. Domain separation prevents second-preimage attacks:
//!
//!   leaf hash:  SHA-256(0x00 || data)
//!   node hash:  SHA-256(0x01 || left || right)
//!
//! Inclusion proofs let anyone verify that a specific audit entry is committed
//! to by a checkpoint. Consistency proofs let anyone verify that a newer
//! checkpoint is an append-only extension of an older one — i.e. history was
//! never rewritten.

use sha2::{Digest, Sha256};

pub type Hash = [u8; 32];

const LEAF_PREFIX: u8 = 0x00;
const NODE_PREFIX: u8 = 0x01;

pub fn leaf_hash(data: &[u8]) -> Hash {
    let mut h = Sha256::new();
    h.update([LEAF_PREFIX]);
    h.update(data);
    h.finalize().into()
}

pub fn node_hash(left: &Hash, right: &Hash) -> Hash {
    let mut h = Sha256::new();
    h.update([NODE_PREFIX]);
    h.update(left);
    h.update(right);
    h.finalize().into()
}

/// Merkle tree head over `leaves[lo..hi)` (already leaf-hashed).
fn subtree_root(leaves: &[Hash]) -> Hash {
    match leaves.len() {
        0 => Sha256::digest([]).into(), // MTH({}) per RFC 6962
        1 => leaves[0],
        n => {
            let k = largest_power_of_two_below(n);
            node_hash(&subtree_root(&leaves[..k]), &subtree_root(&leaves[k..]))
        }
    }
}

/// Root hash over raw leaf data.
pub fn root(leaves: &[Vec<u8>]) -> Hash {
    let hashed: Vec<Hash> = leaves.iter().map(|l| leaf_hash(l)).collect();
    subtree_root(&hashed)
}

/// Largest power of two strictly less than `n` (n >= 2).
fn largest_power_of_two_below(n: usize) -> usize {
    debug_assert!(n >= 2);
    let mut k = 1;
    while k * 2 < n {
        k *= 2;
    }
    k
}

/// Audit path for `leaves[index]` per RFC 6962 §2.1.1.
/// Returned hashes are ordered from the leaf level toward the root.
pub fn inclusion_proof(leaves: &[Vec<u8>], index: usize) -> Option<Vec<Hash>> {
    if index >= leaves.len() {
        return None;
    }
    let hashed: Vec<Hash> = leaves.iter().map(|l| leaf_hash(l)).collect();
    Some(path(&hashed, index))
}

fn path(leaves: &[Hash], m: usize) -> Vec<Hash> {
    let n = leaves.len();
    if n <= 1 {
        return Vec::new();
    }
    let k = largest_power_of_two_below(n);
    let mut p;
    if m < k {
        p = path(&leaves[..k], m);
        p.push(subtree_root(&leaves[k..]));
    } else {
        p = path(&leaves[k..], m - k);
        p.push(subtree_root(&leaves[..k]));
    }
    p
}

/// Verify an inclusion proof per RFC 9162 §2.1.3.2.
pub fn verify_inclusion(
    leaf: &Hash,
    index: u64,
    tree_size: u64,
    proof: &[Hash],
    expected_root: &Hash,
) -> bool {
    if index >= tree_size {
        return false;
    }
    let mut fn_ = index;
    let mut sn = tree_size - 1;
    let mut r = *leaf;

    for p in proof {
        if sn == 0 {
            return false;
        }
        if fn_ & 1 == 1 || fn_ == sn {
            r = node_hash(p, &r);
            if fn_ & 1 == 0 {
                while fn_ & 1 == 0 && fn_ != 0 {
                    fn_ >>= 1;
                    sn >>= 1;
                }
            }
        } else {
            r = node_hash(&r, p);
        }
        fn_ >>= 1;
        sn >>= 1;
    }

    sn == 0 && r == *expected_root
}

/// Consistency proof between the tree over `leaves[..old_size]` and the tree
/// over all of `leaves`, per RFC 6962 §2.1.2.
pub fn consistency_proof(leaves: &[Vec<u8>], old_size: usize) -> Option<Vec<Hash>> {
    let n = leaves.len();
    if old_size == 0 || old_size > n {
        return None;
    }
    if old_size == n {
        return Some(Vec::new());
    }
    let hashed: Vec<Hash> = leaves.iter().map(|l| leaf_hash(l)).collect();
    Some(subproof(&hashed, old_size, true))
}

fn subproof(leaves: &[Hash], m: usize, complete: bool) -> Vec<Hash> {
    let n = leaves.len();
    if m == n {
        return if complete {
            Vec::new()
        } else {
            vec![subtree_root(leaves)]
        };
    }
    let k = largest_power_of_two_below(n);
    let mut p;
    if m <= k {
        p = subproof(&leaves[..k], m, complete);
        p.push(subtree_root(&leaves[k..]));
    } else {
        p = subproof(&leaves[k..], m - k, false);
        p.push(subtree_root(&leaves[..k]));
    }
    p
}

/// Verify a consistency proof per RFC 9162 §2.1.4.2.
pub fn verify_consistency(
    old_size: u64,
    new_size: u64,
    old_root: &Hash,
    new_root: &Hash,
    proof: &[Hash],
) -> bool {
    if old_size == 0 || old_size > new_size {
        return false;
    }
    if old_size == new_size {
        return proof.is_empty() && old_root == new_root;
    }
    if proof.is_empty() {
        return false;
    }

    let mut fn_ = old_size - 1;
    let mut sn = new_size - 1;
    while fn_ & 1 == 1 {
        fn_ >>= 1;
        sn >>= 1;
    }

    let mut iter = proof.iter();
    let (mut fr, mut sr) = if fn_ == 0 {
        (*old_root, *old_root)
    } else {
        let first = match iter.next() {
            Some(h) => *h,
            None => return false,
        };
        (first, first)
    };

    for c in iter {
        if sn == 0 {
            return false;
        }
        if fn_ & 1 == 1 || fn_ == sn {
            fr = node_hash(c, &fr);
            sr = node_hash(c, &sr);
            if fn_ & 1 == 0 {
                while fn_ & 1 == 0 && fn_ != 0 {
                    fn_ >>= 1;
                    sn >>= 1;
                }
            }
        } else {
            sr = node_hash(&sr, c);
        }
        fn_ >>= 1;
        sn >>= 1;
    }

    sn == 0 && fr == *old_root && sr == *new_root
}

pub fn hash_to_hex(h: &Hash) -> String {
    hex::encode(h)
}

pub fn hex_to_hash(s: &str) -> Option<Hash> {
    let bytes = hex::decode(s).ok()?;
    bytes.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_leaves(n: usize) -> Vec<Vec<u8>> {
        (0..n).map(|i| format!("leaf-{i}").into_bytes()).collect()
    }

    #[test]
    fn empty_tree_root_matches_rfc() {
        // MTH({}) = SHA-256 of the empty string.
        assert_eq!(
            hash_to_hex(&root(&[])),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn rfc6962_known_answer_vectors() {
        // Test vectors from the certificate-transparency reference implementation.
        let inputs: Vec<Vec<u8>> = vec![
            vec![],
            vec![0x00],
            vec![0x10],
            vec![0x20, 0x21],
            vec![0x30, 0x31],
            vec![0x40, 0x41, 0x42, 0x43],
            vec![0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57],
            vec![
                0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c,
                0x6d, 0x6e, 0x6f,
            ],
        ];
        let expected_roots = [
            "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
            "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
            "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
            "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
            "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
            "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
            "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
            "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
        ];
        for n in 1..=inputs.len() {
            assert_eq!(
                hash_to_hex(&root(&inputs[..n])),
                expected_roots[n - 1],
                "root mismatch at tree size {n}"
            );
        }
    }

    #[test]
    fn inclusion_proofs_verify_for_all_leaves_and_sizes() {
        for n in 1..=64usize {
            let leaves = make_leaves(n);
            let r = root(&leaves);
            for i in 0..n {
                let proof = inclusion_proof(&leaves, i).unwrap();
                let lh = leaf_hash(&leaves[i]);
                assert!(
                    verify_inclusion(&lh, i as u64, n as u64, &proof, &r),
                    "inclusion failed for leaf {i} of {n}"
                );
            }
        }
    }

    #[test]
    fn inclusion_proof_rejects_tampering() {
        let leaves = make_leaves(16);
        let r = root(&leaves);
        let proof = inclusion_proof(&leaves, 5).unwrap();
        let good = leaf_hash(&leaves[5]);

        // Wrong leaf content
        let evil = leaf_hash(b"leaf-99");
        assert!(!verify_inclusion(&evil, 5, 16, &proof, &r));
        // Wrong index
        assert!(!verify_inclusion(&good, 6, 16, &proof, &r));
        // Wrong tree size. (Note: RFC 9162 verification binds to the root; a
        // size lie only fails when it changes the fold shape, as 8 does here.
        // Real verifiers always take (size, root) together from a signed
        // checkpoint, so the root is the binding anchor.)
        assert!(!verify_inclusion(&good, 5, 8, &proof, &r));
        // Truncated proof
        assert!(!verify_inclusion(&good, 5, 16, &proof[..proof.len() - 1], &r));
        // Wrong root
        let bad_root = leaf_hash(b"nope");
        assert!(!verify_inclusion(&good, 5, 16, &proof, &bad_root));
        // Index out of range
        assert!(!verify_inclusion(&good, 16, 16, &proof, &r));
    }

    #[test]
    fn consistency_proofs_verify_for_all_size_pairs() {
        let max = 32usize;
        let leaves = make_leaves(max);
        for old in 1..=max {
            let old_root = root(&leaves[..old]);
            for new in old..=max {
                let new_root = root(&leaves[..new]);
                let proof = consistency_proof(&leaves[..new], old).unwrap();
                assert!(
                    verify_consistency(old as u64, new as u64, &old_root, &new_root, &proof),
                    "consistency failed for {old} -> {new}"
                );
            }
        }
    }

    #[test]
    fn consistency_proof_rejects_history_rewrite() {
        let mut leaves = make_leaves(20);
        let old_root = root(&leaves[..10]);

        // Rewrite an entry inside the old prefix, then extend.
        leaves[3] = b"rewritten".to_vec();
        let forged_new_root = root(&leaves);
        let forged_proof = consistency_proof(&leaves, 10).unwrap();

        assert!(
            !verify_consistency(10, 20, &old_root, &forged_new_root, &forged_proof),
            "a rewritten history must not verify as consistent"
        );
    }

    #[test]
    fn consistency_equal_sizes_requires_equal_roots_and_empty_proof() {
        let leaves = make_leaves(7);
        let r = root(&leaves);
        assert!(verify_consistency(7, 7, &r, &r, &[]));
        let other = root(&make_leaves(6));
        assert!(!verify_consistency(7, 7, &other, &r, &[]));
        assert!(!verify_consistency(7, 7, &r, &r, &[leaf_hash(b"x")]));
    }

    #[test]
    fn hex_round_trip() {
        let h = leaf_hash(b"hello");
        assert_eq!(hex_to_hash(&hash_to_hex(&h)), Some(h));
        assert_eq!(hex_to_hash("zz"), None);
        assert_eq!(hex_to_hash("abcd"), None); // wrong length
    }
}
