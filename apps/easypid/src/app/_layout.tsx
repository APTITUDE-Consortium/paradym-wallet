import 'fast-text-encoding'

import { isCreateCredentialActivity, isGetCredentialActivity } from '@animo-id/expo-digital-credentials-api'
import { CURRENT_APP_TYPE } from '@easypid/config/appType'
import { credentialDataHandlerOptions } from '@easypid/config/credentialDataHandlerOptions'
import { paradymWalletSdkOptions } from '@easypid/config/paradym'
import { useNativeActivityKind } from '@easypid/features/native-activity/NativeActivityContext'
import { BackgroundLockProvider, DeeplinkHandler, NoInternetToastProvider, Provider } from '@package/app'
import {
  activityStorage,
  deferredCredentialStorage,
  ParadymWalletSdk,
  registerCreationOptionsForDcApi,
  useParadym,
} from '@paradym/wallet-sdk'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { Stack, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { SystemBars } from 'react-native-edge-to-edge'
import tamaguiConfig from '../../tamagui.config'
import { useStoredLocale } from '../hooks/useStoredLocale'

void SplashScreen.preventAutoHideAsync()

const jsonRecordIds = [activityStorage.recordId, deferredCredentialStorage.recordId]

const dcApiCreationOptions =
  CURRENT_APP_TYPE === 'FUNKE_WALLET'
    ? {
        title: 'Funke Wallet',
        iconAsset: require('../../assets/funke/icon.png'),
      }
    : {
        title: 'Paradym Wallet',
        iconAsset: require('../../assets/paradym/icon.png'),
      }

const transparentOverlayScreenOptions = {
  animation: 'fade' as const,
  gestureEnabled: false,
  headerShown: false,
  presentation: Platform.OS === 'android' ? ('modal' as const) : ('fullScreenModal' as const),
  contentStyle: {
    backgroundColor: Platform.OS === 'android' ? 'transparent' : 'white',
  },
}

const isTransparentOverlayRoute = ({ pathname }: { pathname: string }) => {
  const routePath = pathname.replace(/^\/+/, '')

  return ['authenticateOverlay', 'incomingDeeplink', 'openIdCredentialOverlay', 'openIdPresentationOverlay'].includes(
    routePath
  )
}

function AppRoutes() {
  const paradym = useParadym()
  const pathname = usePathname()
  const nativeActivityKind = useNativeActivityKind()
  const isDeepLinkOverlayActivity = nativeActivityKind === 'deeplink-overlay'
  const shouldRenderWalletStack = !isDeepLinkOverlayActivity && !isTransparentOverlayRoute({ pathname })

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      {shouldRenderWalletStack ? <Stack.Screen name="(app)" /> : null}
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="authenticate" />
      <Stack.Screen name="authenticateOverlay" options={transparentOverlayScreenOptions} />
      <Stack.Screen name="incomingDeeplink" options={transparentOverlayScreenOptions} />
      <Stack.Screen name="openIdCredentialOverlay" options={transparentOverlayScreenOptions} />
      <Stack.Screen name="openIdPresentationOverlay" options={transparentOverlayScreenOptions} />
    </Stack>
  )

  if (paradym.state !== 'unlocked') {
    return stack
  }

  return <ParadymWalletSdk.AppProvider recordIds={jsonRecordIds}>{stack}</ParadymWalletSdk.AppProvider>
}

export default function RootLayoutWithoutDcApi() {
  // With Expo Router the main application is always rendered, which is different from plain react native
  // To prevent this, we render null at the root
  if (Platform.OS === 'android' && (isGetCredentialActivity() || isCreateCredentialActivity())) {
    console.log('not rendering main application due to DC API')
    return null
  }

  return <RootLayout />
}

function RootLayout() {
  const [storedLocale] = useStoredLocale()
  const pathname = usePathname()
  const nativeActivityKind = useNativeActivityKind()
  const isDeepLinkOverlayActivity = nativeActivityKind === 'deeplink-overlay'
  const isOverlayDeeplinkRoute = isDeepLinkOverlayActivity || isTransparentOverlayRoute({ pathname })
  const rootBackgroundColor = Platform.OS === 'android' && isOverlayDeeplinkRoute ? 'transparent' : 'white'

  useEffect(() => {
    void registerCreationOptionsForDcApi({
      ...dcApiCreationOptions,
      subtitle: 'Save your credential to your wallet',
    })
  }, [])

  return (
    <Provider config={tamaguiConfig} customLocale={storedLocale} rootBackgroundColor={rootBackgroundColor}>
      <SystemBars style="dark" />
      <ThemeProvider
        value={{
          ...DefaultTheme,
          colors: {
            ...DefaultTheme.colors,
            background: rootBackgroundColor,
          },
        }}
      >
        <BackgroundLockProvider>
          <NoInternetToastProvider>
            <ParadymWalletSdk.UnlockProvider configuration={paradymWalletSdkOptions}>
              {isDeepLinkOverlayActivity ? (
                <AppRoutes />
              ) : (
                <DeeplinkHandler
                  handleInitialUrl={false}
                  resetNavigation
                  credentialDataHandlerOptions={{
                    ...credentialDataHandlerOptions,
                    routeMethod: 'replace',
                    source: 'deeplink',
                  }}
                >
                  <AppRoutes />
                </DeeplinkHandler>
              )}
            </ParadymWalletSdk.UnlockProvider>
          </NoInternetToastProvider>
        </BackgroundLockProvider>
      </ThemeProvider>
    </Provider>
  )
}
