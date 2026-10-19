//! Keyring-only administrator credential vault with no debug file fallback.
//!
//! One credential-store item per exact account, workspace, and shared database. The
//! item holds the administrator username, password, and device-local SSH alias as one
//! JSON value that is read into zeroizing memory for a single action.

use keyring::Entry;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

use super::super::ports::AdminCredentialVault;
use super::super::types::{AdminCredential, DirectScope};

#[cfg(feature = "packaged-benchmark")]
const SERVICE: &str = "dev.dopedb.desktop.benchmark";
#[cfg(all(debug_assertions, not(feature = "packaged-benchmark")))]
const SERVICE: &str = "dev.dopedb.desktop.dev";
#[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
const SERVICE: &str = "dev.dopedb.desktop";

#[derive(Clone, Copy, Default)]
pub(crate) struct KeyringAdminCredentialVault;

impl KeyringAdminCredentialVault {
    fn entry(scope: &DirectScope) -> AppResult<Entry> {
        Entry::new(SERVICE, &scope.vault_account()).map_err(AppError::from)
    }
}

impl AdminCredentialVault for KeyringAdminCredentialVault {
    fn store(&self, scope: &DirectScope, credential: &AdminCredential) -> AppResult<()> {
        let json = credential.to_vault_json()?;
        Self::entry(scope)?.set_password(json.as_str())?;
        Ok(())
    }

    fn fetch(&self, scope: &DirectScope) -> AppResult<Option<AdminCredential>> {
        match Self::entry(scope)?.get_password() {
            Ok(value) => AdminCredential::from_vault_json(&Zeroizing::new(value)).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn contains(&self, scope: &DirectScope) -> AppResult<bool> {
        match Self::entry(scope)?.get_password() {
            Ok(value) => {
                drop(Zeroizing::new(value));
                Ok(true)
            }
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    fn delete(&self, scope: &DirectScope) -> AppResult<()> {
        match Self::entry(scope)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}
