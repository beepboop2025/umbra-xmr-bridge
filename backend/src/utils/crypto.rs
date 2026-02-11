use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/// Generate a bridge order ID: `br_` followed by 12 random hex characters.
///
/// Example: `br_a3f1c9e027b4`
pub fn generate_order_id() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 6] = rng.gen();
    format!("br_{}", hex::encode(bytes))
}

/// Generate a secure random identifier with a caller-supplied prefix followed
/// by 16 random hex characters.
///
/// Example: `sess_8f3a1b2c4d5e6f70`
pub fn generate_secure_id(prefix: &str) -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 8] = rng.gen();
    format!("{prefix}{}", hex::encode(bytes))
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/// Compute the SHA-256 hex digest of the supplied content.
pub fn hash_content(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Password hashing (Argon2id)
// ---------------------------------------------------------------------------

/// Hash a password using Argon2id with a random salt.
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("Failed to hash password: {e}"))?;
    Ok(hash.to_string())
}

/// Verify a password against an Argon2id hash string.
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed =
        PasswordHash::new(hash).map_err(|e| anyhow!("Invalid password hash format: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

/// Claims embedded in every JWT issued by the bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtClaims {
    /// Subject — typically the user ID.
    pub sub: String,
    /// Role string (e.g. "admin", "viewer").
    pub role: String,
    /// Expiration as a Unix timestamp (seconds since epoch).
    pub exp: usize,
}

/// Create a signed JWT containing the given user ID and role.
///
/// `expiry_hours` controls the token lifetime.
pub fn create_jwt(user_id: &str, role: &str, secret: &str, expiry_hours: u64) -> Result<String> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(expiry_hours as i64))
        .ok_or_else(|| anyhow!("Timestamp overflow computing JWT expiry"))?
        .timestamp() as usize;

    let claims = JwtClaims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;

    Ok(token)
}

/// Verify a JWT and return its claims.
pub fn verify_jwt(token: &str, secret: &str) -> Result<JwtClaims> {
    let data = decode::<JwtClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_id_format() {
        let id = generate_order_id();
        assert!(id.starts_with("br_"));
        assert_eq!(id.len(), 3 + 12); // "br_" + 12 hex chars
    }

    #[test]
    fn secure_id_format() {
        let id = generate_secure_id("sess_");
        assert!(id.starts_with("sess_"));
        assert_eq!(id.len(), 5 + 16); // "sess_" + 16 hex chars
    }

    #[test]
    fn sha256_deterministic() {
        let h1 = hash_content("hello");
        let h2 = hash_content("hello");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // 32 bytes hex
    }

    #[test]
    fn password_roundtrip() {
        let hash = hash_password("s3cret!").unwrap();
        assert!(verify_password("s3cret!", &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
    }

    #[test]
    fn jwt_roundtrip() {
        let secret = "test-secret-key-at-least-32-bytes-long!!";
        let token = create_jwt("user_123", "admin", secret, 1).unwrap();
        let claims = verify_jwt(&token, secret).unwrap();
        assert_eq!(claims.sub, "user_123");
        assert_eq!(claims.role, "admin");
    }
}
