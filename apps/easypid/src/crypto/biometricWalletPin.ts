import { secureWalletKey } from '@package/secure-store/secureUnlock'

export async function storeWalletPinForBiometricsIfAvailable(pin: string) {
  const walletKeyVersion = secureWalletKey.getWalletKeyVersion()
  const biometricUnlockState = await secureWalletKey.getBiometricUnlockState(walletKeyVersion).catch(() => null)

  if (biometricUnlockState?.canUnlockNow !== true) return

  await secureWalletKey.storeWalletPin(pin, walletKeyVersion).catch(() => undefined)
}
