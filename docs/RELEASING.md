# Optional release signing

The release workflow builds Windows x64 and macOS arm64 packages. Without signing credentials it publishes packages without developer certificates. When credentials are configured, signing or verification failures stop publication.

| GitHub Actions secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Windows code-signing PFX supported by the signing provider |
| `WIN_CSC_KEY_PASSWORD` | PFX password |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate and password |
| `APPLE_API_KEY_CONTENT`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key for notarization |

Signed Windows builds verify Authenticode on both the application and the installer. Keep all signing credentials in encrypted secrets. The release includes SHA-256 checksums for all three packages.
