import { agentDependencies } from '@credo-ts/react-native'
import type { ParadymWalletSdk } from '../ParadymWalletSdk'
import { secureWalletKey } from '../secure'

export const reset = async (paradym?: ParadymWalletSdk) => {
  paradym?.logger.debug('Resetting wallet')

  await paradym?.agent.shutdown()

  const fs = new agentDependencies.FileSystem()

  // Clear cach and temp path
  if (await fs.exists(fs.cachePath)) await fs.delete(fs.cachePath)
  if (await fs.exists(fs.tempPath)) await fs.delete(fs.tempPath)

  // Remove both the salt and the biometric-protected wallet key so a fresh onboarding
  // flow does not reuse a stale encrypted store with a new derived key.
  await secureWalletKey.removeWalletKey(secureWalletKey.getWalletKeyVersion())
  await secureWalletKey.removeSalt(secureWalletKey.getWalletKeyVersion())

  const walletRootDirectory = `${fs.dataPath}/.afj/wallet`
  const walletDirectory = paradym ? `${walletRootDirectory}/${paradym.walletId}` : walletRootDirectory

  const walletDirectoryExists = await fs.exists(walletDirectory)
  if (walletDirectoryExists) {
    paradym?.logger.debug('wallet directory exists, deleting...')
    await fs.delete(walletDirectory)
    paradym?.logger.debug('wallet directory deleted')
  } else {
    paradym?.logger.debug('wallet directory does not exist')
  }
}
