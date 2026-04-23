import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type PropsWithChildren, useContext, useState } from 'react'
import {
  BiometricAuthenticationCancelledError,
  BiometricAuthenticationError,
  BiometricAuthenticationNotEnabledError,
} from '../../agent/src'
import { getBiometricUnlockStateQueryKey, secureWalletKey } from './secureWalletKey'

const SecureUnlockContext = createContext<SecureUnlockReturn<Record<string, unknown>>>({
  state: 'initializing',
})

export function useSecureUnlock<Context extends Record<string, unknown>>(): SecureUnlockReturn<Context> {
  const value = useContext(SecureUnlockContext)
  if (!value) {
    throw new Error('useSecureUnlock must be wrapped in a <SecureUnlockProvider />')
  }

  return value as SecureUnlockReturn<Context>
}

export function SecureUnlockProvider({ children }: PropsWithChildren) {
  const secureUnlockState = _useSecureUnlockState()

  return (
    <SecureUnlockContext.Provider value={secureUnlockState as SecureUnlockReturn<Record<string, unknown>>}>
      {children}
    </SecureUnlockContext.Provider>
  )
}

export type SecureUnlockState = 'initializing' | 'not-configured' | 'locked' | 'acquired-wallet-key' | 'unlocked'
export type SecureUnlockMethod = 'pin' | 'biometrics'

export type SecureUnlockReturnInitializing = {
  state: 'initializing'
}
export type SecureUnlockReturnNotConfigured = {
  state: 'not-configured'
  setup: (pin: string) => Promise<{ walletKey: string }>
  reinitialize: () => void
}
export type SecureUnlockReturnLocked = {
  state: 'locked'
  tryUnlockingUsingBiometrics: () => Promise<string | null>
  canTryUnlockingUsingBiometrics: boolean
  unlockUsingPin: (pin: string) => Promise<string>
  isUnlocking: boolean
  reinitialize: () => void
}
export type SecureUnlockReturnWalletKeyAcquired<Context extends Record<string, unknown>> = {
  state: 'acquired-wallet-key'
  walletKey: string
  unlockMethod: SecureUnlockMethod
  setWalletKeyValid: (context: Context, options?: { enableBiometrics?: boolean }) => Promise<void>
  setWalletKeyInvalid: () => void
  reinitialize: () => void
}
export type SecureUnlockReturnUnlocked<Context extends Record<string, unknown>> = {
  state: 'unlocked'
  unlockMethod: SecureUnlockMethod
  context: Context
  lock: () => void
  reinitialize: () => void

  enableBiometricUnlock: () => Promise<void>
  disableBiometricUnlock: () => Promise<void>
}

export type SecureUnlockReturn<Context extends Record<string, unknown>> =
  | SecureUnlockReturnInitializing
  | SecureUnlockReturnNotConfigured
  | SecureUnlockReturnLocked
  | SecureUnlockReturnWalletKeyAcquired<Context>
  | SecureUnlockReturnUnlocked<Context>

function _useSecureUnlockState<Context extends Record<string, unknown>>(): SecureUnlockReturn<Context> {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SecureUnlockState>('initializing')
  const [walletKey, setWalletKey] = useState<string>()
  const [canTryUnlockingUsingBiometrics, setCanTryUnlockingUsingBiometrics] = useState<boolean>(true)
  const [unlockMethod, setUnlockMethod] = useState<SecureUnlockMethod>()
  const [context, setContext] = useState<Context>()
  const [isUnlocking, setIsUnlocking] = useState(false)

  const syncBiometricUnlockState = async () => {
    const walletKeyVersion = secureWalletKey.getWalletKeyVersion()
    const biometricUnlockState = await secureWalletKey.getBiometricUnlockState(walletKeyVersion)

    queryClient.setQueryData(getBiometricUnlockStateQueryKey(walletKeyVersion), biometricUnlockState)
    setCanTryUnlockingUsingBiometrics(biometricUnlockState.canUnlockNow)

    return biometricUnlockState
  }

  const enableBiometricUnlock = async (walletKeyToStore: string) => {
    const walletKeyVersion = secureWalletKey.getWalletKeyVersion()

    try {
      await secureWalletKey.storeWalletKey(walletKeyToStore, walletKeyVersion)
      const storedWalletKey = await secureWalletKey.getWalletKeyUsingBiometrics(walletKeyVersion)

      if (!storedWalletKey || storedWalletKey !== walletKeyToStore) {
        throw new Error('Stored wallet key could not be verified after enabling biometric unlock')
      }
    } catch (error) {
      await secureWalletKey.removeWalletKey(walletKeyVersion).catch(() => undefined)
      await syncBiometricUnlockState()
      throw error
    }

    await syncBiometricUnlockState()
  }

  const disableBiometricUnlock = async () => {
    const walletKeyVersion = secureWalletKey.getWalletKeyVersion()
    await secureWalletKey.removeWalletKey(walletKeyVersion)
    await secureWalletKey.removeWalletPin(walletKeyVersion).catch(() => undefined)
    await syncBiometricUnlockState()
  }

  useQuery({
    queryFn: async () => {
      const salt = await secureWalletKey.getSalt(secureWalletKey.getWalletKeyVersion())
      await syncBiometricUnlockState()

      setState(salt ? 'locked' : 'not-configured')
      return salt
    },
    queryKey: ['wallet_unlock_salt'],
    enabled: state === 'initializing',
  })

  const reinitialize = () => {
    setState('initializing')
    setWalletKey(undefined)
    setCanTryUnlockingUsingBiometrics(true)
    setUnlockMethod(undefined)
    setContext(undefined)
    setIsUnlocking(false)
  }

  if (state === 'acquired-wallet-key') {
    if (!walletKey || !unlockMethod) {
      throw new Error('Missing walletKey or unlockMethod')
    }

    return {
      state,
      walletKey,
      unlockMethod,
      reinitialize,
      setWalletKeyInvalid: () => {
        if (unlockMethod === 'biometrics') {
          setCanTryUnlockingUsingBiometrics(false)
          void disableBiometricUnlock().catch(() => undefined)
        }

        setState('locked')
        setWalletKey(undefined)
        setUnlockMethod(undefined)
      },
      setWalletKeyValid: async (context, options) => {
        if (options?.enableBiometrics === true) {
          await enableBiometricUnlock(walletKey)
        } else if (options?.enableBiometrics === false) {
          await disableBiometricUnlock()
        } else {
          await syncBiometricUnlockState()
        }

        setContext(context)
        setState('unlocked')
      },
    }
  }

  if (state === 'unlocked') {
    if (!walletKey || !unlockMethod || !context) {
      throw new Error('Missing walletKey, unlockMethod or context')
    }

    return {
      state,
      context,
      unlockMethod,
      reinitialize,
      lock: () => {
        setState('locked')
        setWalletKey(undefined)
        setUnlockMethod(undefined)
        setContext(undefined)
      },
      enableBiometricUnlock: async () => enableBiometricUnlock(walletKey),
      disableBiometricUnlock,
    }
  }

  if (state === 'locked') {
    return {
      state,
      isUnlocking,
      canTryUnlockingUsingBiometrics,
      reinitialize,
      tryUnlockingUsingBiometrics: async () => {
        // TODO: need to somehow inform user that the unlocking went wrong
        const biometricUnlockState = await syncBiometricUnlockState()

        if (!biometricUnlockState.canUnlockNow) return null

        setIsUnlocking(true)
        try {
          const walletKey = await secureWalletKey.getWalletKeyUsingBiometrics(secureWalletKey.getWalletKeyVersion())
          if (walletKey) {
            setWalletKey(walletKey)
            setUnlockMethod('biometrics')
            setState('acquired-wallet-key')
          } else {
            await disableBiometricUnlock()
          }

          return walletKey
        } catch (error) {
          if (error instanceof BiometricAuthenticationCancelledError) {
            await syncBiometricUnlockState()
          } else if (error instanceof BiometricAuthenticationNotEnabledError) {
            await disableBiometricUnlock()
          } else if (error instanceof BiometricAuthenticationError) {
            await syncBiometricUnlockState()
          }
        } finally {
          setIsUnlocking(false)
        }

        return null
      },
      unlockUsingPin: async (pin: string) => {
        setIsUnlocking(true)
        try {
          const walletKey = await secureWalletKey.getWalletKeyUsingPin(pin, secureWalletKey.getWalletKeyVersion())

          setWalletKey(walletKey)
          setUnlockMethod('pin')
          setState('acquired-wallet-key')

          return walletKey
        } finally {
          setIsUnlocking(false)
        }
      },
    }
  }

  if (state === 'not-configured') {
    return {
      state,
      reinitialize,
      setup: async (pin) => {
        await secureWalletKey.createAndStoreSalt(true, secureWalletKey.getWalletKeyVersion())
        const walletKey = await secureWalletKey.getWalletKeyUsingPin(pin, secureWalletKey.getWalletKeyVersion())

        setWalletKey(walletKey)
        setUnlockMethod('pin')
        setState('acquired-wallet-key')
        return { walletKey }
      },
    }
  }

  return {
    state,
  }
}
