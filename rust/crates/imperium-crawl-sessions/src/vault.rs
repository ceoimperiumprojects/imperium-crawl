//! AES-256-GCM session vault with Argon2id-derived key.
//!
//! Storage format produced by [`Vault::encrypt`] is:
//!
//! ```text
//!   [ nonce (12 bytes) || ciphertext || gcm auth tag (16 bytes) ]
//! ```
//!
//! The salt used for the Argon2id key derivation is **not** stored inside
//! [`Vault::encrypt`] output. The [`crate::SessionManager`] is responsible for
//! prepending the 16-byte salt when persisting an encrypted session to disk,
//! producing the on-disk layout:
//!
//! ```text
//!   [ salt (16 bytes) || nonce (12 bytes) || ciphertext || tag (16 bytes) ]
//! ```
//!
//! This keeps [`Vault`] a pure crypto primitive (key + encrypt/decrypt) and
//! lets the manager own the file format. To reconstruct a vault for an
//! existing encrypted blob, use [`Vault::from_password_with_salt`] with the
//! salt read from the first 16 bytes of the blob.
//!
//! Key derivation uses Argon2id with the OWASP-recommended defaults:
//!
//! - `m_cost` = 19 456 KiB (19 MiB)
//! - `t_cost` = 2 iterations
//! - `p_cost` = 1 lane
//! - output length: 32 bytes
//!
//! These are exposed via `argon2::Params::DEFAULT` so we just call
//! `Argon2::default()` to get the matching context.

use aes_gcm::aead::{Aead, AeadCore, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use imperium_crawl_core::{CrawlError, Result};
use rand::RngCore;

/// Length of the Argon2id salt in bytes.
pub const SALT_LEN: usize = 16;
/// Length of the AES-256-GCM nonce in bytes (96-bit, per RFC 5116).
pub const NONCE_LEN: usize = 12;
/// Length of the AES-256-GCM authentication tag in bytes.
pub const TAG_LEN: usize = 16;
/// Length of the derived AES-256 key in bytes.
pub const KEY_LEN: usize = 32;

/// Symmetric vault wrapping an AES-256-GCM cipher with an Argon2id-derived key.
///
/// Drop it like any other struct — the derived key lives only in this
/// instance's memory and is zeroized by `aes-gcm` internals on drop.
pub struct Vault {
    cipher: Aes256Gcm,
    salt: [u8; SALT_LEN],
}

impl Vault {
    /// Generate a fresh random salt and derive a key from `password`.
    ///
    /// Use this when creating a new encrypted session. The salt is exposed via
    /// [`Vault::salt`] so the caller can persist it alongside the ciphertext.
    pub fn from_password(password: &str) -> Result<Self> {
        let mut salt = [0u8; SALT_LEN];
        rand::thread_rng().fill_bytes(&mut salt);
        Self::from_password_with_salt(password, &salt)
    }

    /// Re-derive a vault key from `password` using an existing `salt`.
    ///
    /// Use this when decrypting a previously-saved session — read the salt
    /// from the first [`SALT_LEN`] bytes of the on-disk blob and pass it in.
    pub fn from_password_with_salt(password: &str, salt: &[u8]) -> Result<Self> {
        if salt.len() != SALT_LEN {
            return Err(CrawlError::Encryption(format!(
                "salt must be {SALT_LEN} bytes, got {}",
                salt.len()
            )));
        }
        let mut salt_buf = [0u8; SALT_LEN];
        salt_buf.copy_from_slice(salt);

        let argon2 = Argon2::default();
        let mut key_bytes = [0u8; KEY_LEN];
        argon2
            .hash_password_into(password.as_bytes(), &salt_buf, &mut key_bytes)
            .map_err(|e| CrawlError::Encryption(format!("argon2 key derivation failed: {e}")))?;

        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);
        Ok(Self { cipher, salt: salt_buf })
    }

    /// Return the salt that was used for Argon2id key derivation.
    pub fn salt(&self) -> &[u8; SALT_LEN] {
        &self.salt
    }

    /// Encrypt `plaintext`. Output layout: `[nonce(12) || ciphertext || tag(16)]`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let nonce = Aes256Gcm::generate_nonce(&mut rand::thread_rng());
        let ct = self
            .cipher
            .encrypt(&nonce, plaintext)
            .map_err(|e| CrawlError::Encryption(format!("aes-gcm encrypt failed: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(nonce.as_slice());
        out.extend_from_slice(&ct);
        Ok(out)
    }

    /// Decrypt a blob produced by [`Vault::encrypt`].
    pub fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        if ciphertext.len() < NONCE_LEN + TAG_LEN {
            return Err(CrawlError::Encryption(format!(
                "ciphertext too short: {} bytes (need >= {})",
                ciphertext.len(),
                NONCE_LEN + TAG_LEN
            )));
        }
        let (nonce_bytes, ct) = ciphertext.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher
            .decrypt(nonce, ct)
            .map_err(|e| CrawlError::Encryption(format!("aes-gcm decrypt failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let vault = Vault::from_password("correct horse battery staple").unwrap();
        let pt = b"hello session";
        let ct = vault.encrypt(pt).unwrap();
        // Nonce + tag overhead.
        assert!(ct.len() >= NONCE_LEN + TAG_LEN);
        let back = vault.decrypt(&ct).unwrap();
        assert_eq!(back, pt);
    }

    #[test]
    fn encrypt_uses_random_nonce() {
        // Same vault, same plaintext, different output — proves nonce is random.
        let vault = Vault::from_password("pw").unwrap();
        let pt = b"deterministic input";
        let a = vault.encrypt(pt).unwrap();
        let b = vault.encrypt(pt).unwrap();
        assert_ne!(a, b, "nonce randomness should make ciphertexts differ");
    }

    #[test]
    fn decrypt_wrong_password_fails() {
        // To decrypt with a wrong password we need the original salt, otherwise
        // we'd derive a totally different key and the test would be trivial.
        let good = Vault::from_password("right").unwrap();
        let salt = *good.salt();
        let ct = good.encrypt(b"secret").unwrap();
        let bad = Vault::from_password_with_salt("wrong", &salt).unwrap();
        let err = bad.decrypt(&ct).unwrap_err();
        match err {
            CrawlError::Encryption(_) => {}
            other => panic!("expected Encryption error, got {other:?}"),
        }
    }

    #[test]
    fn tamper_ciphertext_fails() {
        let vault = Vault::from_password("pw").unwrap();
        let mut ct = vault.encrypt(b"do not flip me").unwrap();
        // Flip a byte in the middle of the ciphertext body (skip the nonce).
        let target = NONCE_LEN + 1;
        ct[target] ^= 0x01;
        let err = vault.decrypt(&ct).unwrap_err();
        match err {
            CrawlError::Encryption(_) => {}
            other => panic!("expected Encryption error from GCM auth, got {other:?}"),
        }
    }

    #[test]
    fn decrypt_short_input_fails() {
        let vault = Vault::from_password("pw").unwrap();
        // Strictly less than nonce + tag — must not panic.
        let err = vault.decrypt(&[0u8; NONCE_LEN]).unwrap_err();
        assert!(matches!(err, CrawlError::Encryption(_)));
    }
}
