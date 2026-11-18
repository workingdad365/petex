# Optional release signing

The release workflow builds a Windows x64 installer. Without signing credentials it publishes an unsigned installer. When credentials are configured, signing or verification failures stop publication.

| GitHub Actions secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Windows code-signing PFX supported by the signing provider |
| `WIN_CSC_KEY_PASSWORD` | PFX password |

Signed Windows builds verify Authenticode on both the application and the installer. Keep all signing credentials in encrypted secrets. The release also includes a SHA-256 checksum for the installer.
