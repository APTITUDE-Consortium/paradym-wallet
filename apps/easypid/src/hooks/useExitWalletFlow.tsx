import { useNativeActivityKind } from '@easypid/features/native-activity/NativeActivityContext'
import { usePushToWallet } from '@package/app'
import { useCallback } from 'react'
import { BackHandler, NativeModules, Platform } from 'react-native'

type ExitWalletFlowOptions = {
  didOpenExternalRedirect?: boolean
}

export function useExitWalletFlow(source?: string) {
  const pushToWallet = usePushToWallet()
  const nativeActivityKind = useNativeActivityKind()
  const isDeeplinkFlow = source === 'deeplink'
  const isDeepLinkOverlayActivity = nativeActivityKind === 'deeplink-overlay'

  return useCallback(
    (options?: ExitWalletFlowOptions) => {
      if (options?.didOpenExternalRedirect) return

      if (isDeeplinkFlow && Platform.OS === 'android') {
        if (isDeepLinkOverlayActivity) {
          ;(NativeModules.DeepLinkOverlayControl as { finishOverlayTask?: () => void } | undefined)?.finishOverlayTask?.()
          return
        }

        BackHandler.exitApp()
        return
      }

      pushToWallet()
    },
    [isDeepLinkOverlayActivity, isDeeplinkFlow, pushToWallet]
  )
}
