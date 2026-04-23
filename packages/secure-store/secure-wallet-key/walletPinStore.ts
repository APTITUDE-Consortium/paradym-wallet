import { Platform } from 'react-native'
import * as Keychain from 'react-native-keychain'
import {
  getKeychainItemById,
  hasKeychainItemById,
  type KeychainAuthenticationTypeOptions,
  type KeychainSetOptions,
  removeKeychainItemById,
  storeKeychainItem,
} from '../keychain'

const walletPinStoreBaseOptions: KeychainSetOptions & KeychainAuthenticationTypeOptions = {
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
  accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  authenticationPrompt: {
    title: 'Unlock wallet',
    description: 'Access to your wallet PIN is locked behind a biometric verification.',
  },
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
  storage: Keychain.STORAGE_TYPE.RSA,
  authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
}

const WALLET_PIN_ID = (version: number) => `PARADYM_WALLET_PIN_${version}`

async function storeWalletPin(pin: string, version: number): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return

  await storeKeychainItem(WALLET_PIN_ID(version), pin, walletPinStoreBaseOptions)
}

async function getWalletPinUsingBiometrics(version: number): Promise<string | null> {
  return await getKeychainItemById(WALLET_PIN_ID(version), walletPinStoreBaseOptions)
}

async function hasWalletPin(version: number): Promise<boolean> {
  return await hasKeychainItemById(WALLET_PIN_ID(version))
}

async function removeWalletPin(version: number): Promise<boolean> {
  return await removeKeychainItemById(WALLET_PIN_ID(version), walletPinStoreBaseOptions)
}

export const walletPinStore = {
  storeWalletPin,
  getWalletPinUsingBiometrics,
  hasWalletPin,
  removeWalletPin,
}
