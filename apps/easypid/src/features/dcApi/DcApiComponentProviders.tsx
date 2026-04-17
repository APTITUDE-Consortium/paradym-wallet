import { paradymWalletSdkOptions } from '@easypid/config/paradym'
import { Provider } from '@package/app'
import { ParadymWalletSdk } from '@paradym/wallet-sdk'
import type { PropsWithChildren } from 'react'
import tamaguiConfig from '../../../tamagui.config'
import { useStoredLocale } from '../../hooks/useStoredLocale'

export function DcApiComponentProviders({ children }: PropsWithChildren) {
  const [storedLocale] = useStoredLocale()

  return (
    <Provider config={tamaguiConfig} customLocale={storedLocale} rootBackgroundColor="transparent">
      <ParadymWalletSdk.UnlockProvider configuration={paradymWalletSdkOptions}>
        {children}
      </ParadymWalletSdk.UnlockProvider>
    </Provider>
  )
}
